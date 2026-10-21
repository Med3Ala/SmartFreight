"""Optimization core: builds the Best Formula Matrix (options A, B, C) for one shipment request.

Uses the example tariffs in shared/freight-tariffs.json until live carrier and Container xChange
quotes are connected. The dashboard runs the same rules in frontend/src/planner/plan.js;
shared/plan-cases.json is checked by both test suites so the two stay identical.
"""

import json
import math
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

SHARED = Path(__file__).resolve().parents[2] / "shared"
TARIFFS = json.loads((SHARED / "freight-tariffs.json").read_text(encoding="utf-8"))
NOTES_EN = json.loads((SHARED / "plan-notes.en.json").read_text(encoding="utf-8"))

CARRIERS = TARIFFS["carriers"]
EQ = TARIFFS["equipment"]
DRY = ["20DV", "40DV", "40HC"]
REEFER = ["20RF", "40RH"]


def _round(x: float) -> int:
    """Half-up rounding, as JavaScript's Math.round does for these positive amounts."""
    return math.floor(x + 0.5)


def _round1(x: float) -> float:
    return math.floor(x * 10 + 0.5) / 10


def _num(v: Any) -> str:
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)


def render_note(note: dict) -> str:
    """English text for a note. Params: "@code" nests a note, *_usd is dollars, pct is a percentage."""

    def param(key: str, value: Any) -> str:
        if isinstance(value, str) and value.startswith("@"):
            return NOTES_EN.get(value[1:], value[1:])
        if key.endswith("_usd"):
            return f"${value:,}"
        if key == "pct":
            return f"{_num(value)}%"
        return _num(value)

    text = NOTES_EN.get(note["code"], note["code"])
    for key, value in note.get("params", {}).items():
        text = text.replace("{" + key + "}", param(key, value))
    return text


def _note(code: str, **params: Any) -> dict:
    return {"code": code, "params": params}


def lane(origin: str, destination: str) -> tuple[int, int]:
    a = TARIFFS["ports"][origin]["region"]
    b = TARIFFS["ports"][destination]["region"]
    usd, days = TARIFFS["lanes"].get(f"{a}-{b}") or TARIFFS["lanes"][f"{b}-{a}"]
    return usd, days


@dataclass
class Ctx:
    origin: str
    destination: str
    volume: float
    weight: float
    reefer: bool
    hazmat: bool
    deadline: str | None
    today: str
    lane_usd: int
    fixed: list[dict] | None
    codes: list[str]
    transit: dict[str, int] = field(default_factory=dict)


def _carrier(name: str) -> dict:
    return next(c for c in CARRIERS if c["name"] == name)


def freight_per_box(carrier: dict, code: str, sourcing: str, lane_usd: int, hazmat: bool) -> int:
    base = lane_usd * EQ[code]["rate"] * carrier["rate"] + (TARIFFS["hazmat_surcharge"] if hazmat else 0)
    return _round(base * (1 - TARIFFS["soc_discount"])) if sourcing == "soc" else _round(base)


def thc_per_box(code: str, origin: str, destination: str) -> int:
    factor = TARIFFS["thc_40_factor"] if EQ[code]["teu"] == 2 else 1
    o = TARIFFS["thc_20"][TARIFFS["ports"][origin]["region"]]
    d = TARIFFS["thc_20"][TARIFFS["ports"][destination]["region"]]
    return _round((o + d) * factor)


def boxes_needed(code: str, volume: float, weight: float) -> int:
    e = EQ[code]
    return max(1, math.ceil(volume / (e["volume_m3"] * TARIFFS["usable_volume"])), math.ceil(weight / e["payload_kg"]))


def _cost(lines: list[dict], ctx: Ctx) -> dict:
    freight = rent = port = 0
    for line in lines:
        c = _carrier(line["carrier"])
        freight += freight_per_box(c, line["code"], line["sourcing"], ctx.lane_usd, ctx.hazmat) * line["count"]
        rent += (EQ[line["code"]]["lease"] if line["sourcing"] == "soc" else 0) * line["count"]
        port += thc_per_box(line["code"], ctx.origin, ctx.destination) * line["count"]
    port += TARIFFS["bl_fee"] * len({line["carrier"] for line in lines})
    return {"freight": freight, "rent": rent, "port": port, "total": freight + rent + port}


