import { useEffect, useState } from "react";
import CheckAnswer from "./components/CheckAnswer";
import Glance from "./components/Glance";
import Arrow from "./components/Arrow";
import OptionCard from "./components/OptionCard";
import RequestPanel, { Assumptions } from "./components/RequestPanel";
import { loadDashboard } from "./lib/api";
import { LANGUAGES, date, num, t, tNote, useLang } from "./lib/i18n";
import TrackingPage from "./tracking/TrackingPage";

const VIEWS = ["matrix", "tracking"];
const viewFromHash = () => (location.hash === "#tracking" ? "tracking" : "matrix");

const SOURCE_STYLE = {
  live: "bg-good-soft text-good",
  example: "bg-warn-soft text-warn",
  agent: "bg-accent-soft text-accent",
  planned: "bg-accent-soft text-accent",
};

function LanguageSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label={t("nav.language")} className="flex rounded-sm border border-line p-0.5">
      {LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          lang={l.id}
          title={l.name}
          aria-label={l.name}
          aria-pressed={lang === l.id}
          onClick={() => setLang(l.id)}
          className={`min-w-8 rounded-[3px] px-2 py-0.5 text-[12px] font-semibold ${
            lang === l.id ? "bg-ink text-surface" : "text-muted hover:text-ink"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

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
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="label">{t("offer.client", { client: offer.client_name })}</div>
          <h1 className="font-display text-3xl leading-tight font-bold tracking-wide uppercase sm:text-4xl">
            {offer.origin_port} <span className="text-accent"><Arrow /></span> {offer.destination_port}
          </h1>
        </div>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold">
          {t(`offer.status.${offer.status}`)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label={t("offer.cargo")}>{c.commodity}</Fact>
        <Fact label={t("offer.weightVolume")}>
          <span className="font-mono">
            {num(c.weight_kg / 1000, { maximumFractionDigits: 1 })} t · {num(c.volume_m3)} m³
          </span>
        </Fact>
        <Fact label={t("offer.hazmat")}>{c.hazmat ? t("offer.hazmatYes") : t("offer.hazmatNo")}</Fact>
        <Fact label={t("offer.deadline")}>
          <span className="font-mono">
            {date(offer.deadline, { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </Fact>
      </dl>
    </section>
  );
}

export default function App() {
  useLang(); // re-render everything when the language changes
  const [data, setData] = useState(null);
  const [view, setView] = useState(viewFromHash);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    loadDashboard().then(setData);
  }, []);

  if (!data) {
    return <p className="p-8 text-muted">{t("loading.matrix")}</p>;
  }

  const { offer, matrix, source } = data;
  const rec = matrix.options.find((o) => o.id === matrix.recommended);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3 pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))] py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-display text-xl font-bold tracking-wider uppercase">SmartFreight</span>
            <nav className="flex gap-1" aria-label={t("nav.views")}>
              {VIEWS.map((v) => (
                <a
                  key={v}
                  href={`#${v}`}
                  onClick={() => setView(v)}
                  aria-current={view === v ? "page" : undefined}
                  className={`rounded-sm px-2.5 py-1 text-[13px] font-medium whitespace-nowrap ${
                    view === v ? "bg-sunken text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {t(`nav.${v}`)}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {view === "matrix" && (
              <span className={`hidden rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline ${SOURCE_STYLE[source]}`}>
                {t(`source.${source}`)}
              </span>
            )}
            <LanguageSwitch />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1240px] flex-col gap-6 pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))] py-6">
        {view === "tracking" ? (
          <TrackingPage offer={offer} matrix={matrix} />
        ) : (
          <>
            <RequestPanel onPlan={(o, m, assumptions) => setData({ offer: o, matrix: m, source: "planned", assumptions })} />

            <OfferPanel offer={offer} />

            {rec && (
              <p className="max-w-[80ch] text-[15px]">
                <strong className="text-accent">{t("matrix.recommended", { id: rec.id })}</strong> {matrix.recommendation_note ? tNote(matrix.recommendation_note) : matrix.recommendation_reason}
              </p>
            )}

            <Assumptions notes={data.assumptions} />

            <Glance matrix={matrix} />

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
              {matrix.options.map((o) => (
                <OptionCard key={o.id} option={o} recommended={o.id === matrix.recommended} />
              ))}
            </div>

            <CheckAnswer current={matrix} onLoad={(m) => setData({ offer, matrix: m, source: "agent" })} />

            <footer className="pb-4 text-[12px] text-muted">
              {t("matrix.footer")}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
