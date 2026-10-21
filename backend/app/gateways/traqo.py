"""Traqo container tracking gateway.

GET https://traqocontainer.com/api/v1/container/{number}?sealine={SCAC}
Auth: Authorization: Bearer <TRAQO_API_KEY>. The key is read from the environment only.

Documented status codes and how they are handled:
  400 bad request (e.g. BL with no sealine)     -> TraqoBadRequest, no retry
  401 missing/invalid key                       -> TraqoAuthError, no retry
  402 shipment slot capacity reached            -> TraqoCapacityError, no retry, stale cache if any
  403 developer mode disabled                   -> TraqoAuthError, no retry
  404 no tracking data for reference + carrier  -> TraqoNotFound, no retry
  429 rate_limit_exceeded (per-key, per minute) -> wait Retry-After, retry
  429 READD_RATE_LIMITED / UPSTREAM_BUDGET_REACHED / lookup_limit_exceeded
                                                -> daily caps, no retry, stale cache if any
  5xx transient provider error                  -> exponential backoff with jitter, retry
"""

import asyncio
import os
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

import httpx

from .cache import TTLCache

PROVIDER = "Traqo"
DEFAULT_BASE_URL = "https://traqocontainer.com/api/v1"
API_KEY_ENV = "TRAQO_API_KEY"

DAILY_CAP_CODES = ("READD_RATE_LIMITED", "UPSTREAM_BUDGET_REACHED", "lookup_limit_exceeded")
THROTTLE_CODE = "rate_limit_exceeded"


class TraqoError(Exception):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class TraqoConfigError(TraqoError):
    pass


class TraqoBadRequest(TraqoError):
    pass


class TraqoAuthError(TraqoError):
    pass


class TraqoCapacityError(TraqoError):
    pass


class TraqoNotFound(TraqoError):
    pass


class TraqoRateLimited(TraqoError):
    def __init__(self, message: str, *, code: str | None, retry_after: float | None) -> None:
        super().__init__(message, status=429, code=code)
        self.retry_after = retry_after


class TraqoUnavailable(TraqoError):
    pass


@dataclass(frozen=True)
class TraqoTrackingResult:
    container_number: str
    sealine: str | None
    payload: dict[str, Any]
    fetched_at: datetime
    from_cache: bool
    stale: bool
    rate_limit_remaining: int | None = None


def _error_code(response: httpx.Response) -> str | None:
    text = response.text
    for code in (*DAILY_CAP_CODES, THROTTLE_CODE):
        if code in text:
            return code
    return None


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _int_header(response: httpx.Response, name: str) -> int | None:
    try:
        return int(response.headers[name])
    except (KeyError, ValueError):
        return None


class TraqoClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        cache: TTLCache | None = None,
        cache_ttl: timedelta = timedelta(hours=1),
        max_retries: int = 4,
        backoff_base: float = 1.0,
        max_retry_after: float = 60.0,
        timeout: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        api_key = api_key or os.environ.get(API_KEY_ENV)
        if not api_key:
            raise TraqoConfigError(f"{API_KEY_ENV} is not set")
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            timeout=timeout,
            transport=transport,
        )
        self.cache = cache or TTLCache()
        self.cache_ttl = cache_ttl
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.max_retry_after = max_retry_after
        self._sleep = sleep

    async def __aenter__(self) -> "TraqoClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def track_container(
        self, container_number: str, sealine: str | None = None, *, force_refresh: bool = False
    ) -> TraqoTrackingResult:
        container_number = container_number.strip().upper()
        sealine = sealine.strip().upper() if sealine else None
        key = f"{container_number}:{sealine or ''}"

        if not force_refresh and (hit := self.cache.get(PROVIDER, key)):
            return TraqoTrackingResult(container_number, sealine, hit.payload, hit.fetched_at, True, False)

        params = {"sealine": sealine} if sealine else None
        try:
            response = await self._request("GET", f"/container/{container_number}", params=params)
        except (TraqoCapacityError, TraqoRateLimited) as exc:
            # Daily caps and slot limits: the docs say to read stored data instead of re-fetching.
            if stale := self.cache.get(PROVIDER, key, allow_stale=True):
                return TraqoTrackingResult(container_number, sealine, stale.payload, stale.fetched_at, True, True)
            raise exc

        payload = response.json()
        entry = self.cache.put(PROVIDER, key, payload, self.cache_ttl)
        return TraqoTrackingResult(
            container_number,
            sealine,
            payload,
            entry.fetched_at,
            from_cache=False,
            stale=False,
            rate_limit_remaining=_int_header(response, "X-RateLimit-Remaining"),
        )

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        attempt = 0
        while True:
            try:
                response = await self._http.request(method, url, **kwargs)
            except httpx.TransportError as exc:
                if attempt >= self.max_retries:
                    raise TraqoUnavailable(f"Traqo unreachable: {exc}") from exc
                await self._sleep(self._backoff(attempt))
                attempt += 1
                continue

            status = response.status_code
            if status < 400:
                return response
            if status == 400:
                raise TraqoBadRequest(f"Bad request: {response.text}", status=status)
            if status in (401, 403):
                raise TraqoAuthError(f"Traqo auth failed ({status}): {response.text}", status=status)
            if status == 402:
                raise TraqoCapacityError("Traqo shipment slot capacity reached", status=status)
            if status == 404:
                raise TraqoNotFound("No tracking data for that reference and carrier", status=status)
            if status == 429:
                code = _error_code(response)
                retry_after = _retry_after(response)
                throttled = code == THROTTLE_CODE or code is None
                if not throttled or attempt >= self.max_retries:
                    raise TraqoRateLimited(
                        f"Traqo rate limited ({code or 'unknown'})", code=code, retry_after=retry_after
                    )
                await self._sleep(min(retry_after if retry_after is not None else self._backoff(attempt), self.max_retry_after))
                attempt += 1
                continue
            if status >= 500:
                if attempt >= self.max_retries:
                    raise TraqoUnavailable(f"Traqo server error {status}", status=status)
                await self._sleep(self._backoff(attempt))
                attempt += 1
                continue
            raise TraqoError(f"Unexpected Traqo response {status}: {response.text}", status=status)

    def _backoff(self, attempt: int) -> float:
        return self.backoff_base * (2**attempt) + random.uniform(0, self.backoff_base)