def _carriers_of(lines: list[dict]) -> list[str]:
    return list(dict.fromkeys(line["carrier"] for line in lines))


def _signature(lines: list[dict]) -> str:
    return "|".join(sorted(f"{l['count']}{l['code']}{l['carrier']}{l['sourcing']}" for l in lines))


def _shapes(ctx: Ctx) -> list[list[dict]]:
    """Every box mix that holds the cargo: one type alone, or a big box type topped up with 20ft boxes."""
    if ctx.fixed:
        return [ctx.fixed]
    out = [[{"code": code, "count": boxes_needed(code, ctx.volume, ctx.weight)}] for code in ctx.codes]
    pairs = [("40RH", "20RF")] if ctx.reefer else [("40HC", "20DV"), ("40DV", "20DV")]
    for big, small in pairs:
        for a in range(1, boxes_needed(big, ctx.volume, ctx.weight) + 1):
            for b in range(1, boxes_needed(small, ctx.volume, ctx.weight) + 1):
                vol = (a * EQ[big]["volume_m3"] + b * EQ[small]["volume_m3"]) * TARIFFS["usable_volume"]
                pay = a * EQ[big]["payload_kg"] + b * EQ[small]["payload_kg"]
                if vol >= ctx.volume and pay >= ctx.weight:
                    out.append([{"code": big, "count": a}, {"code": small, "count": b}])
    return out


def _cheapest_source(code: str, carriers: list[dict], sourcings: list[str], ctx: Ctx) -> dict:
    best = None
    for c in carriers:
        for sourcing in sourcings:
            unit = (
                freight_per_box(c, code, sourcing, ctx.lane_usd, ctx.hazmat)
                + (EQ[code]["lease"] if sourcing == "soc" else 0)
                + thc_per_box(code, ctx.origin, ctx.destination)
            )
            if best is None or unit < best["unit"]:
                best = {"carrier": c["name"], "sourcing": sourcing, "unit": unit}
    return best


def _cheapest(ctx: Ctx, carriers: list[dict], sourcings: list[str], avoid: frozenset = frozenset()) -> dict:
    ranked = []
    for shape in _shapes(ctx):
        lines = []
        for s in shape:
            src = _cheapest_source(s["code"], carriers, sourcings, ctx)
            lines.append({**s, "carrier": src["carrier"], "sourcing": src["sourcing"]})
        ranked.append(
            {
                "lines": lines,
                "cost": _cost(lines, ctx),
                "transit": max(ctx.transit[n] for n in _carriers_of(lines)),
                "capacity": sum(EQ[s["code"]]["volume_m3"] * s["count"] for s in shape),
                "boxes": sum(s["count"] for s in shape),
            }
        )
    ranked.sort(key=lambda c: (c["cost"]["total"], c["transit"], c["capacity"], c["boxes"], _signature(c["lines"])))
    return next((c for c in ranked if _signature(c["lines"]) not in avoid), ranked[0])


def _option_a(ctx: Ctx) -> dict:
    return _cheapest(ctx, CARRIERS, ["coc", "soc"])


def _option_b(ctx: Ctx) -> dict:
    fastest = sorted(CARRIERS, key=lambda c: (ctx.transit[c["name"]], -c["on_time"], c["rate"]))[0]
    return _cheapest(ctx, [fastest], ["coc"])


def _option_c(ctx: Ctx, avoid: frozenset) -> dict:
    times = [ctx.transit[c["name"]] for c in CARRIERS]
    cutoff = math.ceil((min(times) + max(times)) / 2)
    eligible = [c for c in CARRIERS if ctx.transit[c["name"]] <= cutoff]
    pick = _cheapest(ctx, eligible, ["coc", "soc"], avoid)
    # With one fixed box plan there is nothing to vary but the sourcing: fall back to carrier-owned boxes.
    return _cheapest(ctx, eligible, ["coc"], avoid) if _signature(pick["lines"]) in avoid else pick


