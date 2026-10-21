import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.gateways import parse_shipment
from app.main import app
from app.tracking import _check_digit, example_fleet, shipment_view, watchlist

FIXTURE = Path(__file__).parent / "fixtures" / "traqo_container_MRSU6859427.json"


def test_live_shipment_view_from_real_response():
    view = shipment_view(parse_shipment(json.loads(FIXTURE.read_text())))
    assert view["carrier"] == "Maersk"
    assert view["phase"] == "arrived"
    assert view["destination"] == "Antwerp, Belgium"
    assert view["containers"][0]["size_type"] == "40HC"
    assert len(view["route"]) >= 2 and view["position"]


def test_example_fleet_covers_carriers_and_phases():
    fleet = example_fleet(datetime(2026, 10, 21, 12, tzinfo=timezone.utc))
    assert {s["carrier"] for s in fleet} >= {"Maersk", "MSC", "CMA CGM"}
    assert {s["phase"] for s in fleet} == {"arrived", "at_sea"}
    for s in fleet:
        assert s["eta"] or s["ata"]
        assert s["position"] and len(s["route"]) >= 2


def test_iso6346_check_digit():
    assert _check_digit("CSQU305438") == "3"


def test_watchlist_parsing(monkeypatch):
    monkeypatch.setenv("TRACKING_WATCHLIST", " mrsu6859427:maeu, MSCU1234565 ,")
    assert watchlist() == [("MRSU6859427", "MAEU"), ("MSCU1234565", None)]


def test_tracking_endpoint_serves_example_without_key(monkeypatch):
    monkeypatch.delenv("TRAQO_API_KEY", raising=False)
    body = TestClient(app).get("/api/tracking").json()
    assert body["source"] == "example"
    assert len(body["shipments"]) == len(example_fleet())
