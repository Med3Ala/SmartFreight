"""Live container and vessel tracking for the dashboard.

With TRAQO_API_KEY set, shipments come from Traqo for each container on the watchlist.
Without it, an example fleet is served so the dashboard can be explored offline.
"""

import os
from datetime import datetime, timedelta, timezone
from math import hypot

from .gateways import TraqoClient, TraqoError, TraqoShipment
from .gateways.traqo import API_KEY_ENV, TraqoContainer, TraqoEvent, TraqoVessel, TraqoVoyageLeg

# Standard carrier SCAC codes, as Traqo's `sealine` parameter expects them.
CARRIERS = {
    "MAEU": "Maersk",
    "MSCU": "MSC",
    "CMDU": "CMA CGM",
    "HLCU": "Hapag-Lloyd",
    "COSU": "COSCO",
    "ONEY": "ONE",
    "EGLV": "Evergreen",
}

WATCHLIST_ENV = "TRACKING_WATCHLIST"  # "MRSU6859427:MAEU,MSCU1234565:MSCU"


def watchlist() -> list[tuple[str, str | None]]:
    items = []
    for item in os.environ.get(WATCHLIST_ENV, "").split(","):
        number, _, sealine = item.strip().partition(":")
        if number:
            items.append((number.upper(), sealine.upper() or None))
    return items


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def phase(s: TraqoShipment) -> str:
    if s.ata or (s.status or "").upper() == "DELIVERED":
        return "arrived"
    if any(v.is_current for v in s.vessels):
        return "at_sea"
    return "at_port"


def shipment_view(s: TraqoShipment, *, stale: bool = False) -> dict:
    """Flatten a TraqoShipment into what the tracking view needs."""
    current = next((v for v in s.vessels if v.is_current), None)
    upcoming = next((leg for leg in s.voyage if not leg.is_actual and leg.port), None)
    return {
        "container_number": s.reference_number,
        "sealine": s.sealine,
        "carrier": s.sealine_name or CARRIERS.get(s.sealine or "", s.sealine),
        "status": s.status,
        "phase": phase(s),
        "is_delayed": bool(s.is_delayed),
        "origin": s.origin,
        "destination": s.destination,
        "eta": _iso(s.eta),
        "ata": _iso(s.ata),
        "total_days": s.total_days,
        "remaining_days": s.remaining_days,
        "position": list(s.position) if s.position else None,
        "route": [list(p) for p in s.route],
        "vessel": {"name": current.name, "imo": current.imo, "mmsi": current.mmsi} if current else None,
        "next_port": upcoming.port if upcoming else None,
        "containers": [
            {"number": c.number, "iso_code": c.iso_code, "size_type": c.size_type, "description": c.description}
            for c in s.containers
        ],
        "events": [
            {
                "time": _iso(e.timestamp_utc or e.local_time),
                "description": e.description,
                "location": e.location,
                "vessel": e.vessel,
                "is_actual": e.is_actual,
            }
            for e in s.events
        ],
        "last_synced_at": _iso(s.last_synced_at),
        "stale": stale,
    }


async def live_shipments(client: TraqoClient, items: list[tuple[str, str | None]]) -> tuple[list[dict], list[str]]:
    shipments, errors = [], []
    for number, sealine in items:
        try:
            result = await client.track_container(number, sealine)
        except TraqoError as exc:
            errors.append(f"{number}: {exc}")
            continue
        if result.shipment:
            shipments.append(shipment_view(result.shipment, stale=result.stale))
    return shipments, errors


async def tracking_snapshot() -> dict:
    items = watchlist()
    if os.environ.get(API_KEY_ENV) and items:
        async with TraqoClient() as client:
            shipments, errors = await live_shipments(client, items)
        return {"source": "live", "generated_at": _iso(datetime.now(timezone.utc)), "shipments": shipments, "errors": errors}
    return {"source": "example", "generated_at": _iso(datetime.now(timezone.utc)), "shipments": example_fleet(), "errors": []}


# ---------------------------------------------------------------------------
# Example fleet: plausible lanes into and out of the Mediterranean and North Europe.

PORTS = {
    "Shanghai": (31.23, 121.49),
    "Ningbo": (29.93, 121.85),
    "Singapore": (1.26, 103.82),
    "Nhava Sheva": (18.95, 72.95),
    "Port Said": (31.26, 32.30),
    "Rades": (36.80, 10.27),
    "Genoa": (44.40, 8.92),
    "Valencia": (39.44, -0.32),
    "Marseille Fos": (43.40, 4.88),
    "Tanger Med": (35.88, -5.50),
    "Rotterdam": (51.95, 4.05),
    "Antwerp": (51.28, 4.32),
    "Hamburg": (53.54, 9.97),
    "New York": (40.67, -74.05),
}
COUNTRY = {
    "Shanghai": "China", "Ningbo": "China", "Singapore": "Singapore", "Nhava Sheva": "India",
    "Port Said": "Egypt", "Rades": "Tunisia", "Genoa": "Italy", "Valencia": "Spain",
    "Marseille Fos": "France", "Tanger Med": "Morocco", "Rotterdam": "Netherlands",
    "Antwerp": "Belgium", "Hamburg": "Germany", "New York": "United States",
}

