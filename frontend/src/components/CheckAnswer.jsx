import { useState } from "react";
import { checkAnswer } from "../lib/api";

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
        <h2 className="font-display text-xl font-semibold tracking-wide uppercase">Check an agent answer</h2>
        <button
          type="button"
          className="text-[13px] font-medium text-accent underline-offset-2 hover:underline"
          onClick={() => setText(JSON.stringify(current, null, 2))}
        >
          Fill with the matrix shown above
        </button>
      </div>
      <p className="max-w-[65ch] text-[13px] text-muted">
        Paste the JSON the agent returned. It must hold exactly options A, B and C, each with the margin inputs,
        equipment and risk analysis. A valid answer replaces the matrix above.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="agent-answer" className="sr-only">
          Agent answer JSON
        </label>
        <textarea
          id="agent-answer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder='{ "offer_id": "…", "options": [ … ], "recommended": "C", "recommendation_reason": "…" }'
          className="w-full rounded-sm border border-line bg-sunken p-3 font-mono text-[12px] text-ink"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="rounded-sm bg-ink px-4 py-2 text-[13px] font-semibold text-surface disabled:opacity-40"
          >
            {busy ? "Checking…" : "Check answer"}
          </button>
          {result?.matrix && (
            <span className="text-[13px] text-good">
              Valid. Showing it above{result.offline ? " (checked in the browser; the API isn't running)" : ""}.
            </span>
          )}
        </div>
      </form>
      {result?.errors && (
        <ul className="flex list-disc flex-col gap-1 rounded-sm bg-bad-soft py-3 pr-3 pl-8 text-[13px] text-bad">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
