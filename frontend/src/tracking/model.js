// Reading the tracking snapshot: carrier identity, date windows, and the needs/chances insights.

import { date, num, t } from "../lib/i18n";
import { money } from "../lib/matrix";

// Fixed carrier order so a carrier keeps its colour whatever the filters show.
export const CARRIER_ORDER = ["Maersk", "MSC", "CMA CGM", "Hapag-Lloyd", "COSCO", "ONE", "Evergreen"];

export function carrierColor(carrier) {
  const i = CARRIER_ORDER.indexOf(carrier);
  return i === -1 ? "var(--muted)" : `var(--carrier-${i + 1})`;
}

export const DAY = 86_400_000;
export const port = (place) => (place || "").split(",")[0].trim();
export const boxes = (s) => s.containers.length || 1;
export const arrivalTime = (s) => Date.parse(s.ata || s.eta);

export const fmtDate = date;

export function fmtDays(ms) {
  const d = Math.round(ms / DAY);
  if (d === 0) return t("when.today");
  return d > 0 ? t("when.in", { n: d }) : t("when.ago", { n: -d });
}

export function sizeMix(shipments) {
  const mix = {};
  for (const s of shipments) for (const c of s.containers) mix[c.size_type] = (mix[c.size_type] || 0) + 1;
  return Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .map(([size, n]) => `${num(n)} × ${size}`)
    .join(", ");
}

// Matrix equipment ("40ft" + "High Cube Dry Van") to the size type carriers report ("40HC").
export function sizeTypeOf(line) {
  const ft = line.size.replace("ft", "");
  const type = line.type.toLowerCase();
  if (type.includes("reefer")) return `${ft}${type.includes("high cube") ? "RH" : "RF"}`;
  if (type.includes("high cube")) return `${ft}HC`;
  if (type.includes("open top")) return `${ft}OT`;
  if (type.includes("flat")) return `${ft}FR`;
  return `${ft}DV`;
}

export function applyFilters(shipments, f) {
  const q = f.query.trim().toLowerCase();
  return shipments.filter(
    (s) =>
      (f.carriers.size === 0 || f.carriers.has(s.carrier)) &&
      (f.phase === "all" || s.phase === f.phase) &&
      (!f.delayedOnly || s.is_delayed) &&
      (f.port === "all" || port(s.destination) === f.port || port(s.origin) === f.port) &&
      (!q ||
        [s.container_number, s.vessel?.name, s.origin, s.destination, ...s.containers.map((c) => c.number)]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q))),
  );
}

export function kpis(shipments, now) {
  const active = shipments.filter((s) => s.phase !== "arrived");
  return {
    boxes: shipments.reduce((n, s) => n + boxes(s), 0),
    vessels: new Set(active.map((s) => s.vessel?.name).filter(Boolean)).size,
    delayed: active.filter((s) => s.is_delayed).length,
    activeCount: active.length,
    arrivingSoon: active.filter((s) => arrivalTime(s) - now <= 7 * DAY).reduce((n, s) => n + boxes(s), 0),
  };
}

// Boxes per day over the next `days` days, split by carrier.
export function arrivalsByDay(shipments, now, days = 14) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, (_, i) => ({ date: new Date(start.getTime() + i * DAY), byCarrier: {} }));
  for (const s of shipments) {
    if (s.phase === "arrived") continue;
    const i = Math.floor((arrivalTime(s) - start) / DAY);
    if (i < 0 || i >= days) continue;
    buckets[i].byCarrier[s.carrier] = (buckets[i].byCarrier[s.carrier] || 0) + boxes(s);
  }
  return buckets;
}

export function carrierReliability(shipments) {
  const rows = {};
  for (const s of shipments) {
    const r = (rows[s.carrier] ||= { carrier: s.carrier, total: 0, late: 0 });
    r.total += 1;
    if (s.is_delayed) r.late += 1;
  }
  return Object.values(rows).sort((a, b) => CARRIER_ORDER.indexOf(a.carrier) - CARRIER_ORDER.indexOf(b.carrier));
}

