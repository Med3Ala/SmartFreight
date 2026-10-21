import { STRATEGY_LABEL, boxCount, ddPerDay, isoCode, margin, money } from "../lib/matrix";

const RISK_STYLE = {
  low: "bg-good-soft text-good",
  medium: "bg-warn-soft text-warn",
  high: "bg-bad-soft text-bad",
};

export function RiskPill({ level }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_STYLE[level]}`}>
      {level[0].toUpperCase() + level.slice(1)} deadline risk
    </span>
  );
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h4 className="label">{title}</h4>
      {children}
    </section>
  );
}

function FormulaRow({ label, value, currency, op, swatch, strong }) {
  return (
    <div className={`grid grid-cols-[1rem_1fr_auto] items-baseline gap-2 ${strong ? "font-semibold" : ""}`}>
      <span className="font-mono text-muted">{op}</span>
      <span className="flex items-center gap-2">
        {swatch && <span className={`inline-block size-2.5 shrink-0 rounded-sm ${swatch}`} />}
        {label}
      </span>
      <span className="num font-mono">{money(value, currency)}</span>
    </div>
  );
}

function MarginFormula({ pm }) {
  const m = margin(pm);
  const pct = (v) => `${Math.max(0, (v / m.revenue) * 100)}%`;
  return (
    <Section title="Profit margin formula">
      <div className="flex flex-col gap-1.5 text-[13px]">
        <FormulaRow label="Client revenue" value={m.revenue} currency={pm.currency} />
        <FormulaRow op="−" label="Carrier freight" value={m.freight} currency={pm.currency} swatch="bg-freight" />
        <FormulaRow op="−" label="Container rent" value={m.rent} currency={pm.currency} swatch="bg-rent" />
        <FormulaRow op="−" label="Port fees" value={m.port} currency={pm.currency} swatch="bg-port" />
        <div className="my-1 border-t border-dashed border-line" />
        <FormulaRow
          op="="
          label="Profit margin"
          value={m.value}
          currency={pm.currency}
          swatch={m.value >= 0 ? "bg-good" : "bg-bad"}
          strong
        />
      </div>
      {/* One bar = client revenue, split into what each cost takes and what is left. */}
      <div className="flex h-2.5 overflow-hidden rounded-sm bg-sunken" role="img"
        aria-label={`Costs take ${(100 - m.pct).toFixed(0)}% of revenue`}>
        <span className="bg-freight" style={{ width: pct(m.freight) }} />
        <span className="bg-rent" style={{ width: pct(m.rent) }} />
        <span className="bg-port" style={{ width: pct(m.port) }} />
        <span className="bg-good" style={{ width: pct(m.value) }} />
      </div>
    </Section>
  );
}

function Equipment({ equipment }) {
  const util = Number(equipment.utilization_pct);
  return (
    <Section title="Equipment configuration">
      <ul className="flex flex-col gap-2">
        {equipment.containers.map((c, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="num font-mono font-medium">{c.count} ×</span>
            <span className="font-medium">
              {c.size} {c.type}
            </span>
            {isoCode(c) && (
              <span className="rounded-sm border border-line px-1 font-mono text-[11px] text-muted">{isoCode(c)}</span>
            )}
            <span className="w-full pl-7 text-[13px] text-muted">
              {c.provider}
              {c.leased ? " · leased" : " · carrier-owned"}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[13px]">
          <span className="text-muted">Cargo fill (bin packing)</span>
          <span className="num font-mono">{util.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-ink" style={{ width: `${util}%` }} />
        </div>
      </div>
      <p className="text-[13px] text-muted">
        Carriers: <span className="text-ink">{equipment.carriers.join(" + ")}</span>
      </p>
    </Section>
  );
}

function Risk({ option, currency }) {
  const r = option.risk;
  const dd = ddPerDay(option);
  const days = (v) => (v == null ? "n/a" : `${v} days`);
  return (
    <Section title="Risk analysis">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div>
          <dt className="text-muted">Free time, origin</dt>
          <dd className="num font-mono">{days(r.origin_free_days)}</dd>
        </div>
        <div>
          <dt className="text-muted">Free time, destination</dt>
          <dd className="num font-mono">{days(r.destination_free_days)}</dd>
        </div>
        <div>
          <dt className="text-muted">Detention / box / day</dt>
          <dd className="num font-mono">{money(r.detention_fee_per_day, currency)}</dd>
        </div>
        <div>
          <dt className="text-muted">Demurrage / box / day</dt>
          <dd className="num font-mono">{money(r.demurrage_fee_per_day, currency)}</dd>
        </div>
      </dl>
      {dd != null && (
        <p className="rounded-sm bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Each day past free time costs <strong className="num font-mono">{money(dd, currency)}</strong> across{" "}
          {boxCount(option.equipment)} boxes.
        </p>
      )}
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] marker:text-muted">
        {r.pitfalls.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </Section>
  );
}

export default function OptionCard({ option, recommended }) {
  const pm = option.profit_margin;
  const m = margin(pm);
  return (
    <article
      className={`flex min-w-0 flex-col gap-4 rounded-md border bg-surface p-5 ${
        recommended ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line"
      }`}
    >
      <header className="flex items-start gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-sm font-display text-3xl leading-none font-bold ${
            recommended ? "bg-accent text-surface" : "bg-ink text-surface"
          }`}
        >
          {option.id}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl leading-tight font-semibold tracking-wide uppercase">
              {STRATEGY_LABEL[option.strategy]}
            </h3>
            {recommended && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">Recommended</span>
            )}
          </div>
          <p className="text-[13px] text-muted">{option.summary}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Margin</div>
          <div className={`num font-display text-4xl leading-none font-bold ${m.value >= 0 ? "text-good" : "text-bad"}`}>
            {money(m.value, pm.currency)}
          </div>
          <div className="num mt-1 font-mono text-[13px] text-muted">{m.pct?.toFixed(1)}% of revenue</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="num font-mono text-sm">
            <strong className="text-lg">{option.transit_days}</strong> days transit
          </span>
          <RiskPill level={option.risk.deadline_risk} />
        </div>
      </div>

      <MarginFormula pm={pm} />
      <Equipment equipment={option.equipment} />
      <Risk option={option} currency={pm.currency} />
    </article>
  );
}
