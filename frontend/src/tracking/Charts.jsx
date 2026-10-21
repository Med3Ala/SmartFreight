import { useState } from "react";
import { CARRIER_ORDER, arrivalsByDay, carrierColor, carrierReliability, emptiesPipeline, sizeMix } from "./model";

function Panel({ title, note, children, legend }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-display text-lg leading-tight font-semibold tracking-wide uppercase">{title}</h3>
        {note && <p className="text-[12px] text-muted">{note}</p>}
      </div>
      {legend}
      {children}
    </section>
  );
}

export function CarrierLegend({ carriers }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
      {carriers.map((c) => (
        <li key={c} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: carrierColor(c) }} />
          {c}
        </li>
      ))}
    </ul>
  );
}

// Stacked bars: boxes due per day, by carrier.
export function ArrivalsChart({ shipments, now }) {
  const [hover, setHover] = useState(null);
  const days = arrivalsByDay(shipments, now);
  const carriers = CARRIER_ORDER.filter((c) => days.some((d) => d.byCarrier[c]));
  const max = Math.max(4, ...days.map((d) => Object.values(d.byCarrier).reduce((a, b) => a + b, 0)));
  const top = Math.ceil(max / 2) * 2;
  const W = 420, H = 180, padL = 26, padB = 22, padT = 8;
  const bw = (W - padL) / days.length;
  const y = (v) => H - padB - (v / top) * (H - padB - padT);
  const ticks = [0, top / 2, top];

  return (
    <Panel
      title="Arrivals, next 14 days"
      note="Boxes due each day. Plan trucks, customs and free time around the peaks."
      legend={carriers.length > 1 && <CarrierLegend carriers={carriers} />}
    >
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Boxes arriving per day by carrier">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)" className="num">
                {t}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            let base = 0;
            const x = padL + i * bw + 3;
            const segs = CARRIER_ORDER.filter((c) => d.byCarrier[c]);
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={padL + i * bw} y={padT} width={bw} height={H - padB - padT} fill={hover === i ? "var(--sunken)" : "transparent"} />
                {segs.map((c, k) => {
                  const v = d.byCarrier[c];
                  const y0 = y(base);
                  const y1 = y(base + v);
                  base += v;
                  const isTop = k === segs.length - 1;
                  return (
                    <rect key={c} x={x} y={y1 + (isTop ? 0 : 1)} width={bw - 6} height={Math.max(0, y0 - y1 - (isTop ? 0 : 1) - (k === 0 ? 0 : 1))}
                      rx={isTop ? 2 : 0} fill={carrierColor(c)} />
                  );
                })}
                {i % 2 === 0 && (
                  <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)" className="num">
                    {d.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={padL} x2={W} y1={H - padB} y2={H - padB} stroke="var(--muted)" strokeWidth="1" />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-sm border border-line bg-surface px-2.5 py-2 text-[12px] shadow-sm"
            style={{ left: `${Math.min(70, ((padL + hover * bw) / W) * 100)}%` }}
          >
            <div className="font-semibold">{days[hover].date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
            {Object.keys(days[hover].byCarrier).length === 0 && <div className="text-muted">No arrivals</div>}
            {CARRIER_ORDER.filter((c) => days[hover].byCarrier[c]).map((c) => (
              <div key={c} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm" style={{ background: carrierColor(c) }} />
                  {c}
                </span>
                <span className="num font-mono">{days[hover].byCarrier[c]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

// On-time vs late shipments per carrier.
export function ReliabilityChart({ shipments }) {
  const rows = carrierReliability(shipments);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Panel title="Carrier reliability" note="Tracked shipments on time vs flagged late. Few shipments make this a hint, not a verdict.">
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.carrier} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-[13px]">
            <span className="flex items-center gap-1.5 truncate">
              <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: carrierColor(r.carrier) }} />
              {r.carrier}
            </span>
            <span className="flex h-2.5 gap-[2px]" title={`${r.total - r.late} on time, ${r.late} late`}>
              <span className="rounded-l-sm bg-ink/70" style={{ width: `${((r.total - r.late) / max) * 100}%` }} />
              {r.late > 0 && <span className="rounded-r-sm bg-bad" style={{ width: `${(r.late / max) * 100}%` }} />}
            </span>
            <span className="num font-mono text-[12px] text-muted">
              {r.total - r.late}/{r.total} on time
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-ink/70" />On time</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-bad" />Late</span>
      </div>
    </Panel>
  );
}

// Where equipment is about to become available.
export function EmptiesChart({ shipments, now }) {
  const rows = emptiesPipeline(shipments, now);
  const max = Math.max(1, ...rows.map((r) => r.landed + r.due));
  return (
    <Panel title="Empties pipeline" note="Boxes discharged in the last 5 days or due in the next 10. These turn into empty equipment near the port.">
      {rows.length === 0 && <p className="text-[13px] text-muted">No boxes landing in this window.</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.port} className="flex flex-col gap-1 text-[13px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{r.port}</span>
              <span className="num font-mono text-[12px] text-muted">{sizeMix(r.shipments)}</span>
            </div>
            <span className="flex h-2.5 gap-[2px]" title={`${r.landed} landed, ${r.due} due`}>
              {r.landed > 0 && <span className="rounded-sm bg-good" style={{ width: `${(r.landed / max) * 100}%` }} />}
              {r.due > 0 && <span className="rounded-sm bg-good/40" style={{ width: `${(r.due / max) * 100}%` }} />}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-good" />Landed</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-good/40" />Due</span>
      </div>
    </Panel>
  );
}
