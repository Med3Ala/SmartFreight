import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import CASES from "../../../../shared/plan-cases.json";
import INPUTS from "../../../../shared/plan-cases.input.json";
import { plan } from "../plan";

// The fields the Python planner must reproduce exactly (backend/tests/test_planner.py reads the same file).
export function snapshot(result) {
  const m = result.matrix;
  return {
    revenue_source: result.revenue_source,
    assumptions: result.assumptions.map((a) => a.code),
    recommended: m.recommended,
    options: m.options.map((o) => ({
      id: o.id,
      transit_days: o.transit_days,
      freight: o.profit_margin.carrier_freight_cost,
      rent: o.profit_margin.container_rent_fee,
      port: o.profit_margin.port_fees,
      revenue: o.profit_margin.client_revenue,
      carriers: o.equipment.carriers,
      boxes: o.equipment.containers.map((c) => `${c.count} ${c.size} ${c.type} ${c.provider}${c.leased ? " leased" : ""}`),
      utilization_pct: o.equipment.utilization_pct,
      deadline_risk: o.risk.deadline_risk,
      pitfalls: o.risk.pitfall_notes.map((n) => n.code),
    })),
  };
}

if (process.env.UPDATE_PLAN_CASES) {
  const cases = INPUTS.map((c) => ({ ...c, expect: snapshot(plan(c.request, c.today)) }));
  writeFileSync(new URL("../../../../shared/plan-cases.json", import.meta.url), JSON.stringify(cases, null, 1) + "\n");
}

describe("shared plan cases", () => {
  for (const c of CASES) {
    test(c.name, () => expect(snapshot(plan(c.request, c.today))).toEqual(c.expect));
  }
});

describe("planner rules", () => {
  const margin = (o) =>
    o.profit_margin.client_revenue - o.profit_margin.carrier_freight_cost - o.profit_margin.container_rent_fee - o.profit_margin.port_fees;
  const total = (o) => o.profit_margin.carrier_freight_cost + o.profit_margin.container_rent_fee + o.profit_margin.port_fees;

  test.each(INPUTS.map((c) => [c.name, c]))("%s: A is cheapest, B is fastest, boxes hold the cargo", (_, c) => {
    const r = plan(c.request, c.today);
    const [a, b, cc] = r.matrix.options;
    expect(total(a)).toBeLessThanOrEqual(total(b));
    expect(total(a)).toBeLessThanOrEqual(total(cc));
    expect(b.transit_days).toBeLessThanOrEqual(a.transit_days);
    expect(b.transit_days).toBeLessThanOrEqual(cc.transit_days);
    for (const o of r.matrix.options) {
      expect(o.equipment.utilization_pct).toBeLessThanOrEqual(100);
      expect(o.risk.pitfalls.length).toBeGreaterThan(0);
      expect(margin(o)).toBe(o.profit_margin.client_revenue - total(o));
    }
  });

  test("recommends the best margin among options that meet the deadline", () => {
    const r = plan(INPUTS[0].request, INPUTS[0].today);
    const ok = r.matrix.options.filter((o) => o.risk.deadline_risk !== "high");
    const best = ok.reduce((x, y) => (margin(y) > margin(x) ? y : x));
    expect(r.matrix.recommended).toBe(best.id);
  });
});
