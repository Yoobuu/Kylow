import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/axios";
import { getToken, setToken } from "../../auth/tokenStorage";
import Composer from "./Composer";
import MessageList from "./MessageList";
import ScrollToBottomButton from "./ScrollToBottomButton";
import SidePanel from "./SidePanel";
import useAbortableRequest from "./hooks/useAbortableRequest";
import useAutoScroll from "./hooks/useAutoScroll";
import copyToClipboard from "./utils/copyToClipboard";
import { actionToNavigate, buildUrl, labelForAction } from "./utils/actionRouting";

const STREAMING_MODE = (import.meta.env.VITE_AI_STREAMING || "auto").toLowerCase();

const resolveApiUrl = (path) => {
  const base = api.defaults.baseURL || "/api";
  if (/^https?:/i.test(base)) {
    return `${base.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
  }
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
};

const parseJsonSafely = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
};

const readErrorMessage = async (response) => {
  try {
    const data = await response.json();
    return data?.detail || data?.message || response.statusText || "No se pudo enviar el mensaje.";
  } catch (err) {
    return response.statusText || "No se pudo enviar el mensaje.";
  }
};

const extractStreamPayload = (payload) => {
  if (!payload) return {};
  if (payload === "[DONE]" || payload === "DONE") {
    return { done: true };
  }
  const parsed = parseJsonSafely(payload);
  if (!parsed) {
    return { text: payload };
  }
  if (typeof parsed === "string") {
    return { text: parsed };
  }
  return {
    text: parsed.delta || parsed.text || parsed.content || parsed.answer_text || parsed.token || "",
    actions: parsed.actions,
    conversationId: parsed.conversation_id,
    done: parsed.done === true || parsed.finished === true,
  };
};

const applyActions = (actions = []) =>
  actions.map((action) => ({
    ...action,
    label: labelForAction(action),
    nav: actionToNavigate(action),
  }));

const typeInChunks = async (text, onChunk) => {
  if (!text) return;
  const chunkCount = text.length > 240 ? 0 : 5;
  if (!chunkCount) {
    onChunk(text);
    return;
  }
  const size = Math.ceil(text.length / chunkCount);
  for (let i = 1; i <= chunkCount; i += 1) {
    onChunk(text.slice(0, i * size));
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
};

export default function ChatContainer() {
  const navigate = useNavigate();
  const { start, abort } = useAbortableRequest();
  const {
    containerRef,
    isAtBottom,
    scrollToBottom,
    unreadCount,
    notifyNewMessage,
    notifyNewToken,
  } = useAutoScroll();

  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelPreference, setModelPreference] = useState(() => {
    try {
      return localStorage.getItem("ai.chat.model") || "fast";
    } catch (err) {
      return "fast";
    }
  });
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [feedbackById, setFeedbackById] = useState({});
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const activeAssistantIdRef = useRef(null);
  const inputRef = useRef(null);

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((msg) => msg.role === "user"),
    [messages]
  );

  useEffect(() => {
    if (messages.length) {
      notifyNewMessage();
    }
  }, [messages.length, notifyNewMessage]);

  useEffect(() => {
    const streamingMessage = messages.find((msg) => msg.role === "assistant" && msg.status === "generating");
    if (streamingMessage?.content) {
      notifyNewToken();
    }
  }, [messages, notifyNewToken]);

  useEffect(() => {
    const lastAssistant = [...messages].reverse().find(
      (msg) => msg.role === "assistant" && (msg.status === "done" || msg.status === "error")
    );
    if (lastAssistant?.content) {
      const prefix = lastAssistant.status === "error" ? "Error de KYLOW" : "Respuesta de KYLOW";
      setLiveAnnouncement(`${prefix}: ${lastAssistant.content}`);
    }
  }, [messages]);

  const updateMessage = useCallback((id, updater) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== id) return msg;
        const updates = typeof updater === "function" ? updater(msg) : updater;
        const next = { ...msg, ...updates };
        if (updates?.status === "done" && msg.status !== "done") {
          next.justCompleted = true;
        }
        return next;
      })
    );
  }, []);

  const handleAbort = useCallback(() => {
    abort();
    setIsGenerating(false);
    if (activeAssistantIdRef.current) {
      updateMessage(activeAssistantIdRef.current, { status: "done", aborted: true });
    }
  }, [abort, updateMessage]);

  const handleCopy = useCallback(async (message) => {
    const success = await copyToClipboard(message.content || "");
    if (success) {
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId(null), 1600);
    }
  }, []);

  const handleFeedback = useCallback((message, value) => {
    setFeedbackById((prev) => ({
      ...prev,
      [message.id]: prev[message.id] === value ? null : value,
    }));
  }, []);

  const handleEdit = useCallback(
    (message) => {
      if (isGenerating) return;
      setEditingMessageId(message.id);
      setInput(message.content);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [isGenerating]
  );

  const handlePromptSelect = useCallback((prompt) => {
    if (isGenerating) return;
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isGenerating]);

  const handleModelPreference = useCallback((value) => {
    setModelPreference(value);
    try {
      localStorage.setItem("ai.chat.model", value);
    } catch (err) {
      // ignore storage errors
    }
  }, []);

  const sendMessage = useCallback(
    async ({ prompt, parentId = null, replaceMessageId = null } = {}) => {
      const text = (prompt ?? input).trim();
      if (!text || isGenerating) return;

      const userMessageId = replaceMessageId || `user-${crypto.randomUUID()}`;
      const assistantMessageId = `assistant-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      setInput("");
      setEditingMessageId(null);
      setIsGenerating(true);
      activeAssistantIdRef.current = assistantMessageId;

      setMessages((prev) => {
        let next = prev;
        if (replaceMessageId) {
          const index = prev.findIndex((msg) => msg.id === replaceMessageId);
          if (index >= 0) {
            next = prev.slice(0, index + 1);
            next[index] = { ...prev[index], content: text, edited: true, status: "sending" };
          }
        } else {
          next = [
            ...prev,
            {
              id: userMessageId,
              role: "user",
              content: text,
              status: "sending",
              createdAt: now,
            },
          ];
        }

        return [
          ...next,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            status: "generating",
            createdAt: now,
            parentId: parentId || userMessageId,
          },
        ];
      });

      const controller = start();

      try {
        const url = resolveApiUrl("/ai/chat");
        const headers = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        };
        const token = getToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            conversation_id: conversationId,
            message: text,
            ui_context: {
              model_preference: modelPreference,
            },
          }),
          signal: controller.signal,
        });

        if (response.status === 401) {
          setToken(null);
          window.dispatchEvent(new Event("auth:logout"));
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          const errorMessage = await readErrorMessage(response);
          throw new Error(errorMessage);
        }

        updateMessage(userMessageId, { status: "sent" });

        const contentType = response.headers.get("content-type") || "";
        const isEventStream = contentType.includes("text/event-stream");
        const isNdjson = contentType.includes("application/x-ndjson");
        const shouldStream = STREAMING_MODE !== "off" && (isEventStream || isNdjson);

        if (shouldStream && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let buffer = "";
          let actions = [];

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            if (isEventStream || isNdjson) {
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || "";
              for (const line of lines) {
                if (!line.trim()) continue;
                if (isEventStream && !line.startsWith("data:")) {
                  continue;
                }
                const payload = isEventStream
                  ? line.replace(/^data:\s*/, "")
                  : line;
                const { text: chunk, actions: chunkActions, conversationId: nextConversation, done: doneSignal } =
                  extractStreamPayload(payload);

                if (nextConversation) {
                  setConversationId(nextConversation);
                }

                if (Array.isArray(chunkActions)) {
                  actions = chunkActions;
                }

                if (chunk) {
                  updateMessage(assistantMessageId, (msg) => ({
                    content: (msg.content || "") + chunk,
                    status: "generating",
                  }));
                }

                if (doneSignal) {
                  break;
                }
              }
            } else {
              updateMessage(assistantMessageId, (msg) => ({
                content: (msg.content || "") + buffer,
                status: "generating",
              }));
              buffer = "";
            }
          }

          updateMessage(assistantMessageId, {
            status: "done",
            actions: applyActions(actions),
          });
        } else {
          const rawText = await response.text();
          const data = parseJsonSafely(rawText);
          const answerText = data?.answer_text || data?.text || rawText || "";
          if (data?.conversation_id) {
            setConversationId(data.conversation_id);
          }

          await typeInChunks(answerText, (partial) => {
            updateMessage(assistantMessageId, { content: partial, status: "generating" });
          });

          updateMessage(assistantMessageId, {
            content: answerText,
            status: "done",
            actions: applyActions(Array.isArray(data?.actions) ? data.actions : []),
          });
        }
      } catch (err) {
        if (err?.name === "AbortError") {
          updateMessage(assistantMessageId, { status: "done", aborted: true });
          updateMessage(userMessageId, { status: "sent" });
          return;
        }
        const detail = err?.message || "No se pudo obtener respuesta en este momento.";
        updateMessage(assistantMessageId, {
          content: detail,
          status: "error",
        });
        updateMessage(userMessageId, { status: "sent" });
      } finally {
        setIsGenerating(false);
      }
    },
    [conversationId, input, isGenerating, modelPreference, start, updateMessage]
  );

  const handleRegenerate = useCallback(
    (message) => {
      if (isGenerating) return;
      const parent = messages.find((msg) => msg.id === message.parentId) || lastUserMessage;
      if (!parent?.content) return;
      sendMessage({ prompt: parent.content, parentId: parent.id });
    },
    [isGenerating, lastUserMessage, messages, sendMessage]
  );

  const handleRetry = useCallback(
    (message) => {
      if (isGenerating) return;
      const parent = messages.find((msg) => msg.id === message.parentId) || lastUserMessage;
      if (!parent?.content) return;
      sendMessage({ prompt: parent.content, parentId: parent.id });
    },
    [isGenerating, lastUserMessage, messages, sendMessage]
  );

  const handleActionNavigate = useCallback(
    (action) => {
      const nav = action?.nav || actionToNavigate(action);
      if (!nav?.path) return;
      navigate(buildUrl(nav));
    },
    [navigate]
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col font-usfqBody">
      <style>{`
        @keyframes chat-reveal {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-[#E1D6C8] bg-gradient-to-r from-[#FAF3E9] via-white to-[#FAF3E9] px-4 py-3 shadow-soft">
        <div>
          <h2 className="font-brand text-2xl text-usfq-black">KYLOW</h2>
          <p className="mt-1 text-sm text-usfq-gray">
            <span className="font-brand">KYLOW</span> te ayuda con inventario, hosts y notificaciones (solo lectura).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-usfq-gray">
          <div className="flex items-center gap-2 rounded-pill border border-[#E1D6C8] bg-white/80 px-2 py-1 text-[10px]">
            <span className="font-semibold text-usfq-gray">modo</span>
            <div className="flex overflow-hidden rounded-pill border border-[#E1D6C8] bg-[#FAF3E9]">
              <button
                type="button"
                onClick={() => handleModelPreference("fast")}
                className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                  modelPreference === "fast"
                    ? "bg-usfq-red/10 text-usfq-red"
                    : "text-usfq-gray hover:bg-white"
                }`}
              >
                fast
              </button>
              <button
                type="button"
                onClick={() => handleModelPreference("smart")}
                className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                  modelPreference === "smart"
                    ? "bg-usfq-red/10 text-usfq-red"
                    : "text-usfq-gray hover:bg-white"
                }`}
              >
                smart
              </button>
            </div>
          </div>
          <span className="rounded-pill border border-usfq-red/20 bg-usfq-red/10 px-3 py-1 font-semibold text-usfq-red">
            <span className="font-brand">KYLOW</span> activo
          </span>
        </div>
      </div>

      <div className="mt-3 grid flex-1 min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative flex min-h-0 flex-col overflow-hidden rounded-card border border-[#E1D6C8] bg-[#FAF3E9] shadow-soft">
          <div className="border-b border-[#E1D6C8] bg-white/80 px-4 py-3 text-xs text-usfq-gray md:hidden">
            <span className="rounded-pill border border-usfq-red/20 bg-usfq-red/10 px-2 py-1 text-[10px] font-semibold text-usfq-red">
              <span className="font-brand">KYLOW</span> activo
            </span>
          </div>

          <div className="hidden md:block lg:hidden">
            <details className="group border-b border-[#E1D6C8] bg-white px-4 py-3">
              <summary className="cursor-pointer list-none text-sm font-semibold text-usfq-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usfq-red/30">
                Panel de <span className="font-brand">KYLOW</span>
              </summary>
              <div className="mt-3">
                <SidePanel onPromptSelect={handlePromptSelect} variant="flat" />
              </div>
            </details>
          </div>

          <MessageList
            messages={messages}
            listRef={containerRef}
            onCopy={handleCopy}
            onRegenerate={handleRegenerate}
            onFeedback={handleFeedback}
            onEdit={handleEdit}
            onRetry={handleRetry}
            onActionNavigate={handleActionNavigate}
            onPromptSelect={handlePromptSelect}
            lastUserMessageId={lastUserMessage?.id}
            copiedMessageId={copiedMessageId}
            feedbackById={feedbackById}
            isGenerating={isGenerating}
          />

          <div className="pointer-events-none absolute bottom-24 right-6 flex justify-end">
            {!isAtBottom && (
              <ScrollToBottomButton
                unreadCount={unreadCount}
                onClick={() => {
                  scrollToBottom("smooth");
                }}
              />
            )}
          </div>

          <div className="border-t border-[#E1D6C8] bg-white/90 px-4 py-4 backdrop-blur">
            <Composer
              value={input}
              onChange={setInput}
              onSend={() => sendMessage({ replaceMessageId: editingMessageId })}
              onStop={handleAbort}
              isGenerating={isGenerating}
              isEditing={Boolean(editingMessageId)}
              inputRef={inputRef}
              canSend={Boolean(input.trim())}
            />
          </div>
        </div>

        <aside className="hidden min-h-0 lg:block">
          <SidePanel onPromptSelect={handlePromptSelect} />
        </aside>
      </div>

      <div className="sr-only" aria-live="polite">
        {liveAnnouncement}
      </div>
    </div>
  );
}
