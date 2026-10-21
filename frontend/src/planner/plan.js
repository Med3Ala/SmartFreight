// Builds the Best Formula Matrix (options A, B, C) for one shipment request from the example tariffs.
// Mirrors backend/app/planner/plan.py; shared/plan-cases.json keeps the two in step.

import TARIFFS from "../../../shared/freight-tariffs.json";
import NOTES_EN from "../../../shared/plan-notes.en.json";

const CARRIERS = TARIFFS.carriers;
const EQ = TARIFFS.equipment;
const DRY = ["20DV", "40DV", "40HC"];
const REEFER = ["20RF", "40RH"];

const round = (x) => Math.floor(x + 0.5);
const round1 = (x) => Math.floor(x * 10 + 0.5) / 10;

// Param conventions shared with the UI translations: "@code" nests another note,
// *_usd is a dollar amount, pct is a percentage.
export function formatParam(key, value, { money, percent, nested }) {
  if (typeof value === "string" && value.startsWith("@")) return nested(value.slice(1));
  if (key.endsWith("_usd")) return money(value);
  if (key === "pct") return percent(value);
  return String(value);
}

const EN_FORMAT = {
  money: (v) => `$${v.toLocaleString("en-US")}`,
  percent: (v) => `${v}%`,
  nested: (code) => NOTES_EN[code] ?? code,
};

export function renderNote({ code, params = {} }) {
  const text = NOTES_EN[code] ?? code;
  return text.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? `{${k}}` : formatParam(k, params[k], EN_FORMAT)));
}

const note = (code, params = {}) => ({ code, params });

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function lane(origin, destination) {
  const a = TARIFFS.ports[origin].region;
  const b = TARIFFS.ports[destination].region;
  return TARIFFS.lanes[`${a}-${b}`] ?? TARIFFS.lanes[`${b}-${a}`];
}

function transitDays(carrier, laneDays) {
  return round(laneDays * carrier.transit);
}

function freightPerBox(carrier, code, sourcing, laneUsd, hazmat) {
  const base = laneUsd * EQ[code].rate * carrier.rate + (hazmat ? TARIFFS.hazmat_surcharge : 0);
  return sourcing === "soc" ? round(base * (1 - TARIFFS.soc_discount)) : round(base);
}

function thcPerBox(code, origin, destination) {
  const factor = EQ[code].teu === 2 ? TARIFFS.thc_40_factor : 1;
  const o = TARIFFS.thc_20[TARIFFS.ports[origin].region];
  const d = TARIFFS.thc_20[TARIFFS.ports[destination].region];
  return round((o + d) * factor);
}

function boxesNeeded(code, volume, weight) {
  const e = EQ[code];
  return Math.max(1, Math.ceil(volume / (e.volume_m3 * TARIFFS.usable_volume)), Math.ceil(weight / e.payload_kg));
}

// lines: [{ code, count, carrier, sourcing }]
function costOf(lines, ctx) {
  let freight = 0;
  let rent = 0;
  let port = 0;
  for (const l of lines) {
    const c = CARRIERS.find((x) => x.name === l.carrier);
    freight += freightPerBox(c, l.code, l.sourcing, ctx.laneUsd, ctx.hazmat) * l.count;
    rent += (l.sourcing === "soc" ? EQ[l.code].lease : 0) * l.count;
    port += thcPerBox(l.code, ctx.origin, ctx.destination) * l.count;
  }
  port += TARIFFS.bl_fee * new Set(lines.map((l) => l.carrier)).size;
  return { freight, rent, port, total: freight + rent + port };
}

const carriersOf = (lines) => [...new Set(lines.map((l) => l.carrier))];
const transitOf = (lines, ctx) => Math.max(...carriersOf(lines).map((n) => ctx.transit[n]));
const signature = (lines) =>
  lines
    .map((l) => `${l.count}${l.code}${l.carrier}${l.sourcing}`)
    .sort()
    .join("|");

