import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api/client.js";
import { CoachMarkdown } from "../components/CoachMarkdown.js";
import { CoachMessageActions } from "../components/CoachMessageActions.js";
import { consumeChatStream, IncompleteChatStreamError } from "../lib/chatStream.js";
import type { ChatMessage, CoachModel, HealthInfo, Problem } from "../types/api.js";

const THREAD_STORAGE_KEY = "dsa-coach-thread-id";
const MODEL_STORAGE_KEY = "dsa-coach-model-id";
const EXPANDED_STORAGE_KEY = "dsa-coach-composer-expanded";
const STREAMING_ID = "__streaming__";
/** Mirrors the backend truncation threshold (LLMService.ts USER_MESSAGE_MAX_CHARS, A3). */
const TRUNCATION_WARN_CHARS = 24_000;

interface Props {
  /** Pre-anchor the chat to a problem (1.2) — set when arriving from Today. */
  anchorProblemId?: string | null;
  /** P5.2: the anchor came from a hidden-pattern row on Today. */
  anchorHidePattern?: boolean;
}

interface CoachRequestOptions {
  problemId?: string;
  includeContext: boolean;
  hidePattern?: boolean;
  directMode: boolean;
  model?: string;
}

const STARTER_PROMPTS = [
  "Why is BFS better than DFS for shortest path in an unweighted graph?",
  "Walk me through how to approach interval merging problems.",
  "What am I weak at this week and how should I practice?",
];

function visibleStarterPrompts(input: string): string[] {
  const query = input.trim().toLowerCase();
  if (!query) return STARTER_PROMPTS;
  return STARTER_PROMPTS.filter((p) => p.toLowerCase().startsWith(query));
}

function CoachIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1L2 4.5v5L8 13l6-3.5v-5L8 1zm0 2.2l3.8 2.2L8 7.6 4.2 5.4 8 3.2zM3.5 6.8L7 8.7V11L3.5 9V6.8zm5 4.2V8.7l3.5-1.9V9L8.5 11z" />
    </svg>
  );
}

function CoachAvatar() {
  return (
    <div className="coach-msg-avatar" aria-hidden>
      <CoachIcon />
    </div>
  );
}

function CoachGenerating() {
  return (
    <div
      className="coach-generating"
      role="status"
      aria-live="polite"
      aria-label="Coach is generating a response"
    >
      <div className="coach-thinking" aria-hidden>
        <span /><span /><span />
      </div>
      <span className="coach-generating-label">Coach is thinking…</span>
    </div>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="white" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="13" x2="8" y2="3" />
      <polyline points="4,7 8,3 12,7" />
    </svg>
  );
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="10,2 10,6 14,6" />
      <polyline points="6,14 6,10 2,10" />
      <line x1="10" y1="6" x2="14" y2="2" />
      <line x1="6" y1="10" x2="2" y2="14" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6,2 2,2 2,6" />
      <polyline points="10,14 14,14 14,10" />
      <line x1="2" y1="2" x2="6" y2="6" />
      <line x1="14" y1="14" x2="10" y2="10" />
    </svg>
  );
}

function ScrollDownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="3" x2="8" y2="13" />
      <polyline points="4,9 8,13 12,9" />
    </svg>
  );
}

