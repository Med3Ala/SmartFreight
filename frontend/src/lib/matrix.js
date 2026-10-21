// Helpers for reading a Best Formula Matrix as served by the backend.

export const STRATEGY_LABEL = {
  lowest_cost: "Lowest cost",
  fastest_transit: "Fastest transit",
  balanced: "Balanced",
};

// ISO 6346 size-type codes for the boxes the agent typically proposes.
const ISO_CODES = {
  "20ft|Dry Van": "22G1",
  "40ft|Dry Van": "42G1",
  "40ft|High Cube Dry Van": "45G1",
  "45ft|High Cube Dry Van": "L5G1",
  "20ft|Reefer": "22R1",
  "40ft|Reefer": "42R1",
  "40ft|High Cube Reefer": "45R1",
  "20ft|Open Top": "22U1",
  "40ft|Open Top": "42U1",
  "20ft|Flat Rack": "22P1",
  "40ft|Flat Rack": "42P1",
};

export const isoCode = (line) => ISO_CODES[`${line.size}|${line.type}`];

const n = (v) => (v === null || v === undefined ? null : Number(v));

// Profit Margin = Client Revenue - (Carrier Freight Cost + Container Rent Fee + Port Fees).
// The backend computes this too; we recompute so answers checked offline read the same.
export function margin(pm) {
  const revenue = n(pm.client_revenue);
  const freight = n(pm.carrier_freight_cost);
  const rent = n(pm.container_rent_fee);
  const port = n(pm.port_fees);
  const totalCost = freight + rent + port;
  const value = revenue - totalCost;
  return { revenue, freight, rent, port, totalCost, value, pct: revenue ? (value / revenue) * 100 : null };
}

export const boxCount = (equipment) => equipment.containers.reduce((sum, c) => sum + c.count, 0);

// Detention + demurrage for every box, per day past free time.
export function ddPerDay(option) {
  const { detention_fee_per_day: det, demurrage_fee_per_day: dem } = option.risk;
  if (det == null && dem == null) return null;
  return (n(det) ?? 0) * boxCount(option.equipment) + (n(dem) ?? 0) * boxCount(option.equipment);
}

export function money(value, currency, { sign = false } = {}) {
  if (value === null || value === undefined) return "n/a";
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  return sign && value > 0 ? `+${s}` : s;
}

// Mirrors the backend contract for when the API is not running.
export function checkOffline(m) {
  const errors = [];
  if (!m || !Array.isArray(m.options)) return ["The answer has no options list."];
  const ids = m.options.map((o) => o.id).join(",");
  if (ids !== "A,B,C") errors.push(`Options must be exactly A, B and C in that order (got ${ids || "none"}).`);
  const expected = { A: "lowest_cost", B: "fastest_transit", C: "balanced" };
  for (const o of m.options) {
    if (expected[o.id] && o.strategy !== expected[o.id]) errors.push(`Option ${o.id} must use strategy ${expected[o.id]}.`);
    if (!o.profit_margin) errors.push(`Option ${o.id} is missing its profit margin.`);
    if (!o.equipment?.containers?.length) errors.push(`Option ${o.id} lists no containers.`);
    if (!o.risk?.pitfalls?.length) errors.push(`Option ${o.id} has no risk pitfalls.`);
  }
  const currencies = new Set(m.options.map((o) => o.profit_margin?.currency));
  if (currencies.size > 1) errors.push("All options must use the same currency.");
  if (!["A", "B", "C"].includes(m.recommended)) errors.push("Recommended must be A, B or C.");
  return errors;
}
