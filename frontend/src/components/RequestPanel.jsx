import { useMemo, useState } from "react";
import TARIFFS from "../../../shared/freight-tariffs.json";
import { t, tNote } from "../lib/i18n";
import { parseRequest } from "../planner/parse";
import { plan } from "../planner/plan";

const PORTS = Object.keys(TARIFFS.ports).sort();
const CODES = Object.keys(TARIFFS.equipment);
const todayIso = () => new Date().toISOString().slice(0, 10);

const portLabel = (name) => `${name}, ${TARIFFS.ports[name].country}`;

// What the offer panel above the matrix shows for a planned request.
export function offerFrom(request) {
  return {
    id: "draft",
    client_name: request.client || t("req.unnamed"),
    origin_port: portLabel(request.origin),
    destination_port: portLabel(request.destination),
    cargo_details: {
      weight_kg: request.weight_kg,
      volume_m3: request.volume_m3,
      commodity: request.commodity || t("req.generalCargo"),
      hazmat: request.hazmat,
    },
    deadline: request.deadline,
    status: "optimized",
  };
}

function Field({ label, htmlFor, missing, children, wide }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <label htmlFor={htmlFor} className={`label ${missing ? "text-bad" : ""}`}>
        {label}
        {missing && ` · ${t("req.needed")}`}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-sm border border-line bg-surface px-2 py-1.5 text-[13px] text-ink";

function Understood({ request, missing, onChange }) {
  const set = (patch) => onChange({ ...request, ...patch });
  const numOrNull = (v) => (v === "" ? null : Number(v));
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold tracking-wide uppercase">{t("req.understood")}</h3>
        <span className="text-[12px] text-muted">{t("req.editHint")}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("req.origin")} htmlFor="req-origin" missing={missing.includes("origin")}>
          <select id="req-origin" className={inputCls} value={request.origin ?? ""} onChange={(e) => set({ origin: e.target.value || null })}>
            <option value="">{t("req.choosePort")}</option>
            {PORTS.map((p) => <option key={p} value={p}>{portLabel(p)}</option>)}
          </select>
        </Field>
        <Field label={t("req.destination")} htmlFor="req-destination" missing={missing.includes("destination")}>
          <select id="req-destination" className={inputCls} value={request.destination ?? ""} onChange={(e) => set({ destination: e.target.value || null })}>
            <option value="">{t("req.choosePort")}</option>
            {PORTS.map((p) => <option key={p} value={p}>{portLabel(p)}</option>)}
          </select>
        </Field>
        <Field label={t("req.weight")} htmlFor="req-weight" missing={missing.includes("quantity")}>
          <input id="req-weight" type="number" min="0" className={inputCls} value={request.weight_kg ?? ""} onChange={(e) => set({ weight_kg: numOrNull(e.target.value) })} />
        </Field>
        <Field label={t("req.volume")} htmlFor="req-volume" missing={missing.includes("quantity")}>
          <input id="req-volume" type="number" min="0" step="0.1" className={inputCls} value={request.volume_m3 ?? ""} onChange={(e) => set({ volume_m3: numOrNull(e.target.value) })} />
        </Field>
        <Field label={t("req.deadline")} htmlFor="req-deadline">
          <input id="req-deadline" type="date" className={inputCls} value={request.deadline ?? ""} onChange={(e) => set({ deadline: e.target.value || null })} />
        </Field>
        <Field label={t("req.price")} htmlFor="req-price">
          <div className="flex gap-1.5">
            <input
              id="req-price"
              type="number"
              min="0"
              className={inputCls}
              value={request.price?.amount ?? ""}
              onChange={(e) => set({ price: e.target.value === "" ? null : { amount: Number(e.target.value), currency: request.price?.currency ?? "USD" } })}
            />
            <select
              aria-label={t("req.currency")}
              className="rounded-sm border border-line bg-surface px-1.5 text-[13px]"
              value={request.price?.currency ?? "USD"}
              onChange={(e) => request.price && set({ price: { ...request.price, currency: e.target.value } })}
            >
              {Object.keys(TARIFFS.fx_usd).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </Field>
        <Field label={t("req.client")} htmlFor="req-client">
          <input id="req-client" className={inputCls} value={request.client} onChange={(e) => set({ client: e.target.value })} />
        </Field>
        <Field label={t("req.commodity")} htmlFor="req-commodity">
          <input id="req-commodity" className={inputCls} value={request.commodity} onChange={(e) => set({ commodity: e.target.value })} />
        </Field>
        <Field label={t("req.boxes")} htmlFor="req-box-add" wide>
          <div className="flex flex-wrap items-center gap-1.5">
            {request.containers.map((c, i) => (
              <span key={c.code} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 font-mono text-[12px]">
                {c.count} × {c.code}
                <button
                  type="button"
                  aria-label={t("req.removeBox", { box: c.code })}
                  className="text-muted hover:text-bad"
                  onClick={() => set({ containers: request.containers.filter((_, k) => k !== i) })}
                >
                  ×
                </button>
              </span>
            ))}
            <select
              id="req-box-add"
              className="rounded-sm border border-line bg-surface px-1.5 py-1 text-[12px]"
              value=""
              onChange={(e) => {
                const code = e.target.value;
                if (!code) return;
                const existing = request.containers.find((c) => c.code === code);
                set({
                  containers: existing
                    ? request.containers.map((c) => (c.code === code ? { ...c, count: c.count + 1 } : c))
                    : [...request.containers, { code, count: 1 }],
                });
              }}
            >
              <option value="">{request.containers.length ? t("req.addBox") : t("req.autoBoxes")}</option>
              {CODES.map((c) => <option key={c} value={c}>+ {c}</option>)}
            </select>
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={request.reefer} onChange={(e) => set({ reefer: e.target.checked })} />
            {t("req.reefer")}
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={request.hazmat} onChange={(e) => set({ hazmat: e.target.checked })} />
            {t("req.hazmat")}
          </label>
        </div>
      </div>
    </div>
  );
}

