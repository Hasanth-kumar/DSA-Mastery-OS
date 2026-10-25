import { useState } from "react";
import {
  HELP_LEVEL_LABELS,
  HELP_LEVELS,
  HELP_SOURCE_LABELS,
  MISTAKE_TAG_LABELS,
  MISTAKE_TAGS,
} from "@dsa/intelligence";
import { api } from "../api/client.js";
import type { HelpLevel, HelpSource } from "../types/api.js";

interface Props {
  attemptId: string;
  problemName: string;
  /** Auto-captured coach usage — pre-selects Hint from the in-app coach. */
  usedCoach?: boolean;
  /**
   * P6.1: the row's pattern was hidden. Ask "Which pattern did you use?"
   * first, with these patterns as the options, then reveal the real one.
   */
  guessOptions?: { id: string; name: string }[];
  /** P6.2: show the one-line takeaway field. */
  takeawayField?: boolean;
  onDone: (tagged: boolean) => void;
}

const HELP_SOURCES = Object.keys(HELP_SOURCE_LABELS) as HelpSource[];

/**
 * Post-solve capture with help levels (P6.1, `helpLevelCapture`): optional
 * pattern guess → mistake tags → help level and source → optional takeaway.
 * Tap-only except the one-line takeaway; "Smooth ✓" stays a one-tap exit.
 */
export function MistakeCaptureV2({
  attemptId,
  problemName,
  usedCoach,
  guessOptions,
  takeawayField,
  onDone,
}: Props) {
  const [reveal, setReveal] = useState<{ name: string | null; correct: boolean } | null>(null);
  const [guessing, setGuessing] = useState(false);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [help, setHelp] = useState<HelpLevel>(usedCoach ? "hint" : "none");
  const [source, setSource] = useState<HelpSource | null>(usedCoach ? "coach" : null);
  const [takeaway, setTakeaway] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askPattern = guessOptions != null && reveal == null;

  const guess = async (value: string) => {
    if (guessing) return;
    setGuessing(true);
    setError(null);
    try {
      const res = await api.guessPattern(attemptId, value);
      setReveal({ name: res.topicName, correct: res.correct });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the guess");
    } finally {
      setGuessing(false);
    }
  };

  const toggleTag = (tag: string) =>
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const save = async (smooth: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const list = smooth ? [] : [...tags];
    try {
      await api.setMistake(attemptId, {
        tags: list,
        // Smooth = no mistakes; the help answer still counts.
        helpLevel: help,
        ...(help !== "none" && source ? { helpSource: source } : {}),
        ...(takeawayField && takeaway.trim() ? { takeaway: takeaway.trim() } : {}),
      });
      onDone(list.length > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  if (askPattern) {
    return (
      <div className="mistake-capture">
        <div className="mistake-capture-question">
          Which pattern did you use on <strong>{problemName}</strong>?
        </div>
        <div className="mistake-capture-options">
          {guessOptions.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn mistake-tag-btn"
              disabled={guessing}
              onClick={() => void guess(t.id)}
            >
              {t.name}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost mistake-tag-btn"
            disabled={guessing}
            onClick={() => void guess("unsure")}
          >
            Not sure
          </button>
        </div>
        {error && <div className="error-banner mt-2">{error}</div>}
      </div>
    );
  }

  return (
    <div className="mistake-capture">
      {reveal && (
        <div className="mistake-capture-reveal">
          {reveal.name ? (
            <>
              It was <strong>{reveal.name}</strong>
              {reveal.correct ? " — you spotted it." : "."}
            </>
          ) : (
            "This problem has no pattern recorded."
          )}
        </div>
      )}
      <div className="mistake-capture-question">
        Anything trip you up on <strong>{problemName}</strong>?
      </div>
      <div className="mistake-capture-options">
        {MISTAKE_TAGS.map((tag) => {
          const active = tags.has(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`btn mistake-tag-btn${active ? " mistake-tag-btn--active" : ""}`}
              aria-pressed={active}
              disabled={saving}
              onClick={() => toggleTag(tag)}
            >
              {active ? "✓ " : ""}
              {MISTAKE_TAG_LABELS[tag]}
            </button>
          );
        })}
      </div>

      <div className="rsv-complete-label mistake-capture-row-label">Help</div>
      <div className="mistake-capture-options" role="radiogroup" aria-label="Help needed">
        {HELP_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={help === level}
            className={`btn mistake-tag-btn${help === level ? " mistake-tag-btn--active" : ""}`}
            disabled={saving}
            onClick={() => setHelp(level)}
          >
            {HELP_LEVEL_LABELS[level]}
          </button>
        ))}
      </div>

      {help !== "none" && (
        <>
          <div className="rsv-complete-label mistake-capture-row-label">From</div>
          <div className="mistake-capture-options" role="radiogroup" aria-label="Help source">
            {HELP_SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                className={`btn mistake-tag-btn${source === s ? " mistake-tag-btn--active" : ""}`}
                disabled={saving}
                onClick={() => setSource(s)}
              >
                {HELP_SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
        </>
      )}

      {takeawayField && (
        <input
          type="text"
          className="mistake-capture-takeaway"
          placeholder="One line: what tripped you up, or the invariant (optional)"
          maxLength={200}
          value={takeaway}
          disabled={saving}
          onChange={(e) => setTakeaway(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save(false);
          }}
          aria-label="Takeaway"
        />
      )}

      <div className="mistake-capture-actions">
        <button
          type="button"
          className="btn btn-ghost mistake-tag-btn"
          disabled={saving}
          onClick={() => void save(true)}
          title="No mistakes — save now"
        >
          Smooth ✓
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save(false)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <div className="error-banner mt-2">{error}</div>}
    </div>
  );
}
