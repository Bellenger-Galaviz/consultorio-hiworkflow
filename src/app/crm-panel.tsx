"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileText, Paperclip } from "lucide-react";
import { APP_TIME_ZONE } from "@/lib/timezone";

export type CrmThread = {
  count: number;
  fullName: string;
  id: string;
  kind: "client" | "unknown";
  lastAt: string | null;
  lastMessage: string | null;
  phone: string;
};

export type CrmMessage = {
  appointmentTitle: string | null;
  createdAt: string;
  direction: string;
  file?: {
    id: string;
    mimeType: string;
    name: string;
    savedToRecord: boolean;
    size: number;
    source: string;
    status: string;
    url: string;
  };
  id: string;
  message: string;
};

type CrmPanelProps = {
  initialMessages: CrmMessage[];
  initialSelectedThreadId: string | null;
  threads: CrmThread[];
};

export function CrmPanel({
  initialMessages,
  initialSelectedThreadId,
  threads
}: CrmPanelProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState(initialSelectedThreadId);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const filteredThreads = useMemo(() => {
    const normalized = normalizeSearch(search);

    if (!normalized) {
      return threads;
    }

    return threads.filter((thread) => normalizeSearch(thread.fullName).includes(normalized));
  }, [search, threads]);
  const selectedThread =
    threads.find((thread) => thread.id === selectedThreadId) ?? filteredThreads[0] ?? null;
  const selectedClient = selectedThread?.kind === "client" ? selectedThread : null;
  const recordFiles = useMemo(
    () =>
      messages
        .filter((message) => message.file?.savedToRecord)
        .map((message) => ({
          createdAt: message.createdAt,
          file: message.file!
        }))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [messages]
  );

  async function selectThread(thread: CrmThread) {
    setSelectedThreadId(thread.id);
    setStatus(null);
    setIsLoadingMessages(true);

    try {
      const response = await fetch(
        thread.kind === "client"
          ? `/api/clients/${thread.id}/messages`
          : `/api/unknown-contacts/${thread.id}/messages`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo cargar la conversacion.");
      }

      setMessages(data.messages);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo cargar la conversacion.");
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

  async function uploadFile() {
    const selectedFile = selectedUploadFile ?? fileInputRef.current?.files?.[0];

    if (!selectedClient || !selectedFile || isUploadingFile) {
      return;
    }

    const formData = new FormData();
    formData.set("file", selectedFile);
    setIsUploadingFile(true);
    setStatus(null);

    try {
      const response = await fetch(`/api/clients/${selectedClient.id}/files`, {
        body: formData,
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo guardar el archivo.");
      }

      setMessages((current) => [
        ...current,
        {
          appointmentTitle: null,
          createdAt: data.file.createdAt,
          direction: "OUTBOUND",
          file: {
            id: data.file.id,
            mimeType: data.file.mimeType,
            name: data.file.name,
            savedToRecord: data.file.savedToRecord,
            size: data.file.size,
            source: "MANUAL",
            status: data.file.status,
            url: data.file.url
          },
          id: `file-${data.file.id}`,
          message: `Archivo enviado por WhatsApp: ${data.file.name}`
        }
      ]);
      setSelectedUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo guardar el archivo.");
    } finally {
      setIsUploadingFile(false);
    }
  }

  async function saveFileToRecord(fileId: string) {
    setStatus(null);

    try {
      const response = await fetch(`/api/client-files/${fileId}/save`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo guardar en el expediente.");
      }

      setMessages((current) =>
        current.map((message) => {
          if (!message.file || message.file.id !== data.file.id) {
            return message;
          }

          return {
            ...message,
            file: {
              ...message.file,
              savedToRecord: data.file.savedToRecord,
              status: data.file.status
            }
          };
        })
      );
      setStatus("Archivo guardado en el expediente del paciente.");
      startTransition(() => router.refresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo guardar en el expediente.");
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
        Aun no hay clientes registrados.
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
            const isSelected = selectedThread?.id === client.id;

            return (
              <button
                className={`block w-full border-b border-black/10 px-4 py-3 text-left last:border-b-0 ${
                  isSelected ? "bg-mint" : "bg-white hover:bg-paper"
                }`}
                key={client.id}
                onClick={() => selectThread(client)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">
                    {client.fullName}
                    {client.kind === "unknown" ? (
                      <span className="ml-2 text-xs font-semibold text-leaf">Nuevo</span>
                    ) : null}
                  </p>
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
              No encontre clientes con ese nombre.
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-black/10 bg-white">
        <div className="border-b border-black/10 px-4 py-3">
          <p className="font-semibold">{selectedThread?.fullName}</p>
          <p className="text-sm text-ink/55">{selectedThread?.phone}</p>
          {selectedClient ? (
            <details className="mt-3 rounded-md border border-black/10 bg-paper p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                Expediente del paciente ({recordFiles.length})
              </summary>
              <div className="mt-3 grid gap-2">
                {recordFiles.length > 0 ? (
                  recordFiles.map(({ createdAt, file }) => (
                    <a
                      className="flex items-center justify-between gap-3 rounded-md border border-black/10 bg-white px-3 py-2 text-sm transition hover:border-leaf"
                      href={file.url}
                      key={file.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="shrink-0 text-leaf" size={16} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{file.name}</span>
                          <span className="block text-xs text-ink/55">
                            {formatFileSize(file.size)} - {formatDateTime(createdAt)}
                          </span>
                        </span>
                      </span>
                      <ExternalLink className="shrink-0 text-ink/45" size={15} />
                    </a>
                  ))
                ) : (
                  <p className="text-sm text-ink/55">Aun no hay archivos guardados en el expediente.</p>
                )}
              </div>
            </details>
          ) : null}
        </div>

        <div className="grid max-h-[420px] gap-3 overflow-y-auto bg-paper p-4">
          {isLoadingMessages ? (
            <p className="text-center text-sm text-ink/55">Cargando conversacion...</p>
          ) : null}
          {!isLoadingMessages && messages.length === 0 ? (
            <p className="text-center text-sm text-ink/55">Sin mensajes todavia.</p>
          ) : null}
          {messages.map((message) => {
            const isOutbound = message.direction === "OUTBOUND";
            const isSentFile = message.file?.status === "SENT";

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
                  {message.file ? (
                    <div className="grid gap-2">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 shrink-0" size={18} />
                        <div className="min-w-0">
                          <p className="break-words font-semibold">{message.file.name}</p>
                          <p className={isOutbound ? "text-white/75" : "text-ink/55"}>
                            {formatFileSize(message.file.size)} · {message.file.mimeType}
                          </p>
                        </div>
                      </div>
                      {message.message && !message.message.startsWith("Archivo:") ? (
                        <p>{message.message}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <a
                          className={isOutbound ? "message-link-light" : "message-link"}
                          href={message.file.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink size={14} />
                          Abrir
                        </a>
                        {isSentFile ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                              isOutbound ? "bg-white/15 text-white" : "bg-mint text-leaf"
                            }`}
                          >
                            <CheckCircle2 size={14} />
                            Enviado por WhatsApp
                          </span>
                        ) : message.file.savedToRecord ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                              isOutbound ? "bg-white/15 text-white" : "bg-mint text-leaf"
                            }`}
                          >
                            <CheckCircle2 size={14} />
                            En expediente
                          </span>
                        ) : (
                          <button
                            className={isOutbound ? "message-link-light" : "message-link"}
                            onClick={() => saveFileToRecord(message.file!.id)}
                            type="button"
                          >
                            <CheckCircle2 size={14} />
                            Guardar en expediente
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p>{message.message}</p>
                  )}
                  <p className={`mt-1 text-xs ${isOutbound ? "text-white/70" : "text-ink/45"}`}>
                    {message.appointmentTitle ? `${message.appointmentTitle} · ` : ""}
                    {formatDateTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-2 border-t border-black/10 p-3">
          {status ? <p className="text-sm font-semibold text-coral">{status}</p> : null}
          {isSending ? <p className="text-sm font-semibold text-leaf">Enviando...</p> : null}
          {isUploadingFile ? <p className="text-sm font-semibold text-leaf">Enviando archivo...</p> : null}
          {selectedThread?.kind === "unknown" ? (
            <a
              className="secondary-button w-fit"
              href={`/?newClientPhone=${encodeURIComponent(selectedThread.phone)}#nuevo-cliente`}
            >
              Agregar cliente
            </a>
          ) : null}
          {selectedClient ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="secondary-button cursor-pointer" htmlFor="crm-file">
                <Paperclip size={16} />
                Adjuntar archivo para enviar
              </label>
              <input
                className="sr-only"
                disabled={isUploadingFile}
                id="crm-file"
                name="file"
                onChange={(event) => setSelectedUploadFile(event.target.files?.[0] ?? null)}
                ref={fileInputRef}
                type="file"
              />
              {selectedUploadFile ? (
                <>
                  <span className="max-w-xs truncate text-sm font-semibold text-ink/70">
                    {selectedUploadFile.name}
                  </span>
                  <button
                    className="primary-button"
                    disabled={isUploadingFile}
                    onClick={uploadFile}
                    type="button"
                  >
                    Enviar por WhatsApp
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <form className="grid gap-2" onSubmit={sendMessage} ref={formRef}>
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
              placeholder={
                selectedThread?.kind === "unknown"
                  ? "Agrega este contacto para responder"
                  : selectedClient
                    ? `Escribe a ${selectedClient.fullName}`
                    : "Selecciona un cliente"
              }
              required={Boolean(selectedClient)}
              value={draft}
            />
          </form>
        </div>
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

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
