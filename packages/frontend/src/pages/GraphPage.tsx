import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Skeleton } from "../components/Skeleton.js";
import { PageHeader } from "../components/PageHeader.js";
import type { Topic, WeaknessEvidence } from "../types/api.js";

const KnowledgeGraph = lazy(() =>
  import("../components/KnowledgeGraph.js").then((m) => ({
    default: m.KnowledgeGraph,
  })),
);

export function GraphPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [orphans, setOrphans] = useState<Topic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // P7.2: with curriculumV2 the graph shows the approved hard prerequisites only.
  const [hardOnly, setHardOnly] = useState(false);
  useEffect(() => {
    api
      .getFlags()
      .then((f) => setHardOnly(f.curriculumV2))
      .catch(() => setHardOnly(false));
  }, []);
  const [evidence, setEvidence] = useState<WeaknessEvidence | null>(null);
  const [studyMessage, setStudyMessage] = useState<string | null>(null);
  const [settingFocus, setSettingFocus] = useState(false);

  useEffect(() => {
    api
      .getTopics()
      .then((res) => setTopics(res.topics))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load topics"),
      );
    api
      .getOrphanTopics()
      .then((res) => setOrphans(res.orphans))
      .catch(() => setOrphans([]));
  }, []);

  const selected = selectedId ? topics.find((t) => t.id === selectedId) ?? null : null;

  const selectTopic = useCallback((topicId: string) => {
    setSelectedId(topicId);
    setStudyMessage(null);
    setEvidence(null);
    api
      .getWeaknessEvidence(topicId)
      .then(setEvidence)
      .catch(() => setEvidence(null));
  }, []);

  /** "Study this now" → pin as the curriculum's active topic. */
  const studyNow = async () => {
    if (!selectedId) return;
    setSettingFocus(true);
    setStudyMessage(null);
    try {
      await api.setCurriculumActiveTopic(selectedId);
      setStudyMessage(
        `${selected?.name ?? "Topic"} is now today's focus — head to the Today tab.`,
      );
    } catch (err) {
      setStudyMessage(err instanceof Error ? err.message : "Failed to set focus");
    } finally {
      setSettingFocus(false);
    }
  };

  const dueLabel = (t: Topic): string => {
    if (t.status === "Not started") return "not started yet";
    if (!t.nextRevisionAt) return "never revised — due now";
    const due = new Date(t.nextRevisionAt);
    return due.getTime() <= Date.now()
      ? `overdue since ${due.toLocaleDateString()}`
      : `due ${due.toLocaleDateString()}`;
  };

  return (
    <div className="page-content">
      <PageHeader
        title="Knowledge graph"
        subtitle="Topics as nodes — color shows mastery. Click a node for details."
      />
      {error && <div className="error-banner">{error}</div>}
      {orphans.length > 0 && (
        <div className="info-banner">
          {orphans.length} topic{orphans.length === 1 ? " has" : "s have"} no problems:{" "}
          {orphans.map((t) => t.name).join(", ")} — add some in Notion or run{" "}
          <code>pnpm db:suggest-problems</code>.
        </div>
      )}
      <div className={`graph-layout${selected ? " graph-layout--panel-open" : ""}`}>
        <Suspense
          fallback={
            <div className="card" aria-busy="true">
              <Skeleton variant="block" height={440} />
            </div>
          }
        >
          <KnowledgeGraph
            topics={topics}
            selectedId={selectedId}
            onNodeClick={selectTopic}
            hardPrerequisitesOnly={hardOnly}
          />
        </Suspense>

        {selected && (
          <aside className="panel-v2 graph-panel">
            <div className="graph-panel-header">
              <h3 className="card-title m-0">{selected.name}</h3>
              <button
                type="button"
                className="graph-panel-close"
                aria-label="Close panel"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </button>
            </div>

            <dl className="graph-panel-stats">
              <div>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{selected.confidence}/100</dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{dueLabel(selected)}</dd>
              </div>
              <div>
                <dt>Solved</dt>
                <dd>
                  {selected.problemsSolved} problem{selected.problemsSolved === 1 ? "" : "s"}
                </dd>
              </div>
            </dl>

            {evidence && evidence.analysis.signals.length > 0 && (
              <>
                <div className="graph-panel-label">Weakness signals</div>
                <ul className="graph-panel-signals">
                  {evidence.analysis.signals.map((s) => (
                    <li key={s.name}>{s.description}</li>
                  ))}
                </ul>
              </>
            )}
            {evidence && Object.keys(evidence.evidence.mistakeTagCounts).length > 0 && (
              <>
                <div className="graph-panel-label">Mistake tags</div>
                <div className="mistake-tag-chips">
                  {Object.entries(evidence.evidence.mistakeTagCounts).map(([tag, n]) => (
                    <span key={tag} className="mistake-tag-chip">
                      {tag} ×{n}
                    </span>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              className="btn-primary-v2 graph-study-btn"
              disabled={settingFocus}
              onClick={() => void studyNow()}
            >
              {settingFocus ? "Setting…" : "Study this topic"}
            </button>
            {studyMessage && (
              <p className="muted text-xs mt-2 mb-0">
                {studyMessage}
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