// Boxes landing per port: already discharged in the last 5 days, or due within the next 10.
export function emptiesPipeline(shipments, now) {
  const rows = {};
  for (const s of shipments) {
    const at = arrivalTime(s);
    const landed = s.phase === "arrived" && now - at <= 5 * DAY;
    const due = s.phase !== "arrived" && at - now <= 10 * DAY;
    if (!landed && !due) continue;
    const p = port(s.destination);
    const r = (rows[p] ||= { port: p, landed: 0, due: 0, shipments: [] });
    r[landed ? "landed" : "due"] += boxes(s);
    r.shipments.push(s);
  }
  return Object.values(rows).sort((a, b) => b.landed + b.due - (a.landed + a.due));
}

// Plain-language needs (act now) and chances (opportunities) from the tracked fleet and the open offer.
export function insights(shipments, now, { offer, matrix } = {}) {
  const needs = [];
  const chances = [];

  for (const s of shipments.filter((s) => s.is_delayed && s.phase !== "arrived")) {
    needs.push({
      key: `late-${s.container_number}`,
      title: t("ins.late.title", { carrier: s.carrier, port: port(s.destination) }),
      body: t("ins.late.body", { container: s.container_number, vessel: s.vessel?.name ?? t("ins.its"), date: fmtDate(s.eta) }),
      ref: s.container_number,
    });
  }

  const soon = {};
  for (const s of shipments) {
    if (s.phase === "arrived" || arrivalTime(s) - now > 3 * DAY) continue;
    (soon[port(s.destination)] ||= []).push(s);
  }
  for (const [p, list] of Object.entries(soon)) {
    needs.push({
      key: `soon-${p}`,
      title: t.plural("ins.soon.title", list.reduce((n, s) => n + boxes(s), 0), { port: p }),
      body: t("ins.soon.body", { mix: sizeMix(list), port: p }),
    });
  }

  for (const r of carrierReliability(shipments)) {
    if (r.total >= 2 && r.late / r.total >= 0.5) {
      needs.push({
        key: `rel-${r.carrier}`,
        title: t("ins.unreliable.title", { carrier: r.carrier, late: r.late, total: r.total }),
        body: t("ins.unreliable.body", { carrier: r.carrier }),
      });
    } else if (r.total >= 2 && r.late === 0) {
      chances.push({
        key: `rel-${r.carrier}`,
        title: t("ins.reliable.title", { carrier: r.carrier, total: r.total }),
        body: t("ins.reliable.body"),
      });
    }
  }

  // Boxes landing where the open offer loads can replace leased equipment (a street turn).
  if (offer && matrix) {
    const origin = port(offer.origin_port).replace(/^Port of /, "");
    const deadline = Date.parse(offer.deadline);
    const needed = new Set(matrix.options.flatMap((o) => o.equipment.containers.filter((c) => c.leased).map(sizeTypeOf)));
    const leasedRent = matrix.options.find((o) => o.id === "A")?.profit_margin;
    const matches = shipments.filter(
      (s) =>
        port(s.destination) === origin &&
        arrivalTime(s) <= deadline &&
        now - arrivalTime(s) <= 5 * DAY &&
        s.containers.some((c) => needed.has(c.size_type)),
    );
    if (matches.length) {
      const n = matches.reduce((k, s) => k + s.containers.filter((c) => needed.has(c.size_type)).length, 0);
      chances.push({
        key: "street-turn",
        title: t.plural("ins.street.title", n, { port: origin, client: offer.client_name }),
        body:
          t("ins.street.body", { mix: sizeMix(matches), carriers: [...new Set(matches.map((s) => s.carrier))].join(", ") }) +
          (leasedRent ? t("ins.street.rent", { amount: money(Number(leasedRent.container_rent_fee), leasedRent.currency) }) : ""),
        tone: "accent",
      });
    }
  }

  for (const r of emptiesPipeline(shipments, now)) {
    const n = r.landed + r.due;
    if (n < 3) continue;
    chances.push({
      key: `empties-${r.port}`,
      title: t("ins.empties.title", { n, port: r.port }),
      body: t("ins.empties.body", { mix: sizeMix(r.shipments), port: r.port }),
    });
  }

  return { needs, chances };
}
