from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_demo_matrix_has_computed_margins():
    offer_id = client.get("/api/offers").json()[0]["id"]
    body = client.get(f"/api/offers/{offer_id}/matrix").json()
    assert [o["id"] for o in body["options"]] == ["A", "B", "C"]
    assert body["options"][2]["profit_margin"]["margin"] == "2430"


def test_unknown_offer_is_404():
    assert client.get("/api/offers/nope/matrix").status_code == 404


def test_validate_rejects_two_options():
    matrix = client.get("/api/offers/demo-rades-rotterdam/matrix").json()
    matrix["options"] = matrix["options"][:2]
    assert client.post("/api/matrix/validate", json=matrix).status_code == 422
