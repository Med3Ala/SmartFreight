import { num, pct, t } from "../lib/i18n";
import { boxCount, ddPerDay, margin, money } from "../lib/matrix";

// Compares A/B/C on the numbers a forwarder decides on, marking the best value in each row.
export default function Glance({ matrix }) {
  const currency = matrix.options[0].profit_margin.currency;
  const rows = [
    { label: t("glance.margin"), get: (o) => margin(o.profit_margin).value, fmt: (v) => money(v, currency), best: "max" },
    { label: t("glance.marginPct"), get: (o) => margin(o.profit_margin).pct, fmt: (v) => pct(v), best: "max" },
    { label: t("glance.transit"), get: (o) => o.transit_days, fmt: (v) => t("glance.days", { n: v }), best: "min" },
    { label: t("glance.fill"), get: (o) => Number(o.equipment.utilization_pct), fmt: (v) => pct(v), best: "max" },
    { label: t("glance.boxes"), get: (o) => boxCount(o.equipment), fmt: (v) => num(v) },
    { label: t("glance.dd"), get: (o) => ddPerDay(o), fmt: (v) => money(v, currency), best: "min" },
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[480px] text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <th className="label px-4 py-2.5 text-start">{t("glance.title")}</th>
            {matrix.options.map((o) => (
              <th key={o.id} className="px-4 py-2.5 text-end font-display text-lg font-bold">
                <span className={o.id === matrix.recommended ? "text-accent" : ""}>{o.id}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const values = matrix.options.map(row.get);
            const present = values.filter((v) => v != null);
            const target = row.best === "max" ? Math.max(...present) : row.best === "min" ? Math.min(...present) : null;
            return (
              <tr key={row.label} className="border-b border-line last:border-0">
                <th className="px-4 py-2 text-start font-normal text-muted">{row.label}</th>
                {values.map((v, i) => (
                  <td
                    key={i}
                    className={`num px-4 py-2 text-end font-mono ${v === target ? "font-semibold text-good" : ""}`}
                  >
                    {v == null ? t("na") : row.fmt(v)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
