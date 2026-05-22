"use client";

import { ExternalLink, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_TIME_ZONE } from "@/lib/timezone";

export type ClientFileItem = {
  createdAt: string;
  id: string;
  mimeType: string;
  name: string;
  size: number;
  url: string;
};

export function ClientFilesHistory({ files }: { files: ClientFileItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button className="secondary-button" onClick={() => setIsOpen(true)} type="button">
        <FileText size={16} />
        Ver expediente
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 px-4 py-6">
          <button
            aria-label="Cerrar expediente"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <section className="relative z-10 w-full max-w-2xl rounded-md border border-black/10 bg-white p-4 shadow-soft">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-paper text-leaf">
                  <FileText size={18} />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Expediente del paciente</h3>
                  <p className="text-sm text-ink/60">Archivos guardados desde el CRM</p>
                </div>
              </div>
              <button className="icon-button" onClick={() => setIsOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto pr-1">
              {files.length > 0 ? (
                <div className="grid gap-3">
                  {files.map((file) => (
                    <a
                      className="flex items-center justify-between gap-3 rounded-md border border-black/10 p-3 transition hover:border-leaf"
                      href={file.url}
                      key={file.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <FileText className="shrink-0 text-leaf" size={18} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{file.name}</span>
                          <span className="block text-xs text-ink/55">
                            {formatFileSize(file.size)} - {file.mimeType} - {formatDateTime(file.createdAt)}
                          </span>
                        </span>
                      </span>
                      <ExternalLink className="shrink-0 text-ink/45" size={16} />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-black/10 p-4 text-sm text-ink/60">
                  Este paciente todavia no tiene archivos guardados en expediente.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
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
