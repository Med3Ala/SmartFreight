import { useState } from "react";
import { checkAnswer } from "../lib/api";
import { t } from "../lib/i18n";

// Paste a raw agent answer to check it against the Best Formula Matrix contract and view it.
export default function CheckAnswer({ current, onLoad }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const r = await checkAnswer(text);
    setBusy(false);
    setResult(r);
    if (r.matrix) onLoad(r.matrix);
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold tracking-wide uppercase">{t("check.title")}</h2>
        <button
          type="button"
          className="text-[13px] font-medium text-accent underline-offset-2 hover:underline"
          onClick={() => setText(JSON.stringify(current, null, 2))}
        >
          {t("check.fill")}
        </button>
      </div>
      <p className="max-w-[65ch] text-[13px] text-muted">
        {t("check.help")}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="agent-answer" className="sr-only">
          {t("check.label")}
        </label>
        <textarea
          id="agent-answer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder='{ "offer_id": "…", "options": [ … ], "recommended": "C", "recommendation_reason": "…" }'
          dir="ltr"
          className="w-full rounded-sm border border-line bg-sunken p-3 font-mono text-[12px] text-ink"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="rounded-sm bg-ink px-4 py-2 text-[13px] font-semibold text-surface disabled:opacity-40"
          >
            {busy ? t("check.busy") : t("check.submit")}
          </button>
          {result?.matrix && (
            <span className="text-[13px] text-good">
              {result.offline ? t("check.validOffline") : t("check.valid")}
            </span>
          )}
        </div>
      </form>
      {result?.errors && (
        <ul className="flex list-disc flex-col gap-1 rounded-sm bg-bad-soft py-3 pe-3 ps-8 text-[13px] text-bad">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