def _slack(transit: int, ctx: Ctx) -> int | None:
    if not ctx.deadline:
        return None
    days_left = (date.fromisoformat(ctx.deadline) - date.fromisoformat(ctx.today)).days
    return days_left - TARIFFS["lead_days"] - transit


def _risk(slack: int | None) -> str:
    if slack is None:
        return "low"
    if slack < 0:
        return "high"
    return "medium" if slack < 4 else "low"


def _build_option(option_id: str, strategy: str, cand: dict, ctx: Ctx, revenue: int) -> dict:
    names = _carriers_of(cand["lines"])
    used = [_carrier(n) for n in names]
    slack = _slack(cand["transit"], ctx)
    capacity = sum(EQ[l["code"]]["volume_m3"] * l["count"] for l in cand["lines"])
    payload = sum(EQ[l["code"]]["payload_kg"] * l["count"] for l in cand["lines"])
    utilization = min(100, _round1((ctx.volume / capacity) * 100))
    free_origin = min(c["free_origin"] for c in used)
    free_dest = min(c["free_dest"] for c in used)
    leased = any(l["sourcing"] == "soc" for l in cand["lines"])

    pitfalls = [_note("pit.transship", carrier=c["name"]) for c in used if c["transshipment"]]
    if leased:
        pitfalls.append(_note("pit.leased"))
    if free_dest <= 3:
        pitfalls.append(_note("pit.free_dest", days=free_dest))
    if len(names) > 1:
        pitfalls.append(_note("pit.split", n=len(names)))
    if ctx.reefer:
        pitfalls.append(_note("pit.reefer"))
    if ctx.hazmat:
        pitfalls.append(_note("pit.hazmat"))
    if utilization < 60:
        pitfalls.append(_note("pit.low_fill", pct=utilization))
    if ctx.weight / payload > 0.9:
        pitfalls.append(_note("pit.heavy"))
    if slack is not None and slack < 0:
        pitfalls.append(_note("pit.late", days=-slack, lead=TARIFFS["lead_days"]))
    elif slack is not None and slack < 4:
        pitfalls.append(_note("pit.tight", days=slack))
    pitfalls.append(_note("pit.free_time", origin=free_origin, dest=free_dest))

    carriers = " + ".join(names)
    if option_id == "A":
        summary = _note("sum.a", carriers=carriers, sourcing="@sourcing.leased" if leased else "@sourcing.owned")
    elif option_id == "B":
        summary = _note("sum.b", carriers=carriers)
    else:
        summary = _note("sum.c", carriers=carriers, mix=" + ".join(f"{l['count']} × {l['code']}" for l in cand["lines"]))

    return {
        "id": option_id,
        "strategy": strategy,
        "summary": render_note(summary),
        "summary_note": summary,
        "transit_days": cand["transit"],
        "profit_margin": {
            "currency": "USD",
            "client_revenue": revenue,
            "carrier_freight_cost": cand["cost"]["freight"],
            "container_rent_fee": cand["cost"]["rent"],
            "port_fees": cand["cost"]["port"],
        },
        "equipment": {
            "containers": [
                {
                    "count": l["count"],
                    "size": EQ[l["code"]]["size"],
                    "type": EQ[l["code"]]["type"],
                    "provider": "Container-xChange" if l["sourcing"] == "soc" else l["carrier"],
                    "leased": l["sourcing"] == "soc",
                }
                for l in cand["lines"]
            ],
            "carriers": names,
            "utilization_pct": utilization,
        },
        "risk": {
            "origin_free_days": free_origin,
            "destination_free_days": free_dest,
            "detention_fee_per_day": max(c["detention"] for c in used),
            "demurrage_fee_per_day": max(c["demurrage"] for c in used),
            "deadline_risk": _risk(slack),
            "pitfalls": [render_note(p) for p in pitfalls],
            "pitfall_notes": pitfalls,
        },
    }