function candidate(lines, ctx) {
  return { lines, cost: costOf(lines, ctx), transit: transitOf(lines, ctx) };
}

// Every box mix that holds the cargo: one type alone, or a big box type topped up with 20ft boxes.
function shapes(ctx) {
  if (ctx.fixed) return [ctx.fixed];
  const out = ctx.codes.map((code) => [{ code, count: boxesNeeded(code, ctx.volume, ctx.weight) }]);
  const pairs = ctx.reefer ? [["40RH", "20RF"]] : [["40HC", "20DV"], ["40DV", "20DV"]];
  for (const [big, small] of pairs) {
    const maxBig = boxesNeeded(big, ctx.volume, ctx.weight);
    const maxSmall = boxesNeeded(small, ctx.volume, ctx.weight);
    for (let a = 1; a <= maxBig; a++) {
      for (let b = 1; b <= maxSmall; b++) {
        const vol = (a * EQ[big].volume_m3 + b * EQ[small].volume_m3) * TARIFFS.usable_volume;
        const pay = a * EQ[big].payload_kg + b * EQ[small].payload_kg;
        if (vol >= ctx.volume && pay >= ctx.weight) out.push([{ code: big, count: a }, { code: small, count: b }]);
      }
    }
  }
  return out;
}

// Cheapest (carrier, sourcing) for one box of `code` among the given carriers.
function cheapestSource(code, carriers, sourcings, ctx) {
  let best = null;
  for (const c of carriers) {
    for (const sourcing of sourcings) {
      const unit =
        freightPerBox(c, code, sourcing, ctx.laneUsd, ctx.hazmat) +
        (sourcing === "soc" ? EQ[code].lease : 0) +
        thcPerBox(code, ctx.origin, ctx.destination);
      if (!best || unit < best.unit) best = { carrier: c.name, sourcing, unit };
    }
  }
  return best;
}

// Cheapest way to move the cargo with these carriers, skipping box plans already used by another option.
function cheapest(ctx, carriers, sourcings, avoid = new Set()) {
  const ranked = shapes(ctx)
    .map((shape) => {
      const lines = shape.map((s) => {
        const src = cheapestSource(s.code, carriers, sourcings, ctx);
        return { ...s, carrier: src.carrier, sourcing: src.sourcing };
      });
      const cand = candidate(lines, ctx);
      cand.capacity = shape.reduce((n, s) => n + EQ[s.code].volume_m3 * s.count, 0);
      cand.boxes = shape.reduce((n, s) => n + s.count, 0);
      return cand;
    })
    .sort(
      (x, y) =>
        x.cost.total - y.cost.total ||
        x.transit - y.transit ||
        x.capacity - y.capacity ||
        x.boxes - y.boxes ||
        (signature(x.lines) < signature(y.lines) ? -1 : signature(x.lines) > signature(y.lines) ? 1 : 0),
    );
  return ranked.find((c) => !avoid.has(signature(c.lines))) ?? ranked[0];
}

// A: lowest total cost, any carrier, carrier-owned or leased boxes.
const optionA = (ctx) => cheapest(ctx, CARRIERS, ["coc", "soc"]);

// B: the fastest, most reliable carrier on its own boxes.
function optionB(ctx) {
  const fastest = [...CARRIERS].sort(
    (a, b) => ctx.transit[a.name] - ctx.transit[b.name] || b.on_time - a.on_time || a.rate - b.rate,
  )[0];
  return cheapest(ctx, [fastest], ["coc"]);
}

// C: cheapest plan among carriers at or under the midpoint transit, different from A and B.
function optionC(ctx, avoid) {
  const times = CARRIERS.map((c) => ctx.transit[c.name]);
  const cutoff = Math.ceil((Math.min(...times) + Math.max(...times)) / 2);
  const eligible = CARRIERS.filter((c) => ctx.transit[c.name] <= cutoff);
  const pick = cheapest(ctx, eligible, ["coc", "soc"], avoid);
  // With one fixed box plan there is nothing to vary but the sourcing: fall back to carrier-owned boxes.
  return avoid.has(signature(pick.lines)) ? cheapest(ctx, eligible, ["coc"], avoid) : pick;
}

