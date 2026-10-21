import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from app.gateways.cache import TTLCache
from app.gateways.traqo import (
    TraqoAuthError,
    TraqoClient,
    TraqoConfigError,
    TraqoError,
    TraqoNotFound,
    TraqoRateLimited,
    TraqoUnavailable,
    parse_shipment,
)


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 21, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now


def make_client(responses, clock=None):
    calls = []
    sleeps = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return responses.pop(0)

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    client = TraqoClient(
        "test-key",
        cache=TTLCache(clock or Clock()),
        transport=httpx.MockTransport(handler),
        sleep=fake_sleep,
        backoff_base=0.01,
    )
    return client, calls, sleeps


def run(coro):
    return asyncio.run(coro)


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("TRAQO_API_KEY", raising=False)
    with pytest.raises(TraqoConfigError):
        TraqoClient()


def test_reads_key_from_env(monkeypatch):
    monkeypatch.setenv("TRAQO_API_KEY", "env-key")
    client = TraqoClient()
    assert client._http.headers["Authorization"] == "Bearer env-key"


def test_success_sends_auth_and_sealine_and_caches():
    client, calls, _ = make_client([httpx.Response(200, json={"status": "ok"}, headers={"X-RateLimit-Remaining": "9"})])
    result = run(client.track_container("mrsu6859427", "maeu"))
    assert result.payload == {"status": "ok"}
    assert result.rate_limit_remaining == 9 and not result.from_cache
    assert calls[0].url.path == "/api/v1/container/MRSU6859427"
    assert calls[0].url.params["sealine"] == "MAEU"
    assert calls[0].headers["Authorization"] == "Bearer test-key"

    again = run(client.track_container("MRSU6859427", "MAEU"))
    assert again.from_cache and not again.stale and len(calls) == 1


def test_retries_5xx_with_backoff():
    client, calls, sleeps = make_client([httpx.Response(503), httpx.Response(502), httpx.Response(200, json={})])
    run(client.track_container("MRSU6859427", "MAEU"))
    assert len(calls) == 3 and len(sleeps) == 2 and sleeps[1] > sleeps[0] - 0.01


def test_gives_up_after_max_retries():
    client, calls, _ = make_client([httpx.Response(500)] * 5)
    with pytest.raises(TraqoUnavailable):
        run(client.track_container("MRSU6859427", "MAEU"))
    assert len(calls) == 5


def test_throttle_429_waits_retry_after():
    client, calls, sleeps = make_client(
        [
            httpx.Response(429, json={"error": "rate_limit_exceeded"}, headers={"Retry-After": "7"}),
            httpx.Response(200, json={}),
        ]
    )
    run(client.track_container("MRSU6859427", "MAEU"))
    assert sleeps == [7.0] and len(calls) == 2


@pytest.mark.parametrize("code", ["READD_RATE_LIMITED", "UPSTREAM_BUDGET_REACHED", "lookup_limit_exceeded"])
def test_daily_cap_429_not_retried(code):
    client, calls, _ = make_client([httpx.Response(429, json={"error": code})])
    with pytest.raises(TraqoRateLimited) as exc:
        run(client.track_container("MRSU6859427", "MAEU"))
    assert exc.value.code == code and len(calls) == 1


def test_daily_cap_serves_stale_cache():
    clock = Clock()
    client, _, _ = make_client(
        [httpx.Response(200, json={"v": 1}), httpx.Response(429, json={"error": "READD_RATE_LIMITED"})], clock
    )
    run(client.track_container("MRSU6859427", "MAEU"))
    clock.now += timedelta(hours=2)
    result = run(client.track_container("MRSU6859427", "MAEU"))
    assert result.stale and result.payload == {"v": 1}


def test_capacity_402_serves_stale_cache():
    clock = Clock()
    client, _, _ = make_client([httpx.Response(200, json={"v": 1}), httpx.Response(402)], clock)
    run(client.track_container("MRSU6859427", "MAEU"))
    clock.now += timedelta(hours=2)
    assert run(client.track_container("MRSU6859427", "MAEU")).stale


@pytest.mark.parametrize("status,exc", [(401, TraqoAuthError), (403, TraqoAuthError), (404, TraqoNotFound)])
def test_client_errors_not_retried(status, exc):
    client, calls, _ = make_client([httpx.Response(status)])
    with pytest.raises(exc):
        run(client.track_container("MRSU6859427", "MAEU"))
    assert len(calls) == 1


FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "traqo_container_MRSU6859427.json").read_text())


def test_parses_real_container_response():
    client, _, _ = make_client([httpx.Response(200, json=FIXTURE)])
    result = run(client.track_container("MRSU6859427", "MAEU"))
    assert result.payload == FIXTURE
    s = result.shipment
    assert s.reference_number == "MRSU6859427" and s.sealine_name == "Maersk"
    assert s.status == "DELIVERED" and not s.is_active and s.is_delayed is None
    assert (s.origin, s.destination) == ("Shanghai, China", "Antwerp, Belgium")
    assert s.ata == datetime(2026, 9, 21, 11, 49) and s.eta is None
    assert s.total_days == 61 and s.position == pytest.approx((51.2024, 4.3829), abs=1e-4)
    assert [(c.number, c.size_type, c.iso_code) for c in s.containers] == [("MRSU6859427", "40HC", "45G0")]
    assert [e.code for e in s.events][:4] == ["GTOT", "GTIN", "LOAD", "DEPA"]
    assert s.events[0].timestamp_utc == datetime(2026, 7, 27, 5, 35, tzinfo=timezone.utc)
    transship = [e for e in s.events if e.locode == "MAPTM"]
    assert {e.vessel for e in transship} == {"MAERSK ELBA", "KASSIAKOS"}
    assert [leg.leg for leg in s.voyage] == ["prepol", "pol", "pod", "postpod"]
    assert s.voyage[1].departed_at == datetime(2026, 8, 12, 15, 37)
    assert [(v.name, v.is_current) for v in s.vessels] == [("MAERSK ELBA", False), ("KASSIAKOS", True)]
    assert len(s.route) == 5 and s.route[0] == pytest.approx((31.4001, 121.4971), abs=1e-4)
    assert s.provider_cached is False

    assert run(client.track_container("MRSU6859427", "MAEU")).shipment == s


def test_unrecognised_payload_keeps_raw_without_shipment():
    assert parse_shipment({"status": "ok"}) is None


def test_success_false_raises():
    client, _, _ = make_client([httpx.Response(200, json={"success": False, "message": "nope"})])
    with pytest.raises(TraqoError):
        run(client.track_container("MRSU6859427", "MAEU"))
