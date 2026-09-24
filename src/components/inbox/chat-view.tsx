"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, Pause, Play, RotateCcw, SendHorizontal } from "lucide-react";
import { CHANNEL_META } from "@/components/channel-icons";
import { dayOf, formatDayDivider, formatRemaining, formatTime } from "@/lib/format";
import type { ChatMessage, ConversationDetail } from "@/lib/inbox/queries";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { TemplatePicker } from "./template-picker";
import { TypingBubble } from "./typing-bubble";
import { TriagePanel } from "./triage-panel";
import type { TriageRow } from "@/lib/agent/triage/queries";

const POLL_MS = 4000;
// Pausa al teclear antes de avisar "escribiendo…": un aviso por pausa, no uno por tecla.
const TYPING_DEBOUNCE_MS = 400;

type LocalMessage = ChatMessage & { local?: true };
type OutgoingPayload = { text: string } | { template: { name: string; language: string; params: string[] }; preview: string };

export function ChatView({
  conversation,
  messages,
  triage,
}: {
  conversation: ConversationDetail;
  messages: ChatMessage[];
  triage: TriageRow | null;
}) {
  const router = useRouter();
  const [local, setLocal] = useState<LocalMessage[]>([]);
  const [aiEnabled, setAiEnabled] = useState(conversation.aiEnabled);
  const [typing, setTyping] = useState({ agent: false, human: false });
  // El texto del campo de escritura vive acá para que el borrador del agente se pueda cargar
  // con un setState, sin un efecto que sincronice. El borrador NO se envía solo.
  const [text, setText] = useState("");
  const [triageHidden, setTriageHidden] = useState(false);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Refresco periódico: los mensajes entrantes llegan por webhook y se ven sin recargar.
  // El mismo latido trae quién está escribiendo, así no hay un segundo temporizador.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      startTransition(() => router.refresh());
      const res = await fetch("/api/conversations/" + conversation.id + "/typing").catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (!cancelled) setTyping({ agent: Boolean(data?.agent), human: Boolean(data?.human) });
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router, conversation.id]);

  useEffect(() => {
    if (conversation.unreadCount === 0) return;
    fetch(`/api/conversations/${conversation.id}/read`, { method: "POST" }).then(() =>
      startTransition(() => router.refresh()),
    );
  }, [conversation.id, conversation.unreadCount, router]);

  // Las filas locales se descartan cuando el servidor ya trae el mismo id.
  const all = useMemo(() => {
    const serverIds = new Set(messages.map((m) => m.id));
    return [...messages, ...local.filter((m) => !serverIds.has(m.id))];
  }, [messages, local]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  async function send(payload: OutgoingPayload) {
    const tempId = `tmp-${crypto.randomUUID()}`;
    const optimistic: LocalMessage = {
      id: tempId,
      direction: "outbound",
      type: "template" in payload ? "template" : "text",
      body: "template" in payload ? payload.preview : payload.text,
      status: "pending",
      error: null,
      sentAt: new Date().toISOString(),
      source: "human",
      local: true,
    };
    setLocal((prev) => [...prev, optimistic]);
    // Se retira el indicador en cuanto sale el mensaje, sin esperar a que venza solo.
    pingTyping(false);

    const res = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        "template" in payload
          ? { conversationId: conversation.id, template: payload.template }
          : { conversationId: conversation.id, text: payload.text },
      ),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;

    setLocal((prev) =>
      prev.map((m) => {
        if (m.id !== tempId) return m;
        if (res?.ok && data?.message) return { ...m, ...data.message, source: "human" };
        return { ...m, ...(data?.message ?? {}), status: "failed", error: data?.error ?? "No se pudo enviar" };
      }),
    );
    startTransition(() => router.refresh());
  }

  // Reintento de un envío fallido. Solo para texto: repetir una plantilla exigiría rearmar sus
  // variables, y mandarla con los valores equivocados es peor que no mandarla.
  function retry(failed: LocalMessage) {
    if (failed.type !== "text" || !failed.body) return;
    setLocal((prev) => prev.filter((m) => m.id !== failed.id));
    void send({ text: failed.body });
  }

  // Avisa que hay alguien del equipo escribiendo, con freno: una llamada cada TYPING_PING_MS
  // como mucho. Lo ven los demás usuarios del CRM, no el cliente en WhatsApp.
  // Avisa que alguien del equipo está escribiendo. El freno lo pone el composer con un debounce
  // en un efecto: así no hace falta mirar el reloj durante el render.
  const pingTyping = useCallback(
    (typing: boolean) => {
      void fetch("/api/conversations/" + conversation.id + "/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typing }),
      }).catch(() => null);
    },
    [conversation.id],
  );

  async function toggleAi() {
    const next = !aiEnabled;
    setAiEnabled(next);
    const res = await fetch(`/api/conversations/${conversation.id}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null);
    if (!res?.ok) setAiEnabled(!next);
  }

  const { Icon, color, label } = CHANNEL_META[conversation.channel];
  const subtitle =
    conversation.channel === "whatsapp"
      ? (conversation.phone ?? "WhatsApp")
      : conversation.handle
        ? `@${conversation.handle}`
        : label;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line bg-card px-6">
        <Avatar name={conversation.name} picture={conversation.picture} channel={conversation.channel} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{conversation.name}</p>
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <Icon className={cn("size-3.5", color)} />
            {subtitle}
          </p>
        </div>
        <button
          onClick={toggleAi}
          title={aiEnabled ? "Pausar el agente en esta conversación" : "Reactivar el agente en esta conversación"}
          className={cn(
            "ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors",
            aiEnabled ? "border-primary/20 bg-primary/5 text-primary" : "border-line bg-card text-muted hover:text-ink",
          )}
        >
          <Bot className="size-4" strokeWidth={1.7} />
          {aiEnabled ? "IA activa" : "IA pausada"}
          {aiEnabled ? <Pause className="size-3.5" strokeWidth={2} /> : <Play className="size-3.5" strokeWidth={2} />}
        </button>
      </header>

      {triage && !triageHidden && (
        <TriagePanel
          triage={triage}
          onUseDraft={(draft) => {
            setText(draft);
            setTriageHidden(true);
          }}
          onDismiss={() => {
            setTriageHidden(true);
            void fetch("/api/conversations/" + conversation.id + "/triage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ triageId: triage.id, action: "descartar" }),
            }).catch(() => null);
          }}
        />
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {all.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-muted">Todavía no hay mensajes en esta conversación.</p>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {all.map((m, i) => {
              const newDay = i === 0 || dayOf(all[i - 1].sentAt) !== dayOf(m.sentAt);
              return (
                <li key={m.id} className="contents">
                  {newDay && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-card px-3 py-1 text-[11.5px] font-medium text-muted shadow-card">
                        {formatDayDivider(m.sentAt)}
                      </span>
                    </div>
                  )}
                  <Bubble message={m} onRetry={m.status === "failed" ? () => retry(m) : undefined} />
                </li>
              );
            })}
            {/* Fuera de la lista de mensajes a propósito: es estado efímero, no historial. */}
            {typing.agent && (
              <li className="contents">
                <TypingBubble who="agent" />
              </li>
            )}
            {typing.human && !typing.agent && (
              <li className="contents">
                <TypingBubble who="human" />
              </li>
            )}
          </ol>
        )}
      </div>

      <Composer conversation={conversation} onSend={send} onTyping={pingTyping} text={text} setText={setText} />
    </section>
  );
}

function Bubble({ message: m, onRetry }: { message: LocalMessage; onRetry?: () => void }) {
  const out = m.direction === "outbound";
  const text = m.body ?? (m.type !== "text" ? `[${m.type}]` : "");
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[72%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed",
          out ? "rounded-br-md bg-primary text-white" : "rounded-bl-md border border-line bg-card text-ink",
          m.status === "failed" && "bg-accent-red/10 text-ink ring-1 ring-accent-red/30",
        )}
      >
        {m.source === "agent" && (
          <span className={cn("mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide", out ? "text-white/70" : "text-muted")}>
            <Bot className="size-3" /> Agente IA
          </span>
        )}
        {m.type === "template" && (
          <span className={cn("mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide", out ? "text-white/70" : "text-muted")}>
            <FileText className="size-3" /> Plantilla
          </span>
        )}
        <p className="break-words whitespace-pre-wrap">{text}</p>
        <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10.5px]", out && m.status !== "failed" ? "text-white/70" : "text-muted")}>
          {formatTime(m.sentAt)}
          {out && <StatusIcon status={m.status} />}
        </span>
        {m.status === "failed" && (
          <span className="mt-1 flex flex-col gap-1 text-[11.5px] text-accent-red">
            <span className="flex items-start gap-1">
              <AlertCircle className="mt-px size-3.5 shrink-0" /> {m.error ?? "No se pudo enviar"}
            </span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex w-fit items-center gap-1 rounded-md border border-accent-red/30 px-2 py-0.5 font-medium hover:bg-accent-red/10"
              >
                <RotateCcw className="size-3" strokeWidth={2} /> Reintentar
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "pending") return <Clock className="size-3" />;
  if (status === "sent") return <Check className="size-3.5" />;
  if (status === "delivered") return <CheckCheck className="size-3.5" />;
  if (status === "read") return <CheckCheck className="size-3.5 text-accent-cyan" />;
  return null;
}

function Composer({
  conversation,
  onSend,
  onTyping,
  text,
  setText,
}: {
  conversation: ConversationDetail;
  onSend: (payload: OutgoingPayload) => void;
  onTyping: (typing: boolean) => void;
  text: string;
  setText: (value: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const { state, expiresAt } = conversation.window;

  // Debounce: un solo aviso cuando la persona hace una pausa, no uno por tecla.
  useEffect(() => {
    if (!text.trim()) return;
    const id = setTimeout(() => onTyping(true), TYPING_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, onTyping]);

  const blocked = state === "template_only" || state === "closed";
  const canTemplate = conversation.channel === "whatsapp";

  function submit() {
    const value = text.trim();
    if (!value || blocked) return;
    setText("");
    onSend({ text: value });
  }

  return (
    <div className="shrink-0 border-t border-line bg-card px-6 py-4">
      {picking && (
        <TemplatePicker
          conversationId={conversation.id}
          onClose={() => setPicking(false)}
          onSend={(template, preview) => {
            setPicking(false);
            onSend({ template, preview });
          }}
        />
      )}
      {state === "template_only" && !picking && (
        <Notice>
          Pasaron más de 24 h desde el último mensaje del cliente. En WhatsApp solo se puede escribir con una{" "}
          <button onClick={() => setPicking(true)} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
            <FileText className="size-3.5" /> plantilla aprobada
          </button>
          .
        </Notice>
      )}
      {state === "closed" && <Notice>La ventana para responder en este canal está cerrada. El cliente tiene que volver a escribir.</Notice>}
      {state === "human_agent" && (
        <Notice tone="info">
          Fuera de las 24 h: se envía con la etiqueta de agente humano de Meta (vence en {formatRemaining(expiresAt!)}). El agente IA no puede responder.
        </Notice>
      )}

      <div className={cn("flex items-end gap-2 rounded-xl border border-line bg-field px-3 py-2", blocked && "opacity-60")}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={blocked}
          rows={1}
          maxLength={4096}
          placeholder={blocked ? "No se puede enviar texto libre" : "Escribe un mensaje…"}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] text-ink placeholder:text-muted focus:outline-none [field-sizing:content]"
        />
        {canTemplate && (
          <button
            onClick={() => setPicking((p) => !p)}
            aria-label="Enviar plantilla"
            title="Enviar plantilla de WhatsApp"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-card hover:text-ink"
          >
            <FileText className="size-4" strokeWidth={1.7} />
          </button>
        )}
        <button
          onClick={submit}
          disabled={blocked || !text.trim()}
          aria-label="Enviar"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-white transition-opacity disabled:opacity-40"
        >
          <SendHorizontal className="size-4" strokeWidth={1.8} />
        </button>
      </div>
      {state === "open" && expiresAt && (
        <p className="mt-1.5 text-[11.5px] text-muted">Ventana de 24 h abierta · vence en {formatRemaining(expiresAt)}</p>
      )}
    </div>
  );
}

function Notice({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "info" }) {
  return (
    <p
      className={cn(
        "mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]",
        tone === "warn" ? "bg-accent-amber/10 text-ink" : "bg-accent-cyan/10 text-ink",
      )}
    >
      <AlertCircle className={cn("mt-px size-4 shrink-0", tone === "warn" ? "text-accent-amber" : "text-accent-cyan")} />
      <span>{children}</span>
    </p>
  );
}