def plan(request: dict, today: str) -> dict:
    """request: client, origin, destination, weight_kg, volume_m3, commodity, reefer, hazmat,
    deadline (YYYY-MM-DD or None), price ({amount, currency} or None), containers ([{code, count}])."""
    assumptions = [_note("as.example_rates")]
    density = TARIFFS["assumed_density_kg_m3"]
    volume = request.get("volume_m3")
    weight = request.get("weight_kg")
    fixed = [{"code": c["code"], "count": c["count"]} for c in request.get("containers") or []] or None
    if fixed:
        assumptions.append(_note("as.boxes_requested"))
    if not volume and not weight and fixed:
        volume = _round1(sum(EQ[c["code"]]["volume_m3"] * c["count"] for c in fixed) * TARIFFS["usable_volume"] * 0.8)
    if not volume and weight:
        volume = _round1(weight / density)
        assumptions.append(_note("as.volume_estimated", volume=volume))
    if not weight and volume:
        weight = _round(volume * density)
        assumptions.append(_note("as.weight_estimated", weight=weight))
    if not request.get("deadline"):
        assumptions.append(_note("as.no_deadline"))

    lane_usd, lane_days = lane(request["origin"], request["destination"])
    reefer = bool(request.get("reefer")) or any(EQ[c["code"]]["reefer"] for c in fixed or [])
    ctx = Ctx(
        origin=request["origin"],
        destination=request["destination"],
        volume=volume,
        weight=weight,
        reefer=reefer,
        hazmat=bool(request.get("hazmat")),
        deadline=request.get("deadline"),
        today=today,
        lane_usd=lane_usd,
        fixed=fixed,
        codes=REEFER if reefer else DRY,
        transit={c["name"]: _round(lane_days * c["transit"]) for c in CARRIERS},
    )

    a = _option_a(ctx)
    b = _option_b(ctx)
    c = _option_c(ctx, frozenset({_signature(a["lines"]), _signature(b["lines"])}))

    price = request.get("price")
    if price and price.get("amount"):
        rate = TARIFFS["fx_usd"].get(price["currency"], 1)
        revenue = _round(price["amount"] * rate)
        revenue_source = "client"
        if rate != 1:
            assumptions.append(_note("as.currency", **{"from": price["currency"], "rate": rate}))
    else:
        revenue_source = "suggested"
        top = max(a["cost"]["total"], b["cost"]["total"], c["cost"]["total"])
        revenue = math.ceil((top * TARIFFS["suggested_markup"]) / 50) * 50
        assumptions.append(_note("as.no_price", amount_usd=revenue))

    options = [
        _build_option("A", "lowest_cost", a, ctx, revenue),
        _build_option("B", "fastest_transit", b, ctx, revenue),
        _build_option("C", "balanced", c, ctx, revenue),
    ]

    def margin(o: dict) -> int:
        pm = o["profit_margin"]
        return revenue - (pm["carrier_freight_cost"] + pm["container_rent_fee"] + pm["port_fees"])

    ok = [o for o in options if o["risk"]["deadline_risk"] != "high"]
    if ok:
        best = sorted(ok, key=lambda o: (-margin(o), o["transit_days"]))[0]
        recommendation = _note("rec.best", id=best["id"], pct=_round1((margin(best) / revenue) * 100), days=best["transit_days"])
    else:
        best = sorted(options, key=lambda o: o["transit_days"])[0]
        recommendation = _note("rec.fastest", id=best["id"])

    return {
        "request": {**request, "volume_m3": volume, "weight_kg": weight},
        "revenue_source": revenue_source,
        "assumptions": assumptions,
        "matrix": {
            "offer_id": "draft",
            "options": options,
            "recommended": recommendation["params"]["id"],
            "recommendation_reason": render_note(recommendation),
            "recommendation_note": recommendation,
        },
    }
