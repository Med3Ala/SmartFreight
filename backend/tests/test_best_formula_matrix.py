from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.agent import BestFormulaMatrix, system_prompt


def option(id_, strategy, revenue="10000", freight="6000", rent="800", port="450"):
    return {
        "id": id_,
        "strategy": strategy,
        "summary": "Rades to Rotterdam",
        "transit_days": 9,
        "profit_margin": {
            "currency": "USD",
            "client_revenue": revenue,
            "carrier_freight_cost": freight,
            "container_rent_fee": rent,
            "port_fees": port,
        },
        "equipment": {
            "containers": [{"count": 2, "size": "40ft", "type": "High Cube Dry Van", "provider": "Maersk"}],
            "carriers": ["Maersk"],
            "utilization_pct": "87.5",
        },
        "risk": {
            "origin_free_days": 5,
            "destination_free_days": 4,
            "detention_fee_per_day": "75",
            "demurrage_fee_per_day": "90",
            "deadline_risk": "low",
            "pitfalls": ["Destination free time is only 4 days"],
        },
    }


def matrix(options):
    return {"offer_id": "offer-1", "options": options, "recommended": "C", "recommendation_reason": "Best compromise."}


VALID = [option("A", "lowest_cost"), option("B", "fastest_transit"), option("C", "balanced")]


def test_margin_formula():
    m = BestFormulaMatrix.model_validate(matrix(VALID))
    pm = m.options[0].profit_margin
    assert pm.total_cost == Decimal("7250")
    assert pm.margin == Decimal("2750")
    assert pm.margin_pct == Decimal("27.50")


def test_margin_can_be_negative():
    opts = [option("A", "lowest_cost", revenue="5000"), VALID[1], VALID[2]]
    assert BestFormulaMatrix.model_validate(matrix(opts)).options[0].profit_margin.margin == Decimal("-2250")


@pytest.mark.parametrize(
    "opts",
    [
        VALID[:2],
        VALID + [option("C", "balanced")],
        [VALID[1], VALID[0], VALID[2]],
        [option("A", "balanced"), VALID[1], VALID[2]],
    ],
)
def test_rejects_anything_but_a_b_c(opts):
    with pytest.raises(ValidationError):
        BestFormulaMatrix.model_validate(matrix(opts))


def test_rejects_mixed_currency():
    eur = option("B", "fastest_transit")
    eur["profit_margin"]["currency"] = "EUR"
    with pytest.raises(ValidationError):
        BestFormulaMatrix.model_validate(matrix([VALID[0], eur, VALID[2]]))


def test_prompt_states_the_contract():
    prompt = system_prompt()
    for phrase in ["LOWEST COST", "FASTEST TRANSIT", "BALANCED/OPTIMIZED", "Profit Margin", "demurrage"]:
        assert phrase in prompt
