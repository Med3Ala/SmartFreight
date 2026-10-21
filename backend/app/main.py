"""SmartFreight API for the dashboard."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .agent import BestFormulaMatrix
from .demo import DEMO_MATRIX, DEMO_OFFER
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
