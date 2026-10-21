import { useEffect, useState } from "react";
import CheckAnswer from "./components/CheckAnswer";
import Glance from "./components/Glance";
import OptionCard from "./components/OptionCard";
import { loadDashboard } from "./lib/api";

const SOURCE = {
  live: { label: "Live API", cls: "bg-good-soft text-good" },
  example: { label: "Example data", cls: "bg-warn-soft text-warn" },
  agent: { label: "Pasted agent answer", cls: "bg-accent-soft text-accent" },
};

function Fact({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="label">{label}</dt>
      <dd className="num text-[15px] font-medium">{children}</dd>
    </div>
  );
}

function OfferPanel({ offer }) {
  const c = offer.cargo_details;
  const deadline = new Date(offer.deadline);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="label">Client offer · {offer.client_name}</div>
          <h1 className="font-display text-3xl leading-tight font-bold tracking-wide uppercase sm:text-4xl">
            {offer.origin_port} <span className="text-accent">→</span> {offer.destination_port}
          </h1>
        </div>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold capitalize">
          {offer.status}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label="Cargo">{c.commodity}</Fact>
        <Fact label="Weight / volume">
          <span className="font-mono">
            {(c.weight_kg / 1000).toFixed(1)} t · {c.volume_m3} m³
          </span>
        </Fact>
        <Fact label="Hazmat">{c.hazmat ? "Yes, IMDG declared" : "No"}</Fact>
        <Fact label="Deliver by">
          <span className="font-mono">
            {deadline.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </Fact>
      </dl>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState(null);

  useEffect(() => {
    loadDashboard().then(setData);
  }, []);

  if (!data) {
    return <p className="p-8 text-muted">Loading the Best Formula Matrix…</p>;
  }

  const { offer, matrix, source } = data;
  const rec = matrix.options.find((o) => o.id === matrix.recommended);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3 pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))] py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl font-bold tracking-wider uppercase">SmartFreight</span>
            <span className="hidden text-[13px] text-muted sm:inline">Best Formula Matrix</span>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SOURCE[source].cls}`}>
            {SOURCE[source].label}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1240px] flex-col gap-6 pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))] py-6">
        <OfferPanel offer={offer} />

        {rec && (
          <p className="max-w-[80ch] text-[15px]">
            <strong className="text-accent">Recommended: Option {rec.id}.</strong> {matrix.recommendation_reason}
          </p>
        )}

        <Glance matrix={matrix} />

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {matrix.options.map((o) => (
            <OptionCard key={o.id} option={o} recommended={o.id === matrix.recommended} />
          ))}
        </div>

        <CheckAnswer current={matrix} onLoad={(m) => setData({ offer, matrix: m, source: "agent" })} />

        <footer className="pb-4 text-[12px] text-muted">
          Profit margin = client revenue − (carrier freight + container rent + port fees). D&amp;D is detention plus
          demurrage charged per box for each day past free time.
        </footer>
      </main>
    </div>
  );
}
