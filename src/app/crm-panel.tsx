"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { APP_TIME_ZONE } from "@/lib/timezone";

export type CrmThread = {
  count: number;
  fullName: string;
  id: string;
  lastAt: string | null;
  lastMessage: string | null;
  phone: string;
};

export type CrmMessage = {
  appointmentTitle: string | null;
  createdAt: string;
  direction: string;
  id: string;
  message: string;
};

type CrmPanelProps = {
  initialMessages: CrmMessage[];
  initialSelectedClientId: string | null;
  threads: CrmThread[];
};

export function CrmPanel({
  initialMessages,
  initialSelectedClientId,
  threads
}: CrmPanelProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(initialSelectedClientId);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const filteredThreads = useMemo(() => {
    const normalized = normalizeSearch(search);

    if (!normalized) {
      return threads;
    }

    return threads.filter((thread) => normalizeSearch(thread.fullName).includes(normalized));
  }, [search, threads]);
  const selectedClient =
    threads.find((thread) => thread.id === selectedClientId) ?? filteredThreads[0] ?? null;

  async function selectClient(clientId: string) {
    setSelectedClientId(clientId);
    setStatus(null);
    setIsLoadingMessages(true);

    try {
      const response = await fetch(`/api/clients/${clientId}/messages`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo cargar la conversación.");
      }

      setMessages(data.messages);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo cargar la conversación.");
    } finally {
      setIsLoadingMessages(false);
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClient || !draft.trim() || isSending) {
      return;
    }

    const message = draft.trim();
    setIsSending(true);
    setStatus(null);

    try {
      const response = await fetch(`/api/clients/${selectedClient.id}/whatsapp`, {
        body: JSON.stringify({ message }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo enviar el mensaje.");
      }

      setMessages((current) => [...current, data.message]);
      setDraft("");
      startTransition(() => router.refresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo enviar el mensaje.");
    } finally {
      setIsSending(false);
    }
  }

  function submitWithEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    formRef.current?.requestSubmit();
  }

  if (threads.length === 0) {
    return (
      <div className="rounded-md border border-black/10 px-4 py-8 text-center text-sm text-ink/60">
        Aún no hay clientes registrados.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[0.85fr_1.65fr]">
      <div className="grid content-start gap-3">
        <label className="grid max-w-sm gap-1">
          <span className="label">Buscar cliente</span>
          <input
            className="field h-10"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre del cliente"
            type="search"
            value={search}
          />
        </label>

        <div className="max-h-[420px] overflow-y-auto rounded-md border border-black/10">
          {filteredThreads.map((client) => {
            const isSelected = selectedClient?.id === client.id;

            return (
              <button
                className={`block w-full border-b border-black/10 px-4 py-3 text-left last:border-b-0 ${
                  isSelected ? "bg-mint" : "bg-white hover:bg-paper"
                }`}
                key={client.id}
                onClick={() => selectClient(client.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{client.fullName}</p>
                  <span className="text-xs font-semibold text-ink/50">{client.count}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-ink/60">
                  {client.lastMessage ?? "Sin mensajes"}
                </p>
                {client.lastAt ? (
                  <p className="mt-1 text-xs text-ink/45">{formatDateTime(client.lastAt)}</p>
                ) : null}
              </button>
            );
          })}
          {filteredThreads.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink/60">
              No encontré clientes con ese nombre.
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-black/10 bg-white">
        <div className="border-b border-black/10 px-4 py-3">
          <p className="font-semibold">{selectedClient?.fullName}</p>
          <p className="text-sm text-ink/55">{selectedClient?.phone}</p>
        </div>

        <div className="grid max-h-[420px] gap-3 overflow-y-auto bg-paper p-4">
          {isLoadingMessages ? (
            <p className="text-center text-sm text-ink/55">Cargando conversación...</p>
          ) : null}
          {!isLoadingMessages && messages.length === 0 ? (
            <p className="text-center text-sm text-ink/55">Sin mensajes todavía.</p>
          ) : null}
          {messages.map((message) => {
            const isOutbound = message.direction === "OUTBOUND";

            return (
              <div
                className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                key={message.id}
              >
                <div
                  className={`max-w-[78%] rounded-md px-3 py-2 text-sm shadow-sm ${
                    isOutbound ? "bg-leaf text-white" : "bg-white text-ink"
                  }`}
                >
                  <p>{message.message}</p>
                  <p className={`mt-1 text-xs ${isOutbound ? "text-white/70" : "text-ink/45"}`}>
                    {message.appointmentTitle ? `${message.appointmentTitle} · ` : ""}
                    {formatDateTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <form className="grid gap-2 border-t border-black/10 p-3" onSubmit={sendMessage} ref={formRef}>
          {status ? <p className="text-sm font-semibold text-coral">{status}</p> : null}
          {isSending ? <p className="text-sm font-semibold text-leaf">Enviando...</p> : null}
          <label className="sr-only" htmlFor="crm-message">
            Mensaje
          </label>
          <textarea
            className="field min-h-20 resize-y"
            disabled={!selectedClient || isSending}
            id="crm-message"
            maxLength={1000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={submitWithEnter}
            placeholder={selectedClient ? `Escribe a ${selectedClient.fullName}` : "Selecciona un cliente"}
            required
            value={draft}
          />
        </form>
      </div>
    </div>
  );
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(new Date(value));
}
