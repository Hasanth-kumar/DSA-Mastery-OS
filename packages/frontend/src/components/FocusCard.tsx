import type { FocusPlan } from "../types/api.js";

interface Props {
  focus: FocusPlan;
}

const KIND_LABEL: Record<FocusPlan["blocks"][number]["kind"], string> = {
  resolve: "Re-solve",
  learn: "New problem",
  log: "Log",
};

/** Time-boxed plan for today: what to do, in order, and how the week is going. */
export function FocusCard({ focus }: Props) {
  const { week } = focus;
  const pct = week.target > 0 ? Math.min(100, Math.round((week.done / week.target) * 100)) : 0;

  return (
    <section className={`focus-plan focus-plan--${focus.mode}`} aria-label="Today's plan">
      <header className="focus-plan-head">
        <div>
          <h2 className="focus-plan-title">{focus.headline}</h2>
          <p className="focus-plan-reason">{focus.reason}</p>
        </div>
        {focus.totalMinutes > 0 && <span className="chip-v2">{focus.totalMinutes} min</span>}
      </header>

      {focus.blocks.length > 0 && (
        <ol className="focus-plan-blocks">
          {focus.blocks.map((b, i) => (
            <li key={`${b.kind}-${b.problemId ?? i}`} className="focus-plan-block">
              <span className="focus-plan-min">{b.minutes}m</span>
              <div className="focus-plan-body">
                <div className="focus-plan-block-title">
                  <span className="focus-plan-kind">{KIND_LABEL[b.kind]}</span>
                  {b.leetcodeLink ? (
                    <a href={b.leetcodeLink} target="_blank" rel="noreferrer">
                      {b.title}
                    </a>
                  ) : (
                    <span>{b.title}</span>
                  )}
                  {b.difficulty && <span className="focus-plan-diff">{b.difficulty}</span>}
                </div>
                <p className="focus-plan-instruction">{b.instruction}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="focus-plan-week">
        <div className="focus-plan-week-bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="focus-plan-week-label">
          {week.done}/{week.target} this week · {week.daysLeft} day{week.daysLeft === 1 ? "" : "s"} left
          {week.onTrack ? "" : " · behind pace"}
        </span>
      </div>

      {focus.tip && (
        <div className="focus-plan-tip">
          <strong>
            Most repeated mistake: {focus.tip.tag.replace(/-/g, " ")} ({focus.tip.count}×). Before you submit:
          </strong>
          <ul>
            {focus.tip.checklist.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
