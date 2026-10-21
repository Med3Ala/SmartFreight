import { useCallback, useEffect, useMemo, useState } from "react";
import Arrow from "../components/Arrow";
import { loadTracking } from "../lib/api";
import { num, pct, t, time, useLang } from "../lib/i18n";
import useTheme from "../lib/useTheme";
import { ArrivalsChart, EmptiesChart, ReliabilityChart } from "./Charts";
import {
  CARRIER_ORDER,
  applyFilters,
  arrivalTime,
  carrierColor,
  fmtDate,
  fmtDays,
  insights,
  kpis,
  port,
} from "./model";
import TrackingMap from "./TrackingMap";

const PHASES = [
  { id: "all", label: "filter.all" },
  { id: "at_sea", label: "filter.atSea" },
  { id: "arrived", label: "filter.arrived" },
];

function Chip({ active, onClick, children, swatch }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium ${
        active ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink hover:border-muted"
      }`}
    >
      {swatch && <span className="inline-block size-2.5 rounded-sm" style={{ background: swatch }} />}
      {children}
    </button>
  );
}

function Kpi({ label, value, note, tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-surface px-4 py-3">
      <span className="label">{label}</span>
      <span className={`num font-display text-3xl leading-none font-bold ${tone ?? ""}`}>{num(value)}</span>
      <span className="text-[12px] text-muted">{note}</span>
    </div>
  );
}

function Insight({ item, kind, onSelect }) {
  const stripe = kind === "need" ? "border-warn" : item.tone === "accent" ? "border-accent" : "border-good";
  return (
    <li className={`flex flex-col gap-0.5 border-s-[3px] py-0.5 ps-3 ${stripe}`}>
      <span className="text-[13px] font-semibold">{item.title}</span>
      <span className="text-[13px] text-muted">{item.body}</span>
      {item.ref && (
        <button type="button" onClick={() => onSelect(item.ref)} className="self-start text-[12px] font-medium text-accent hover:underline">
          {t("ins.show")}
        </button>
      )}
    </li>
  );
}

function Insights({ data, onSelect }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-md border border-line bg-surface p-4 lg:max-h-[420px] lg:overflow-y-auto">
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold tracking-wide uppercase">
          <span className="rounded-full bg-warn-soft px-2 py-0.5 font-sans text-[11px] tracking-normal text-warn normal-case">
            {num(data.needs.length)}
          </span>
          {t("ins.needs")}
        </h3>
        {data.needs.length === 0 ? (
          <p className="text-[13px] text-muted">{t("ins.noNeeds")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.needs.map((n) => <Insight key={n.key} item={n} kind="need" onSelect={onSelect} />)}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold tracking-wide uppercase">
          <span className="rounded-full bg-good-soft px-2 py-0.5 font-sans text-[11px] tracking-normal text-good normal-case">
            {num(data.chances.length)}
          </span>
          {t("ins.chances")}
        </h3>
        {data.chances.length === 0 ? (
          <p className="text-[13px] text-muted">{t("ins.noChances")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.chances.map((c) => <Insight key={c.key} item={c} kind="chance" onSelect={onSelect} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

function PhasePill({ s }) {
  if (s.phase === "arrived") return <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted">{t("pill.arrived")}</span>;
  if (s.is_delayed) return <span className="rounded-full bg-bad-soft px-2 py-0.5 text-[11px] font-semibold text-bad">{t("pill.late")}</span>;
  return <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-semibold text-good">{t("pill.atSea")}</span>;
}

function ShipmentTable({ shipments, selected, onSelect, now }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-start">
            {["container", "carrier", "vessel", "route", "boxes", "when", "status"].map((h) => (
              <th key={h} className="label px-3 py-2.5 font-semibold">{t(`table.${h}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shipments.map((s) => {
            const at = arrivalTime(s);
            return (
              <tr
                key={s.container_number}
                onClick={() => onSelect(selected === s.container_number ? null : s.container_number)}
                className={`cursor-pointer border-b border-line last:border-0 hover:bg-sunken ${selected === s.container_number ? "bg-sunken" : ""}`}
              >
                <td className="px-3 py-2 font-mono">{s.container_number}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-2.5 rounded-sm" style={{ background: carrierColor(s.carrier) }} />
                    {s.carrier}
                  </span>
                </td>
                <td className="px-3 py-2">{s.vessel?.name ?? <span className="text-muted">{t("table.discharged")}</span>}</td>
                <td className="px-3 py-2">{port(s.origin)} <Arrow /> {port(s.destination)}</td>
                <td className="num px-3 py-2 font-mono">{num(s.containers.length)} × {s.containers[0]?.size_type ?? "?"}</td>
                <td className="num px-3 py-2 font-mono">
                  {fmtDate(s.ata || s.eta)} <span className="text-muted">({fmtDays(at - now)})</span>
                </td>
                <td className="px-3 py-2"><PhasePill s={s} /></td>
              </tr>
            );
          })}
          {shipments.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">{t("table.empty")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ s, onClose }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">{s.carrier} · {s.sealine}</div>
          <h3 className="font-mono text-lg font-medium">{s.container_number}</h3>
          <p className="text-[13px] text-muted">{s.origin} <Arrow /> {s.destination}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-sm border border-line px-2 py-1 text-[12px] hover:border-muted">
          {t("detail.close")}
        </button>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <div><dt className="text-muted">{t("detail.vessel")}</dt><dd>{s.vessel?.name ?? t("table.discharged")}</dd></div>
        <div><dt className="text-muted">{t("detail.imo")}</dt><dd className="font-mono">{s.vessel?.imo ?? t("na")}</dd></div>
        <div><dt className="text-muted">{s.ata ? t("detail.arrived") : t("detail.eta")}</dt><dd className="font-mono">{fmtDate(s.ata || s.eta, { day: "numeric", month: "short", year: "numeric" })}</dd></div>
        <div><dt className="text-muted">{t("detail.transit")}</dt><dd className="font-mono">{t("detail.transitDays", { n: s.total_days ?? "?" })}{s.remaining_days ? ` · ${t("detail.left", { n: s.remaining_days })}` : ""}</dd></div>
      </dl>
      <div className="flex flex-col gap-1.5">
        <h4 className="label">{t("detail.boxes")}</h4>
        <ul className="flex flex-wrap gap-1.5">
          {s.containers.map((c) => (
            <li key={c.number} className="rounded-sm border border-line px-2 py-0.5 font-mono text-[12px]">
              {c.number} <span className="text-muted">{c.iso_code}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <h4 className="label">{t("detail.events")}</h4>
        <ol className="flex flex-col">
          {s.events.map((e, i) => (
            <li key={i} className="grid grid-cols-[5.5rem_1rem_1fr] gap-2 text-[13px]">
              <span className="num pt-0.5 font-mono text-[12px] text-muted">{fmtDate(e.time)}</span>
              <span className="flex flex-col items-center">
                <span className={`mt-1.5 size-2.5 rounded-full border-2 ${e.is_actual ? "border-ink bg-ink" : "border-muted bg-surface"}`} />
                {i < s.events.length - 1 && <span className="w-px flex-1 bg-line" />}
              </span>
              <span className="pb-2">
                {e.description}
                <span className="text-muted">{[e.location, e.vessel].filter(Boolean).length ? ` · ${[e.location, e.vessel].filter(Boolean).join(" · ")}` : ""}</span>
                {!e.is_actual && <span className="text-muted"> {t("detail.planned")}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default function TrackingPage({ offer, matrix }) {
  const theme = useTheme();
  const { lang } = useLang();
  const [snapshot, setSnapshot] = useState(null);
  const [filters, setFilters] = useState({ carriers: new Set(), phase: "all", delayedOnly: false, port: "all", query: "" });
  const [selected, setSelected] = useState(null);
  const now = useMemo(() => Date.now(), [snapshot]);

  useEffect(() => {
    loadTracking().then(setSnapshot);
  }, []);

  const all = snapshot?.shipments ?? [];
  const shown = useMemo(() => applyFilters(all, filters), [all, filters]);
  const carriers = CARRIER_ORDER.filter((c) => all.some((s) => s.carrier === c));
  const ports = [...new Set(all.flatMap((s) => [port(s.origin), port(s.destination)]))].sort();
  const k = kpis(shown, now);
  const found = useMemo(() => insights(shown, now, { offer, matrix }), [shown, now, offer, matrix, lang]);
  const select = useCallback((id) => setSelected(id), []);
  const sel = shown.find((s) => s.container_number === selected);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const toggleCarrier = (c) =>
    setFilters((f) => {
      const next = new Set(f.carriers);
      next.has(c) ? next.delete(c) : next.add(c);
      return { ...f, carriers: next };
    });

  if (!snapshot) return <p className="py-8 text-muted">{t("track.loading")}</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="label">{t("track.eyebrow")}</div>
          <h1 className="font-display text-3xl leading-tight font-bold tracking-wide uppercase sm:text-4xl">{t("track.title")}</h1>
        </div>
        <span className="text-[12px] text-muted">
          {snapshot.source === "live" ? t("track.live") : t("track.example")}
          {" · "}
          {t("track.updated", { time: time(snapshot.generated_at) })}
        </span>
      </div>

      {snapshot.errors?.length > 0 && (
        <ul className="list-disc rounded-sm bg-bad-soft py-2 pe-3 ps-8 text-[13px] text-bad">
          {snapshot.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label me-1">{t("filter.carrier")}</span>
          <Chip active={filters.carriers.size === 0} onClick={() => set({ carriers: new Set() })}>{t("filter.all")}</Chip>
          {carriers.map((c) => (
            <Chip key={c} active={filters.carriers.has(c)} onClick={() => toggleCarrier(c)} swatch={carrierColor(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label me-1">{t("filter.status")}</span>
          {PHASES.map((p) => (
            <Chip key={p.id} active={filters.phase === p.id} onClick={() => set({ phase: p.id })}>{t(p.label)}</Chip>
          ))}
          <Chip active={filters.delayedOnly} onClick={() => set({ delayedOnly: !filters.delayedOnly })}>{t("filter.lateOnly")}</Chip>
          <label htmlFor="port-filter" className="label ms-2 me-1">{t("filter.port")}</label>
          <select
            id="port-filter"
            value={filters.port}
            onChange={(e) => set({ port: e.target.value })}
            className="rounded-sm border border-line bg-surface px-2 py-1 text-[13px]"
          >
            <option value="all">{t("filter.allPorts")}</option>
            {ports.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label htmlFor="track-search" className="sr-only">{t("filter.search")}</label>
          <input
            id="track-search"
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder={t("filter.search")}
            className="min-w-0 flex-1 basis-48 rounded-sm border border-line bg-surface px-2.5 py-1 text-[13px]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi.boxes")} value={k.boxes} note={t.plural("kpi.shipments", shown.length)} />
        <Kpi label={t("kpi.vessels")} value={k.vessels} note={t.plural("kpi.underWay", k.activeCount)} />
        <Kpi label={t("kpi.late")} value={k.delayed} note={k.activeCount ? t("kpi.lateShare", { pct: pct((k.delayed / k.activeCount) * 100, 0) }) : t("kpi.noActive")} tone={k.delayed ? "text-bad" : ""} />
        <Kpi label={t("kpi.soon")} value={k.arrivingSoon} note={t("kpi.soonNote")} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <TrackingMap shipments={shown} selected={sel ? selected : null} onSelect={select} theme={theme} lang={lang} />
          <p className="text-[12px] text-muted">{t("map.help")}</p>
        </div>
        <Insights data={found} onSelect={select} />
      </div>

      {sel && <Detail s={sel} onClose={() => setSelected(null)} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ArrivalsChart shipments={shown} now={now} />
        <ReliabilityChart shipments={shown} />
        <EmptiesChart shipments={shown} now={now} />
      </div>

      <ShipmentTable shipments={shown} selected={selected} onSelect={select} now={now} />
    </div>
  );
}