export function CoachingPage({ anchorProblemId, anchorHidePattern }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problemId, setProblemId] = useState("");
  const [models, setModels] = useState<CoachModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [directMode, setDirectMode] = useState(false);
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(EXPANDED_STORAGE_KEY) === "true",
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmDown, setLlmDown] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (anchorProblemId) setProblemId(anchorProblemId);
  }, [anchorProblemId]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getFullHealth()
      .then((health: HealthInfo) => {
        if (!cancelled) setLlmDown(health.services?.llm.status === "down");
      })
      .catch(() => {
        /* health probe is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const anchoredProblem = problemId
    ? problems.find((p) => p.id === problemId) ?? null
    : null;

  const coachOptions = (): CoachRequestOptions => ({
    problemId: problemId || undefined,
    includeContext,
    // Only while still anchored to the hidden row itself.
    hidePattern: anchorHidePattern && problemId !== "" && problemId === anchorProblemId ? true : undefined,
    directMode,
    model: modelId || undefined,
  });

  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
    setShowScrollBtn(distanceFromBottom >= 120);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    stickToBottomRef.current = true;
    setShowScrollBtn(false);
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .getCoachModels()
      .then(({ models: available, defaultModelId }) => {
        if (cancelled) return;
        setModels(available);
        const saved = localStorage.getItem(MODEL_STORAGE_KEY);
        const initial =
          saved && available.some((m) => m.id === saved) ? saved : defaultModelId;
        setModelId(initial);
      })
      .catch(() => {
        /* picker is best-effort; coach falls back to the default model */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleModelChange = (id: string) => {
    setModelId(id);
    localStorage.setItem(MODEL_STORAGE_KEY, id);
  };

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
      return next;
    });
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.getProblems();
        setProblems(res.problems);
        const savedId = sessionStorage.getItem(THREAD_STORAGE_KEY);
        if (savedId) {
          const thread = await api.getChatThread(savedId);
          setThreadId(thread.threadId);
          setMessages(thread.messages);
        }
      } catch (err) {
        sessionStorage.removeItem(THREAD_STORAGE_KEY);
        setError(err instanceof Error ? err.message : "Failed to load coach");
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToBottom(loading ? "auto" : "smooth");
  }, [messages, loading, scrollToBottom]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const cap = window.innerHeight * (expanded ? 0.7 : 0.4);
    ta.style.height = `${Math.min(ta.scrollHeight, cap)}px`;
  }, [input, expanded]);

  useEffect(() => {
    if (!editingId) return;
    const ta = editTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [editingId, editDraft]);

  const streamPendingRef = useRef("");
  const streamRafRef = useRef<number | null>(null);

  /** Drain buffered chunks into the streaming message (shared by flush + RAF). */
  const drainPendingChunks = useCallback(() => {
    const pending = streamPendingRef.current;
    if (!pending) return;
    streamPendingRef.current = "";
    setMessages((prev) =>
      prev.map((m) =>
        m.id === STREAMING_ID ? { ...m, content: m.content + pending } : m,
      ),
    );
  }, []);

  const flushPendingStreamChunks = useCallback(() => {
    if (streamRafRef.current != null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    drainPendingChunks();
  }, [drainPendingChunks]);

  const appendStreamChunk = useCallback(
    (text: string) => {
      streamPendingRef.current += text;
      if (streamRafRef.current != null) return;
      streamRafRef.current = requestAnimationFrame(() => {
        streamRafRef.current = null;
        drainPendingChunks();
      });
    },
    [drainPendingChunks],
  );

  const syncThreadAfterAbort = useCallback(async (activeThreadId: string | null) => {
    if (!activeThreadId) {
      setMessages((prev) =>
        prev.filter((m) => m.id !== STREAMING_ID && !m.id.startsWith("pending-")),
      );
      return;
    }
    try {
      const thread = await api.getChatThread(activeThreadId);
      setMessages(thread.messages);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== STREAMING_ID));
    }
  }, []);

  const runStream = useCallback(
    async (
      path: string,
      body: Record<string, unknown>,
      setupMessages: () => void,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      stickToBottomRef.current = true;
      setLoading(true);
      setError(null);
      setEditingId(null);
      setupMessages();

      let activeThreadId = threadId;

      try {
        const result = await consumeChatStream({
          path,
          body,
          signal: controller.signal,
          onMeta: (tid, userMessage) => {
            flushPendingStreamChunks();
            activeThreadId = tid;
            setThreadId(tid);
            sessionStorage.setItem(THREAD_STORAGE_KEY, tid);
            setMessages((prev) => {
              const withoutPending = prev.filter((m) => !m.id.startsWith("pending-"));
              const streaming =
                withoutPending.find((m) => m.id === STREAMING_ID) ??
                ({
                  id: STREAMING_ID,
                  role: "assistant" as const,
                  content: "",
                  createdAt: new Date().toISOString(),
                } satisfies ChatMessage);
              const base = withoutPending.filter(
                (m) => m.id !== STREAMING_ID && m.id !== userMessage.id,
              );
              return [...base, userMessage, streaming];
            });
          },
          onChunk: appendStreamChunk,
        });

        flushPendingStreamChunks();
        setThreadId(result.threadId);
        sessionStorage.setItem(THREAD_STORAGE_KEY, result.threadId);
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== STREAMING_ID),
          result.assistantMessage,
        ]);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          await syncThreadAfterAbort(activeThreadId);
          return;
        }
        if (err instanceof IncompleteChatStreamError) {
          await syncThreadAfterAbort(err.threadId);
          return;
        }
        setMessages((prev) =>
          prev.filter((m) => m.id !== STREAMING_ID && !m.id.startsWith("pending-")),
        );
        throw err;
      } finally {
        flushPendingStreamChunks();
        streamPendingRef.current = "";
        if (abortRef.current === controller) abortRef.current = null;
        setLoading(false);
      }
    },
    [appendStreamChunk, flushPendingStreamChunks, syncThreadAfterAbort, threadId],
  );

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleNewChat = async () => {
    if (loading) return;
    abortRef.current?.abort();
    if (threadId) {
      try {
        await api.clearChatThread(threadId);
      } catch {
        /* gone */
      }
    }
    sessionStorage.removeItem(THREAD_STORAGE_KEY);
    setThreadId(null);
    setMessages([]);
    setError(null);
    setPromptsOpen(false);
    setEditingId(null);
    textareaRef.current?.focus();
  };

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const optimisticId = `pending-${Date.now()}`;
    if (!text) setInput("");
    setComposerFocused(false);
    setPromptsOpen(false);

    try {
      await runStream(
        "/api/coaching/chat/stream",
        {
          threadId: threadId ?? undefined,
          message: msg,
          ...coachOptions(),
        },
        () => {
          setMessages((prev) => [
            ...prev,
            {
              id: optimisticId,
              role: "user",
              content: msg,
              createdAt: new Date().toISOString(),
            },
            {
              id: STREAMING_ID,
              role: "assistant",
              content: "",
              createdAt: new Date().toISOString(),
            },
          ]);
        },
      );
    } catch (err) {
      if (!text) setInput(msg);
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  const handleRegenerate = async () => {
    if (!threadId || loading) return;

    try {
      await runStream(
        "/api/coaching/chat/regenerate/stream",
        { threadId, ...coachOptions() },
        () => {
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              id: STREAMING_ID,
              role: "assistant",
              content: "",
              createdAt: new Date().toISOString(),
            },
          ]);
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
    }
  };

  const startEdit = (msg: ChatMessage) => {
    if (loading) return;
    setEditingId(msg.id);
    setEditDraft(msg.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const saveEdit = async () => {
    const content = editDraft.trim();
    if (!content || !editingId || !threadId || loading) return;

    const messageId = editingId;
    setEditingId(null);
    setEditDraft("");

    try {
      await runStream(
        "/api/coaching/chat/edit/stream",
        { threadId, messageId, content, ...coachOptions() },
        () => {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === messageId);
            if (idx === -1) return prev;
            const updated = { ...prev[idx]!, content };
            return [
              ...prev.slice(0, idx),
              updated,
              {
                id: STREAMING_ID,
                role: "assistant" as const,
                content: "",
                createdAt: new Date().toISOString(),
              },
            ];
          });
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit message");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && promptsOpen) {
      e.preventDefault();
      setPromptsOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const onEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    }
  };

  const isEmpty = !bootstrapping && messages.length === 0 && !loading;
  const filteredPrompts = visibleStarterPrompts(input);
  const showPrompts =
    isEmpty && !loading && !llmDown && filteredPrompts.length > 0 && composerFocused;

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const streamingMessage = messages.find((m) => m.id === STREAMING_ID);
  const showGenerating = loading && (!streamingMessage || !streamingMessage.content);

  const handleComposerInnerClick = () => {
    if (loading || bootstrapping || llmDown) return;
    setPromptsOpen(true);
    textareaRef.current?.focus();
  };

  const handleComposerFocus = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setComposerFocused(true);
  };

  const handleComposerBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      setComposerFocused(false);
      setPromptsOpen(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const composer = (
    <div className="coach-composer-wrap">
      {llmDown && (
        <div className="error-banner coach-error">
          Coach is disabled — the LLM is unreachable. Check your OpenRouter key in{" "}
          <code>.env</code>, then reload.
        </div>
      )}
      {error && <div className="error-banner coach-error">{error}</div>}
      {input.length > TRUNCATION_WARN_CHARS && (
        <div className="coach-composer-truncation-hint">
          Message is {input.length.toLocaleString()} chars — it will be trimmed to fit the model.
        </div>
      )}
      <div
        className={`coach-composer-inner${loading ? " coach-composer-inner--busy" : ""}${promptsOpen ? " coach-composer-inner--prompts-open" : ""}${expanded ? " coach-composer-inner--expanded" : ""}`}
        onClick={handleComposerInnerClick}
      >
        <button
          type="button"
          className={`coach-composer-expand-btn${expanded ? " coach-composer-expand-btn--active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded();
          }}
          title={expanded ? "Collapse composer" : "Expand composer"}
          aria-label={expanded ? "Collapse composer" : "Expand composer"}
          aria-pressed={expanded}
        >
          <ExpandIcon expanded={expanded} />
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onFocus={handleComposerFocus}
          onBlur={handleComposerBlur}
          onKeyDown={onKeyDown}
          placeholder={llmDown ? "Coach unavailable — LLM is down" : "Ask anything about DSA"}
          disabled={loading || bootstrapping || llmDown}
        />
        <div className="coach-composer-footer">
          <div className="coach-composer-footer-left" onClick={(e) => e.stopPropagation()}>
            {models.length > 1 && (
              <span className="coach-model-picker">
                <select
                  className="coach-model-select"
                  value={modelId}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={loading}
                  aria-label="Coach model"
                  title="Choose the model"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </span>
            )}
          </div>
          <div className="coach-composer-footer-right" onClick={(e) => e.stopPropagation()}>
            {loading ? (
              <button
                type="button"
                className="coach-send-btn coach-send-btn--stop"
                onClick={handleStop}
                title="Stop generating"
                aria-label="Stop generating"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className="coach-send-btn"
                onClick={() => void handleSend()}
                disabled={bootstrapping || llmDown || !input.trim()}
                title="Send (Enter)"
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      {showPrompts && (
        <div className="coach-composer-prompts" role="listbox" aria-label="Suggested questions">
          {filteredPrompts.map((p) => (
            <button
              key={p}
              type="button"
              role="option"
              className="coach-prompt-btn"
              onMouseDown={(e) => e.preventDefault()}
              disabled={loading}
              onClick={() => void handleSend(p)}
            >
              <span className="coach-prompt-btn__text">{p}</span>
              <span className="coach-prompt-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="8" x2="13" y2="8" />
                  <polyline points="9,4 13,8 9,12" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      )}
      {composerFocused && !loading && (
        <div className="coach-composer-hint">
          Enter to send · Shift+Enter for newline
        </div>
      )}
    </div>
  );

  return (
    <div className={`coach-layout${isEmpty ? " coach-layout--empty" : ""}`}>
      <div className="coach-settings-bar">
        <div className="coach-settings-heading">
          <div className="coach-page-eyebrow">Thinking partner</div>
          <h1 className="coach-settings-title">Coach</h1>
          {anchoredProblem && (
            <div className="coach-settings-anchor">
              <span className="coach-settings-anchor-dot" aria-hidden />
              <span>
                Anchored to{" "}
                <span className="coach-settings-anchor-topic">{anchoredProblem.name}</span>
              </span>
            </div>
          )}
        </div>

        <div className="coach-settings-actions">
          <button
            type="button"
            className={`coach-options-btn${optionsOpen ? " coach-options-btn--active" : ""}`}
            onClick={() => setOptionsOpen((v) => !v)}
            aria-expanded={optionsOpen}
            aria-controls="coach-options-panel"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden width="14" height="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>

          <button
            type="button"
            className="coach-new-btn"
            onClick={() => void handleNewChat()}
            disabled={loading}
          >
            + New chat
          </button>
        </div>
      </div>

      {optionsOpen && (
        <div className="coach-options-panel" id="coach-options-panel">
          <label className="coach-option">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
            />
            <span>My learning context</span>
          </label>

          <label className="coach-option">
            <input
              type="checkbox"
              checked={directMode}
              onChange={(e) => setDirectMode(e.target.checked)}
            />
            <span>Direct explanations</span>
          </label>

          <select
            className="coach-select"
            value={problemId}
            onChange={(e) => setProblemId(e.target.value)}
            aria-label="Problem context"
          >
            <option value="">No problem selected</option>
            {problems.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {isEmpty ? (
        <div className="coach-empty-state">
          <div className="coach-empty-state-inner">
            <h2 className="coach-welcome-heading">How can I help you learn today?</h2>
            {composer}
          </div>
        </div>
      ) : (
        <div className={`coach-conversation${loading ? " coach-conversation--generating" : ""}`}>
          <div
            className="coach-thread"
            ref={threadRef}
            onScroll={onThreadScroll}
            aria-busy={loading}
          >
            <div className="coach-thread-inner">
              {bootstrapping && (
                <div className="coach-thinking coach-thinking--centered" aria-label="Loading chat">
                  <span /><span /><span />
                </div>
              )}

              {messages.map((msg) => {
                if (msg.role === "user") {
                  const isEditing = editingId === msg.id;
                  return (
                    <div key={msg.id} className="coach-msg-row coach-msg-row--user">
                      <div className="coach-msg-body">
                        <div className="coach-user-turn">
                          {isEditing ? (
                            <div className="coach-edit-box">
                              <textarea
                                ref={editTextareaRef}
                                className="coach-edit-textarea"
                                value={editDraft}
                                rows={1}
                                onChange={(e) => setEditDraft(e.target.value)}
                                onKeyDown={onEditKeyDown}
                              />
                              <div className="coach-edit-actions">
                                <button
                                  type="button"
                                  className="coach-edit-btn coach-edit-btn--primary"
                                  onClick={() => void saveEdit()}
                                  disabled={!editDraft.trim() || loading}
                                >
                                  Save & resend
                                </button>
                                <button
                                  type="button"
                                  className="coach-edit-btn"
                                  onClick={cancelEdit}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="coach-user-bubble">{msg.content}</div>
                              <CoachMessageActions
                                text={msg.content}
                                showEdit
                                onEdit={() => startEdit(msg)}
                                disabled={loading}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                const isStreaming = msg.id === STREAMING_ID;
                const isLastAssistant = msg.id === lastAssistantId && !isStreaming;

                return (
                  <div
                    key={msg.id}
                    className={`coach-msg-row coach-msg-row--assistant${isStreaming ? " coach-msg-row--streaming" : ""}`}
                  >
                    <CoachAvatar />
                    <div className="coach-msg-body">
                      <div className="coach-assistant-turn">
                        {isStreaming && !msg.content ? (
                          <CoachGenerating />
                        ) : (
                          <CoachMarkdown content={msg.content} streaming={isStreaming} />
                        )}
                        {!isStreaming && msg.content && (
                          <CoachMessageActions
                            text={msg.content}
                            showRetry={isLastAssistant}
                            onRetry={() => void handleRegenerate()}
                            disabled={loading}
                            align="start"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {showGenerating && !streamingMessage && (
                <div className="coach-msg-row coach-msg-row--assistant coach-msg-row--generating">
                  <CoachAvatar />
                  <div className="coach-msg-body">
                    <CoachGenerating />
                  </div>
                </div>
              )}

              <div ref={bottomRef} className="coach-thread-anchor" aria-hidden />
            </div>
          </div>

          {showScrollBtn && (
            <button
              type="button"
              className="coach-scroll-btn"
              onClick={() => scrollToBottom()}
              title="Scroll to bottom"
              aria-label="Scroll to bottom"
            >
              <ScrollDownIcon />
            </button>
          )}

          {composer}
        </div>
      )}
    </div>
  );
}
