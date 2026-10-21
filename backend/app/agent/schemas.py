"""Structured output contract for the Best Formula Matrix."""

from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, computed_field, model_validator

Money = Annotated[Decimal, Field(ge=0, decimal_places=2)]


class Note(BaseModel):
    """A planner message as a code plus params, so the dashboard can show it in the user's language."""

    code: str
    params: dict[str, str | int | float] = {}


class Strategy(str, Enum):
    LOWEST_COST = "lowest_cost"
    FASTEST_TRANSIT = "fastest_transit"
    BALANCED = "balanced"


STRATEGY_BY_OPTION = {
    "A": Strategy.LOWEST_COST,
    "B": Strategy.FASTEST_TRANSIT,
    "C": Strategy.BALANCED,
}


class ProfitMargin(BaseModel):
    """Profit Margin = Client Revenue - (Carrier Freight Cost + Container Rent Fee + Port Fees)."""

    currency: str = Field(min_length=3, max_length=3, examples=["USD"])
    client_revenue: Money
    carrier_freight_cost: Money
    container_rent_fee: Money
    port_fees: Money

    @computed_field
    @property
    def total_cost(self) -> Decimal:
        return self.carrier_freight_cost + self.container_rent_fee + self.port_fees

    @computed_field
    @property
    def margin(self) -> Decimal:
        return self.client_revenue - self.total_cost

    @computed_field
    @property
    def margin_pct(self) -> Decimal | None:
        if self.client_revenue == 0:
            return None
        return (self.margin / self.client_revenue * 100).quantize(Decimal("0.01"))


class ContainerLine(BaseModel):
    count: int = Field(gt=0)
    size: Literal["20ft", "40ft", "45ft"]
    type: str = Field(examples=["High Cube Dry Van", "Dry Van", "Reefer", "Open Top", "Flat Rack"])
    provider: str = Field(examples=["Maersk", "MSC", "CMA CGM", "Container-xChange"])
    leased: bool = False


class EquipmentConfiguration(BaseModel):
    containers: list[ContainerLine] = Field(min_length=1)
    carriers: list[str] = Field(min_length=1)
    utilization_pct: Decimal = Field(ge=0, le=100)


class RiskAnalysis(BaseModel):
    origin_free_days: int | None = Field(default=None, ge=0)
    destination_free_days: int | None = Field(default=None, ge=0)
    detention_fee_per_day: Money | None = None
    demurrage_fee_per_day: Money | None = None
    deadline_risk: Literal["low", "medium", "high"]
    pitfalls: list[str] = Field(min_length=1)
    pitfall_notes: list[Note] = []


class FormulaOption(BaseModel):
    id: Literal["A", "B", "C"]
    strategy: Strategy
    summary: str
    summary_note: Note | None = None
    transit_days: int = Field(gt=0)
    profit_margin: ProfitMargin
    equipment: EquipmentConfiguration
    risk: RiskAnalysis

    @model_validator(mode="after")
    def _strategy_matches_id(self) -> "FormulaOption":
        if STRATEGY_BY_OPTION[self.id] != self.strategy:
            raise ValueError(f"option {self.id} must use strategy {STRATEGY_BY_OPTION[self.id].value}")
        return self


class BestFormulaMatrix(BaseModel):
    offer_id: str
    options: list[FormulaOption] = Field(min_length=3, max_length=3)
    recommended: Literal["A", "B", "C"]
    recommendation_reason: str
    recommendation_note: Note | None = None

    @model_validator(mode="after")
    def _exactly_a_b_c(self) -> "BestFormulaMatrix":
        if [o.id for o in self.options] != ["A", "B", "C"]:
            raise ValueError("options must be exactly A, B and C in that order")
        currencies = {o.profit_margin.currency for o in self.options}
        if len(currencies) != 1:
            raise ValueError("all options must use the same currency")
        return self