# Sea waypoints so routes follow shipping lanes rather than crossing land.
_MALACCA = [(5.5, 97.5), (6.0, 80.0)]
_RED_SEA = [(12.6, 43.4), (20.5, 38.2), (27.5, 34.0), (29.9, 32.55)]
_MED_EAST = [(33.5, 25.0), (36.6, 13.5)]
_GIBRALTAR = [(36.0, -5.6)]
_ATLANTIC_N = [(37.0, -9.8), (43.5, -9.8), (48.6, -5.6), (50.2, -1.0)]
_ASIA_TO_SUEZ = [*_MALACCA, *_RED_SEA]

LANES = {
    ("Shanghai", "Rotterdam"): [PORTS["Shanghai"], PORTS["Singapore"], *_ASIA_TO_SUEZ, *_MED_EAST, *_GIBRALTAR, *_ATLANTIC_N, PORTS["Rotterdam"]],
    ("Ningbo", "Genoa"): [PORTS["Ningbo"], PORTS["Singapore"], *_ASIA_TO_SUEZ, *_MED_EAST, (38.5, 9.0), PORTS["Genoa"]],
    ("Nhava Sheva", "Genoa"): [PORTS["Nhava Sheva"], (13.0, 52.0), *_RED_SEA, *_MED_EAST, (38.5, 9.0), PORTS["Genoa"]],
    ("Shanghai", "Rades"): [PORTS["Shanghai"], PORTS["Singapore"], *_ASIA_TO_SUEZ, *_MED_EAST, PORTS["Rades"]],
    ("Rades", "Rotterdam"): [PORTS["Rades"], (37.6, 8.0), (37.0, 0.0), *_GIBRALTAR, *_ATLANTIC_N, PORTS["Rotterdam"]],
    ("Rades", "Marseille Fos"): [PORTS["Rades"], (39.0, 8.5), PORTS["Marseille Fos"]],
    ("Genoa", "Rades"): [PORTS["Genoa"], (41.0, 9.6), PORTS["Rades"]],
    ("Antwerp", "Rades"): [PORTS["Antwerp"], (50.2, -1.0), (48.6, -5.6), (43.5, -9.8), (37.0, -9.8), *_GIBRALTAR, (37.0, 0.0), (37.6, 8.0), PORTS["Rades"]],
    ("Tanger Med", "Rades"): [PORTS["Tanger Med"], (36.3, -2.0), (37.6, 8.0), PORTS["Rades"]],
    ("Valencia", "Rades"): [PORTS["Valencia"], (38.5, 4.0), PORTS["Rades"]],
    ("Rotterdam", "New York"): [PORTS["Rotterdam"], (50.2, -1.0), (49.5, -10.0), (45.0, -40.0), PORTS["New York"]],
    ("Hamburg", "Rades"): [PORTS["Hamburg"], (54.0, 7.5), (51.5, 2.0), (50.2, -1.0), (48.6, -5.6), (43.5, -9.8), (37.0, -9.8), *_GIBRALTAR, (37.6, 8.0), PORTS["Rades"]],
}


def _along(route: list[tuple[float, float]], fraction: float) -> tuple[float, float]:
    """The point a given fraction of the way along a polyline."""
    legs = list(zip(route, route[1:]))
    lengths = [hypot(b[0] - a[0], b[1] - a[1]) for a, b in legs]
    target = sum(lengths) * min(max(fraction, 0.0), 1.0)
    for (a, b), length in zip(legs, lengths):
        if target <= length and length:
            t = target / length
            return (round(a[0] + (b[0] - a[0]) * t, 4), round(a[1] + (b[1] - a[1]) * t, 4))
        target -= length
    return route[-1]


def _check_digit(owner_serial: str) -> str:
    """ISO 6346 check digit for a 10-character owner code + serial."""
    values = {}
    n = 10
    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        if n % 11 == 0:
            n += 1
        values[ch] = n
        n += 1
    total = sum((values[c] if c.isalpha() else int(c)) * 2**i for i, c in enumerate(owner_serial))
    return str(total % 11 % 10)


def _box(prefix: str, serial: int) -> str:
    base = f"{prefix}{serial:06d}"
    return base + _check_digit(base)


SIZE_TYPES = {
    "40HC": ("45G1", "40ft High Cube Dry Van"),
    "40DV": ("42G1", "40ft Dry Van"),
    "20DV": ("22G1", "20ft Dry Van"),
    "40RH": ("45R1", "40ft High Cube Reefer"),
}

