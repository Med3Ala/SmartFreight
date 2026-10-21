import { boxCount, ddPerDay, margin, money } from "../lib/matrix";

// Compares A/B/C on the numbers a forwarder decides on, marking the best value in each row.
export default function Glance({ matrix }) {
  const currency = matrix.options[0].profit_margin.currency;
  const rows = [
    { label: "Profit margin", get: (o) => margin(o.profit_margin).value, fmt: (v) => money(v, currency), best: "max" },
    { label: "Margin %", get: (o) => margin(o.profit_margin).pct, fmt: (v) => `${v.toFixed(1)}%`, best: "max" },
    { label: "Transit", get: (o) => o.transit_days, fmt: (v) => `${v} d`, best: "min" },
    { label: "Cargo fill", get: (o) => Number(o.equipment.utilization_pct), fmt: (v) => `${v.toFixed(1)}%`, best: "max" },
    { label: "Boxes", get: (o) => boxCount(o.equipment), fmt: (v) => String(v) },
    { label: "D&D per late day", get: (o) => ddPerDay(o), fmt: (v) => money(v, currency), best: "min" },
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[480px] text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <th className="label px-4 py-2.5 text-left">At a glance</th>
            {matrix.options.map((o) => (
              <th key={o.id} className="px-4 py-2.5 text-right font-display text-lg font-bold">
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
                <th className="px-4 py-2 text-left font-normal text-muted">{row.label}</th>
                {values.map((v, i) => (
                  <td
                    key={i}
                    className={`num px-4 py-2 text-right font-mono ${v === target ? "font-semibold text-good" : ""}`}
                  >
                    {v == null ? "n/a" : row.fmt(v)}
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
