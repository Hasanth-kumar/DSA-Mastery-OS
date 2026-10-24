import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Sidebar, type AppTab } from "./components/Sidebar.js";
import { SkeletonPage } from "./components/Skeleton.js";
import { useAppPreferences } from "./hooks/useAppPreferences.js";
import { useLiveEvents } from "./hooks/useLiveEvents.js";
import { useNavMeta } from "./hooks/useNavMeta.js";

const TodayPage = lazy(() =>
  import("./pages/TodayPage.js").then((m) => ({ default: m.TodayPage })),
);
const OverviewPage = lazy(() =>
  import("./pages/OverviewPage.js").then((m) => ({ default: m.OverviewPage })),
);
const CoachingPage = lazy(() =>
  import("./pages/CoachingPage.js").then((m) => ({ default: m.CoachingPage })),
);
const GraphPage = lazy(() =>
  import("./pages/GraphPage.js").then((m) => ({ default: m.GraphPage })),
);
const ActivityPage = lazy(() =>
  import("./pages/ActivityPage.js").then((m) => ({ default: m.ActivityPage })),
);
const SessionPage = lazy(() =>
  import("./pages/SessionPage.js").then((m) => ({ default: m.SessionPage })),
);
const ReviewPage = lazy(() =>
  import("./pages/ReviewPage.js").then((m) => ({ default: m.ReviewPage })),
);
const ResolvePage = lazy(() =>
  import("./pages/ResolvePage.js").then((m) => ({ default: m.ResolvePage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage.js").then((m) => ({ default: m.SettingsPage })),
);

const SHORTCUTS: { key: string; action: string }[] = [
  { key: "s", action: "Start session (Today)" },
  { key: "l", action: "Log / mark done (Today)" },
  { key: "c", action: "Focus coach chat" },
  { key: "t", action: "Toggle light / dark mode" },
  { key: "?", action: "Toggle this help" },
  { key: "space", action: "Show answer (Review)" },
  { key: "1–4", action: "Grade card: Again / Hard / Good / Easy (Review)" },
  { key: "s", action: "Suspend card (Review)" },
  { key: "e", action: "Edit card (Review)" },
];

export function App() {
  const [tab, setTab] = useState<AppTab>("today");
  const [coachAnchorId, setCoachAnchorId] = useState<string | null>(null);
  // P5.2: opened from a row whose pattern is hidden — the coach keeps it hidden.
  const [coachHidePattern, setCoachHidePattern] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { theme, toggleTheme, accentGlow } = useAppPreferences();
  const navMeta = useNavMeta(tab, coachAnchorId);
  const shortcutsModalRef = useRef<HTMLDivElement>(null);
  const shortcutsReturnFocusRef = useRef<HTMLElement | null>(null);
  useLiveEvents();

  useEffect(() => {
    if (showShortcuts) {
      shortcutsReturnFocusRef.current = document.activeElement as HTMLElement | null;
      shortcutsModalRef.current?.focus();
    } else {
      shortcutsReturnFocusRef.current?.focus();
      shortcutsReturnFocusRef.current = null;
    }
  }, [showShortcuts]);

  const trapShortcutsFocus = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const focusables = shortcutsModalRef.current?.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    if (!focusables || focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const onContainer = document.activeElement === shortcutsModalRef.current;
    if (e.shiftKey && (onContainer || document.activeElement === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const selectTab = useCallback((id: AppTab) => {
    setTab(id);
  }, []);

  const openCoach = useCallback(
    (problemId: string, options?: { hidePattern?: boolean }) => {
      setCoachAnchorId(problemId || null);
      setCoachHidePattern(options?.hidePattern === true);
      selectTab("coach");
    },
    [selectTab],
  );

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      } else if (e.key === "Escape") {
        setShowShortcuts(false);
      } else if (e.key === "s") {
        e.preventDefault();
        selectTab("today");
        window.dispatchEvent(new CustomEvent("dsa:start-session"));
      } else if (e.key === "l") {
        e.preventDefault();
        selectTab("today");
        window.dispatchEvent(new CustomEvent("dsa:focus-done"));
      } else if (e.key === "c") {
        e.preventDefault();
        selectTab("coach");
      } else if (e.key === "t") {
        e.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectTab, toggleTheme]);

  return (
    <div className={`app-shell-v2${tab === "coach" ? " coach-active" : ""}`}>
      <Sidebar
        tab={tab}
        meta={navMeta}
        theme={theme}
        onSelect={selectTab}
        onToggleTheme={toggleTheme}
        onOpenShortcuts={() => setShowShortcuts(true)}
      />

      <main className="main">
        {accentGlow && <div className="main-accent-glow" aria-hidden />}
        <Suspense fallback={<SkeletonPage />}>
          {tab === "coach" ? (
            <CoachingPage anchorProblemId={coachAnchorId} anchorHidePattern={coachHidePattern} />
          ) : (
            <div key={tab} className="page-transition">
              {tab === "today" && <TodayPage onOpenCoach={openCoach} />}
              {tab === "overview" && <OverviewPage />}
              {tab === "review" && <ReviewPage />}
              {tab === "resolve" && <ResolvePage />}
              {tab === "graph" && <GraphPage />}
              {tab === "activity" && <ActivityPage />}
              {tab === "session" && <SessionPage />}
              {tab === "settings" && <SettingsPage />}
            </div>
          )}
        </Suspense>
      </main>

      {showShortcuts && (
        <div className="shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
          <div
            ref={shortcutsModalRef}
            className="shortcuts-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapShortcutsFocus}
          >
            <div className="shortcuts-modal-header">
              <h3 id="shortcuts-title" className="modal-title">
                Keyboard shortcuts
              </h3>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Close shortcuts"
                onClick={() => setShowShortcuts(false)}
              >
                ✕
              </button>
            </div>
            <ul>
              {SHORTCUTS.map((s) => (
                <li key={`${s.key}-${s.action}`}>
                  <kbd>{s.key}</kbd>
                  <span>{s.action}</span>
                </li>
              ))}
            </ul>
            <p className="muted text-xs m-0">
              Press <kbd>Esc</kbd> or click outside to close.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
