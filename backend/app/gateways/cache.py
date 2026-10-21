"""Short-lived cache for provider responses, shaped like the inventory_cache table.

Each entry carries a provider and a valid_until timestamp. Expired entries are kept
so a gateway can serve stale data when the provider refuses a live re-fetch.
An in-memory store for now; the Postgres-backed version can keep the same interface.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class CacheEntry:
    provider: str
    key: str
    payload: Any
    fetched_at: datetime
    valid_until: datetime

    def is_fresh(self, now: datetime) -> bool:
        return now < self.valid_until


class TTLCache:
    def __init__(self, clock: Callable[[], datetime] = utcnow) -> None:
        self._clock = clock
        self._entries: dict[tuple[str, str], CacheEntry] = {}

    def get(self, provider: str, key: str, *, allow_stale: bool = False) -> CacheEntry | None:
        entry = self._entries.get((provider, key))
        if entry is None:
            return None
        if allow_stale or entry.is_fresh(self._clock()):
            return entry
        return None

    def put(self, provider: str, key: str, payload: Any, ttl: timedelta) -> CacheEntry:
        now = self._clock()
        entry = CacheEntry(provider, key, payload, fetched_at=now, valid_until=now + ttl)
        self._entries[(provider, key)] = entry
        return entry
