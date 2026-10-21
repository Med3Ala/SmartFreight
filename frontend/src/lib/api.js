import demo from "../demo.json";
import demoTracking from "../demoTracking.json";
import { checkOffline } from "./matrix";

async function getJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

// Loads the first offer and its matrix from the API, or falls back to the bundled example.
export async function loadDashboard() {
  try {
    const offers = await getJson("/api/offers");
    if (!offers.ok || !offers.body?.length) throw new Error("no offers");
    const offer = offers.body[0];
    const matrix = await getJson(`/api/offers/${encodeURIComponent(offer.id)}/matrix`);
    if (!matrix.ok) throw new Error("no matrix");
    return { offer, matrix: matrix.body, source: "live" };
  } catch {
    return { offer: demo.offers[0], matrix: demo.matrix, source: "example" };
  }
}

// Returns { matrix } or { errors }.
export async function checkAnswer(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { errors: [`That isn't valid JSON: ${e.message}`] };
  }
  try {
    const res = await getJson("/api/matrix/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (res.ok) return { matrix: res.body };
    if (res.status === 422 && res.body?.detail) {
      return { errors: res.body.detail.map((d) => `${d.loc.slice(1).join(" › ")}: ${d.msg}`) };
    }
    throw new Error("api unavailable");
  } catch {
    const errors = checkOffline(parsed);
    return errors.length ? { errors } : { matrix: parsed, offline: true };
  }
}

// Shifts the bundled example so its ETAs stay relative to today.
function shiftExample(snapshot) {
  const offset = Date.now() - Date.parse(snapshot.generated_at);
  const move = (iso) => (iso ? new Date(Date.parse(iso) + offset).toISOString() : iso);
  return {
    ...snapshot,
    shipments: snapshot.shipments.map((s) => ({
      ...s,
      eta: move(s.eta),
      ata: move(s.ata),
      last_synced_at: move(s.last_synced_at),
      events: s.events.map((e) => ({ ...e, time: move(e.time) })),
    })),
  };
}

export async function loadTracking() {
  try {
    const res = await getJson("/api/tracking");
    if (!res.ok || !Array.isArray(res.body?.shipments)) throw new Error("no tracking");
    return res.body.source === "example" ? shiftExample(res.body) : res.body;
  } catch {
    return shiftExample(demoTracking);
  }
}
