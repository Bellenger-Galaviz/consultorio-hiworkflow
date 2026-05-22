"use client";

import { StickyNote, X } from "lucide-react";
import { useEffect, useState } from "react";

export type ClientNoteItem = {
  id: string;
  label: string;
  text: string;
};

export function ClientNotesHistory({ notes }: { notes: ClientNoteItem[] }) {
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
        <StickyNote size={16} />
        Ver notas
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 px-4 py-6">
          <button
            aria-label="Cerrar notas"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <section className="relative z-10 w-full max-w-2xl rounded-md border border-black/10 bg-white p-4 shadow-soft">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-paper text-leaf">
                  <StickyNote size={18} />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Historial de notas</h3>
                  <p className="text-sm text-ink/60">Notas del paciente y sus citas</p>
                </div>
              </div>
              <button className="icon-button" onClick={() => setIsOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto pr-1">
              {notes.length > 0 ? (
                <div className="grid gap-3">
                  {notes.map((note) => (
                    <article className="rounded-md border border-black/10 p-3" key={note.id}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-leaf">{note.label}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">{note.text}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-black/10 p-4 text-sm text-ink/60">
                  Este paciente todavía no tiene notas registradas.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