// Paste a client's request, press OK, and get options A, B and C. Fields can be corrected and the plan updates.
export default function RequestPanel({ onPlan }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);

  const missing = useMemo(() => {
    if (!parsed) return [];
    const m = [];
    if (!parsed.origin) m.push("origin");
    if (!parsed.destination) m.push("destination");
    if (!parsed.weight_kg && !parsed.volume_m3 && !parsed.containers.length) m.push("quantity");
    return m;
  }, [parsed]);

  function update(request) {
    setParsed(request);
    const ok = request.origin && request.destination && (request.weight_kg || request.volume_m3 || request.containers.length);
    if (ok) {
      const result = plan(request, todayIso());
      onPlan(offerFrom(result.request), result.matrix, result.assumptions);
    }
  }

  function submit(e) {
    e.preventDefault();
    update(parseRequest(text, todayIso()).request);
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl leading-tight font-bold tracking-wide uppercase">{t("req.title")}</h2>
        <p className="max-w-[70ch] text-[13px] text-muted">{t("req.help")}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="client-request" className="sr-only">{t("req.label")}</label>
        <textarea
          id="client-request"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("req.placeholder")}
          className="w-full rounded-sm border border-line bg-sunken p-3 text-[14px] text-ink"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!text.trim()} className="rounded-sm bg-accent px-5 py-2 text-[14px] font-semibold text-surface disabled:opacity-40">
            {t("req.ok")}
          </button>
          <button type="button" onClick={() => setText(t("req.example"))} className="text-[13px] font-medium text-accent hover:underline">
            {t("req.tryExample")}
          </button>
          {parsed && missing.length > 0 && <span className="text-[13px] text-bad">{t("req.missing")}</span>}
        </div>
      </form>
      {parsed && <Understood request={parsed} missing={missing} onChange={update} />}
    </section>
  );
}

export function Assumptions({ notes }) {
  if (!notes?.length) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-sm bg-warn-soft py-2.5 pe-3 ps-7 text-[13px] text-warn list-disc">
      {notes.map((n, i) => <li key={i}>{tNote(n)}</li>)}
    </ul>
  );
}
