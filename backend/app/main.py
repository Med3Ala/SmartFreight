"""SmartFreight API for the dashboard."""

from datetime import date

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from .agent import BestFormulaMatrix
from .demo import DEMO_MATRIX, DEMO_OFFER
from .planner import TARIFFS, plan
from .tracking import tracking_snapshot

app = FastAPI(title="SmartFreight AI")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

# In-memory until the offers table and the agent are connected.
OFFERS = {DEMO_OFFER["id"]: DEMO_OFFER}
MATRICES = {DEMO_OFFER["id"]: DEMO_MATRIX}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/offers")
def list_offers() -> list[dict]:
    return list(OFFERS.values())


@app.get("/api/offers/{offer_id}/matrix", response_model=BestFormulaMatrix)
def get_matrix(offer_id: str) -> BestFormulaMatrix:
    if offer_id not in MATRICES:
        raise HTTPException(404, f"No Best Formula Matrix for offer {offer_id}")
    return MATRICES[offer_id]


@app.post("/api/matrix/validate", response_model=BestFormulaMatrix)
def validate_matrix(matrix: BestFormulaMatrix) -> BestFormulaMatrix:
    """Check an agent answer against the contract and return it with the margins computed."""
    return matrix


@app.get("/api/tracking")
async def get_tracking() -> dict:
    """Containers and vessels on the watchlist, live from Traqo when TRAQO_API_KEY is set."""
    return await tracking_snapshot()


class Price(BaseModel):
    amount: float = Field(gt=0)
    currency: str = "USD"


class BoxRequest(BaseModel):
    code: str
    count: int = Field(gt=0)


class ShipmentRequest(BaseModel):
    client: str = ""
    origin: str
    destination: str
    weight_kg: float | None = Field(default=None, gt=0)
    volume_m3: float | None = Field(default=None, gt=0)
    commodity: str = ""
    reefer: bool = False
    hazmat: bool = False
    deadline: date | None = None
    price: Price | None = None
    containers: list[BoxRequest] = []


@app.post("/api/plan")
def plan_request(request: ShipmentRequest) -> dict:
    """Options A, B and C for one client request, built from the example tariffs."""
    for port in (request.origin, request.destination):
        if port not in TARIFFS["ports"]:
            raise HTTPException(422, f"Unknown port {port}. Known ports: {', '.join(sorted(TARIFFS['ports']))}")
    for box in request.containers:
        if box.code not in TARIFFS["equipment"]:
            raise HTTPException(422, f"Unknown container type {box.code}")
    if not (request.weight_kg or request.volume_m3 or request.containers):
        raise HTTPException(422, "Give a weight, a volume or the containers wanted")
    body = request.model_dump(mode="json")
    result = plan(body, date.today().isoformat())
    BestFormulaMatrix.model_validate(result["matrix"])  # the planner must honour the agent's contract
    return result