function slackOf(transit, ctx) {
  if (!ctx.deadline) return null;
  return daysBetween(ctx.today, ctx.deadline) - TARIFFS.lead_days - transit;
}

function riskLevel(slack) {
  if (slack === null) return "low";
  if (slack < 0) return "high";
  if (slack < 4) return "medium";
  return "low";
}

function buildOption(id, strategy, cand, ctx, revenue) {
  const names = carriersOf(cand.lines);
  const used = names.map((n) => CARRIERS.find((c) => c.name === n));
  const slack = slackOf(cand.transit, ctx);
  const capacity = cand.lines.reduce((n, l) => n + EQ[l.code].volume_m3 * l.count, 0);
  const payload = cand.lines.reduce((n, l) => n + EQ[l.code].payload_kg * l.count, 0);
  const utilization = Math.min(100, round1((ctx.volume / capacity) * 100));
  const freeOrigin = Math.min(...used.map((c) => c.free_origin));
  const freeDest = Math.min(...used.map((c) => c.free_dest));
  const leased = cand.lines.some((l) => l.sourcing === "soc");

  const pitfalls = [];
  for (const c of used) if (c.transshipment) pitfalls.push(note("pit.transship", { carrier: c.name }));
  if (leased) pitfalls.push(note("pit.leased"));
  if (freeDest <= 3) pitfalls.push(note("pit.free_dest", { days: freeDest }));
  if (names.length > 1) pitfalls.push(note("pit.split", { n: names.length }));
  if (ctx.reefer) pitfalls.push(note("pit.reefer"));
  if (ctx.hazmat) pitfalls.push(note("pit.hazmat"));
  if (utilization < 60) pitfalls.push(note("pit.low_fill", { pct: utilization }));
  if (ctx.weight / payload > 0.9) pitfalls.push(note("pit.heavy"));
  if (slack !== null && slack < 0) pitfalls.push(note("pit.late", { days: -slack, lead: TARIFFS.lead_days }));
  else if (slack !== null && slack < 4) pitfalls.push(note("pit.tight", { days: slack }));
  pitfalls.push(note("pit.free_time", { origin: freeOrigin, dest: freeDest }));

  const mix = cand.lines.map((l) => `${l.count} × ${l.code}`).join(" + ");
  const summary =
    id === "A"
      ? note("sum.a", { carriers: names.join(" + "), sourcing: leased ? "@sourcing.leased" : "@sourcing.owned" })
      : id === "B"
        ? note("sum.b", { carriers: names.join(" + ") })
        : note("sum.c", { carriers: names.join(" + "), mix });

  return {
    id,
    strategy,
    summary: renderNote(summary),
    summary_note: summary,
    transit_days: cand.transit,
    profit_margin: {
      currency: "USD",
      client_revenue: revenue,
      carrier_freight_cost: cand.cost.freight,
      container_rent_fee: cand.cost.rent,
      port_fees: cand.cost.port,
    },
    equipment: {
      containers: cand.lines.map((l) => ({
        count: l.count,
        size: EQ[l.code].size,
        type: EQ[l.code].type,
        provider: l.sourcing === "soc" ? "Container-xChange" : l.carrier,
        leased: l.sourcing === "soc",
      })),
      carriers: names,
      utilization_pct: utilization,
    },
    risk: {
      origin_free_days: freeOrigin,
      destination_free_days: freeDest,
      detention_fee_per_day: Math.max(...used.map((c) => c.detention)),
      demurrage_fee_per_day: Math.max(...used.map((c) => c.demurrage)),
      deadline_risk: riskLevel(slack),
      pitfalls: pitfalls.map(renderNote),
      pitfall_notes: pitfalls,
    },
  };
}

