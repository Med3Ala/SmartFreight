import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent import BestFormulaMatrix
from app.main import app
from app.planner import plan

CASES = json.loads((Path(__file__).resolve().parents[2] / "shared" / "plan-cases.json").read_text(encoding="utf-8"))


def snapshot(result: dict) -> dict:
    """Same fields as snapshot() in frontend/src/planner/__tests__/plan.test.js."""
    m = result["matrix"]
    return {
        "revenue_source": result["revenue_source"],
        "assumptions": [a["code"] for a in result["assumptions"]],
        "recommended": m["recommended"],
        "options": [
            {
                "id": o["id"],
                "transit_days": o["transit_days"],
                "freight": o["profit_margin"]["carrier_freight_cost"],
                "rent": o["profit_margin"]["container_rent_fee"],
                "port": o["profit_margin"]["port_fees"],
                "revenue": o["profit_margin"]["client_revenue"],
                "carriers": o["equipment"]["carriers"],
                "boxes": [
                    f"{c['count']} {c['size']} {c['type']} {c['provider']}{' leased' if c['leased'] else ''}"
                    for c in o["equipment"]["containers"]
                ],
                "utilization_pct": o["equipment"]["utilization_pct"],
                "deadline_risk": o["risk"]["deadline_risk"],
                "pitfalls": [n["code"] for n in o["risk"]["pitfall_notes"]],
            }
            for o in m["options"]
        ],
    }


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_matches_dashboard_planner(case):
    assert snapshot(plan(case["request"], case["today"])) == case["expect"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_plan_meets_the_matrix_contract(case):
    matrix = BestFormulaMatrix.model_validate(plan(case["request"], case["today"])["matrix"])
    a, b, c = matrix.options
    assert a.profit_margin.total_cost <= min(b.profit_margin.total_cost, c.profit_margin.total_cost)
    assert b.transit_days <= min(a.transit_days, c.transit_days)


def test_english_text_is_rendered():
    result = plan(CASES[0]["request"], CASES[0]["today"])
    assert result["matrix"]["recommendation_reason"].startswith("Option A keeps the best margin (")
    assert "{" not in " ".join(result["matrix"]["options"][0]["risk"]["pitfalls"])


def test_plan_endpoint():
    client = TestClient(app)
    ok = client.post("/api/plan", json={"origin": "Rades", "destination": "Rotterdam", "volume_m3": 60})
    assert ok.status_code == 200
    assert [o["id"] for o in ok.json()["matrix"]["options"]] == ["A", "B", "C"]
    assert client.post("/api/plan", json={"origin": "Atlantis", "destination": "Rotterdam", "volume_m3": 60}).status_code == 422
    assert client.post("/api/plan", json={"origin": "Rades", "destination": "Rotterdam"}).status_code == 422
