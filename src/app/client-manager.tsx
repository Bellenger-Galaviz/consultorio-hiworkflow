"use client";

import { Pencil, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { deleteClient, updateClient } from "./actions";

type ClientOption = {
  email: string | null;
  fullName: string;
  id: string;
  notes: string | null;
  phone: string;
};

export function ClientManager({
  deleteAction,
  updateAction,
  clients
}: {
  deleteAction: typeof deleteClient;
  updateAction: typeof updateClient;
  clients: ClientOption[];
}) {
  const [search, setSearch] = useState("");
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const filteredClients = useMemo(() => {
    const normalized = normalizeSearch(search);
    const normalizedPhone = search.replace(/\D/g, "");

    if (!normalized) {
      return clients;
    }

    return clients.filter(
      (client) =>
        normalizeSearch(client.fullName).includes(normalized) ||
        normalizeSearch(client.email ?? "").includes(normalized) ||
        (normalizedPhone ? client.phone.includes(normalizedPhone) : false)
    );
  }, [clients, search]);

  return (
    <div className="grid gap-3">
      <label className="grid max-w-sm gap-1">
        <span className="label">Buscar cliente</span>
        <input
          className="field h-10"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nombre, WhatsApp o correo"
          type="search"
          value={search}
        />
      </label>
      <p className="text-sm font-semibold text-ink/55">
        {filteredClients.length} coincidencia{filteredClients.length === 1 ? "" : "s"}
      </p>

      <div className="max-h-72 overflow-y-auto rounded-md border border-black/10">
        {filteredClients.map((client) => (
          <div className="border-b border-black/10 px-4 py-3 last:border-b-0" key={client.id}>
            {editingClientId === client.id ? (
              <form action={updateAction} className="grid gap-3">
                <input name="clientId" type="hidden" value={client.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="label">Nombre completo</span>
                    <input
                      className="field"
                      defaultValue={client.fullName}
                      minLength={2}
                      name="fullName"
                      required
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="label">WhatsApp</span>
                    <input
                      className="field"
                      defaultValue={client.phone}
                      maxLength={20}
                      minLength={8}
                      name="phone"
                      required
                    />
                  </label>
                  <label className="grid gap-1 md:col-span-2">
                    <span className="label">Correo</span>
                    <input className="field" defaultValue={client.email ?? ""} name="email" type="email" />
                  </label>
                  <label className="grid gap-1 md:col-span-2">
                    <span className="label">Notas</span>
                    <textarea className="field min-h-16 resize-y" defaultValue={client.notes ?? ""} name="notes" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="primary-button" type="submit">
                    <Save size={16} />
                    Guardar cambios
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setEditingClientId(null)}
                    type="button"
                  >
                    <X size={16} />
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold">{client.fullName}</p>
                  <p className="text-sm text-ink/55">{client.phone}</p>
                  {client.email ? <p className="text-sm text-ink/55">{client.email}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="secondary-button"
                    onClick={() => setEditingClientId(client.id)}
                    type="button"
                  >
                    <Pencil size={16} />
                    Editar
                  </button>
                  <form
                    action={deleteAction}
                    onSubmit={(event) => {
                      if (
                        !window.confirm(
                          `¿Eliminar a ${client.fullName}? También se eliminarán sus citas y mensajes.`
                        )
                      ) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input name="clientId" type="hidden" value={client.id} />
                    <button className="secondary-button text-coral" type="submit">
                      <Trash2 size={16} />
                      Eliminar
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        ))}
        {filteredClients.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-ink/60">
            No encontré clientes con ese dato.
          </div>
        ) : null}
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