// request: { client, origin, destination, weight_kg, volume_m3, commodity, reefer, hazmat,
//            deadline: "YYYY-MM-DD" | null, price: { amount, currency } | null, containers: [{ code, count }] }
export function plan(request, today) {
  const assumptions = [note("as.example_rates")];
  const density = TARIFFS.assumed_density_kg_m3;
  let volume = request.volume_m3;
  let weight = request.weight_kg;
  const fixed = request.containers?.length ? request.containers.map((c) => ({ code: c.code, count: c.count })) : null;
  if (fixed) assumptions.push(note("as.boxes_requested"));
  if (!volume && !weight && fixed) {
    volume = round1(fixed.reduce((n, c) => n + EQ[c.code].volume_m3 * c.count, 0) * TARIFFS.usable_volume * 0.8);
  }
  if (!volume && weight) {
    volume = round1(weight / density);
    assumptions.push(note("as.volume_estimated", { volume }));
  }
  if (!weight && volume) {
    weight = round(volume * density);
    assumptions.push(note("as.weight_estimated", { weight }));
  }
  if (!request.deadline) assumptions.push(note("as.no_deadline"));

  const [laneUsd, laneDays] = lane(request.origin, request.destination);
  const reefer = Boolean(request.reefer) || Boolean(fixed?.some((c) => EQ[c.code].reefer));
  const ctx = {
    origin: request.origin,
    destination: request.destination,
    volume,
    weight,
    reefer,
    hazmat: Boolean(request.hazmat),
    deadline: request.deadline,
    today,
    laneUsd,
    fixed,
    codes: reefer ? REEFER : DRY,
    transit: Object.fromEntries(CARRIERS.map((c) => [c.name, transitDays(c, laneDays)])),
  };

  const a = optionA(ctx);
  const b = optionB(ctx);
  const c = optionC(ctx, new Set([signature(a.lines), signature(b.lines)]));

  let revenue;
  let revenueSource = "client";
  if (request.price?.amount) {
    const rate = TARIFFS.fx_usd[request.price.currency] ?? 1;
    revenue = round(request.price.amount * rate);
    if (rate !== 1) assumptions.push(note("as.currency", { from: request.price.currency, rate }));
  } else {
    revenueSource = "suggested";
    const top = Math.max(a.cost.total, b.cost.total, c.cost.total);
    revenue = Math.ceil((top * TARIFFS.suggested_markup) / 50) * 50;
    assumptions.push(note("as.no_price", { amount_usd: revenue }));
  }

  const options = [
    buildOption("A", "lowest_cost", a, ctx, revenue),
    buildOption("B", "fastest_transit", b, ctx, revenue),
    buildOption("C", "balanced", c, ctx, revenue),
  ];

  const marginOf = (o) => revenue - (o.profit_margin.carrier_freight_cost + o.profit_margin.container_rent_fee + o.profit_margin.port_fees);
  const ok = options.filter((o) => o.risk.deadline_risk !== "high");
  let recommendation;
  if (ok.length) {
    const best = [...ok].sort((x, y) => marginOf(y) - marginOf(x) || x.transit_days - y.transit_days)[0];
    recommendation = note("rec.best", { id: best.id, pct: round1((marginOf(best) / revenue) * 100), days: best.transit_days });
  } else {
    const best = [...options].sort((x, y) => x.transit_days - y.transit_days)[0];
    recommendation = note("rec.fastest", { id: best.id });
  }

  return {
    request: { ...request, volume_m3: volume, weight_kg: weight },
    revenue_source: revenueSource,
    assumptions,
    matrix: {
      offer_id: "draft",
      options,
      recommended: recommendation.params.id,
      recommendation_reason: renderNote(recommendation),
      recommendation_note: recommendation,
    },
  };
}