# (owner prefix, serial, SCAC, origin, destination, progress, transit days, delayed, size type, boxes, vessel)
# progress > 1 means the ship arrived that many transit-fractions ago.
_FLEET = [
    ("MSKU", 482113, "MAEU", "Shanghai", "Rotterdam", 0.82, 34, False, "40HC", 3, "MAERSK KOLKATA"),
    ("MRKU", 907245, "MAEU", "Rades", "Rotterdam", 0.40, 7, False, "40HC", 2, "MAERSK NUBA"),
    ("MSKU", 115320, "MAEU", "Antwerp", "Rades", 1.04, 11, False, "40HC", 4, "MAERSK NUBA"),
    ("MSKU", 640012, "MAEU", "Rotterdam", "New York", 0.55, 10, False, "40DV", 2, "MAERSK CHICAGO"),
    ("MSCU", 773810, "MSCU", "Ningbo", "Genoa", 0.66, 30, True, "40HC", 2, "MSC ARIANE"),
    ("MEDU", 228461, "MSCU", "Rades", "Rotterdam", 0.30, 14, True, "40HC", 1, "MSC TUNIS"),
    ("MSCU", 519970, "MSCU", "Valencia", "Rades", 1.06, 4, False, "20DV", 3, "MSC TUNIS"),
    ("MEDU", 830155, "MSCU", "Nhava Sheva", "Genoa", 0.91, 19, False, "40DV", 2, "MSC SARISKA"),
    ("CMAU", 361704, "CMDU", "Shanghai", "Rades", 0.94, 32, False, "40HC", 2, "CMA CGM CARTHAGE"),
    ("CMAU", 552018, "CMDU", "Rades", "Marseille Fos", 0.60, 2, False, "40RH", 1, "CMA CGM ELISSA"),
    ("CMAU", 708432, "CMDU", "Genoa", "Rades", 1.10, 3, False, "40HC", 2, "CMA CGM ELISSA"),
    ("HLXU", 413377, "HLCU", "Hamburg", "Rades", 0.75, 12, True, "40HC", 2, "ESSEN EXPRESS"),
    ("CSNU", 690521, "COSU", "Shanghai", "Rotterdam", 0.48, 36, False, "40HC", 4, "COSCO NEBULA"),
    ("ONEU", 120998, "ONEY", "Tanger Med", "Rades", 0.88, 3, False, "20DV", 2, "ONE MARINER"),
    ("EGHU", 935140, "EGLV", "Ningbo", "Genoa", 0.70, 31, True, "40HC", 3, "EVER LUMEN"),
]


def example_fleet(now: datetime | None = None) -> list[dict]:
    now = (now or datetime.now(timezone.utc)).replace(minute=0, second=0, microsecond=0)
    fleet = []
    for prefix, serial, scac, origin, dest, progress, days, delayed, size, boxes, vessel in _FLEET:
        route = LANES[(origin, dest)]
        departed = now - timedelta(days=days * progress)
        delay = timedelta(days=3 if delayed else 0)
        eta = departed + timedelta(days=days) + delay
        arrived = progress >= 1
        number = _box(prefix, serial)
        iso, description = SIZE_TYPES[size]
        events = [
            TraqoEvent(None, departed - timedelta(days=2), "GTIN", "LOAD", "Full container gated in", None, origin, None, None, "TRUCK", True),
            TraqoEvent(None, departed, "VDL", "DEPA", "Vessel departure", None, origin, vessel, None, "VESSEL", True),
        ]
        if delayed:
            events.append(TraqoEvent(None, now - timedelta(days=1), "ETA", "DLAY", "ETA revised later by 3 days", None, None, vessel, None, "VESSEL", True))
        events.append(TraqoEvent(None, eta, "VAD", "ARRV", "Vessel arrival", None, dest, vessel, None, "VESSEL", arrived))
        if arrived:
            events.append(TraqoEvent(None, eta + timedelta(hours=20), "DISC", "DISC", "Discharged at port", None, dest, None, None, None, True))
        shipment = TraqoShipment(
            reference_number=number,
            shipment_uid=None,
            sealine=scac,
            sealine_name=CARRIERS[scac],
            status="DELIVERED" if arrived else "IN_TRANSIT",
            is_active=not arrived,
            is_delayed=delayed,
            origin=f"{origin}, {COUNTRY[origin]}",
            destination=f"{dest}, {COUNTRY[dest]}",
            eta=None if arrived else eta,
            ata=eta if arrived else None,
            total_days=days + delay.days,
            remaining_days=0 if arrived else max(0, (eta - now).days),
            position=_along(route, progress),
            last_synced_at=now,
            containers=[
                TraqoContainer(_box(prefix, serial + i), iso, size, description, None) for i in range(boxes)
            ],
            events=events,
            voyage=[
                TraqoVoyageLeg("pol", origin, None, vessel, departed, None, None, True),
                TraqoVoyageLeg("pod", dest, None, vessel, None, eta if arrived else None, eta, arrived),
            ],
            vessels=[TraqoVessel(vessel, None, None, not arrived)],
            route=route,
            provider_cached=None,
        )
        fleet.append(shipment_view(shipment))
    return fleet
