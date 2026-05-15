"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { deleteClient } from "./actions";

type ClientOption = {
  fullName: string;
  id: string;
  phone: string;
};

export function ClientManager({
  action,
  clients
}: {
  action: typeof deleteClient;
  clients: ClientOption[];
}) {
  const [search, setSearch] = useState("");
  const filteredClients = useMemo(() => {
    const normalized = normalizeSearch(search);

    if (!normalized) {
      return clients;
    }

    return clients.filter(
      (client) =>
        normalizeSearch(client.fullName).includes(normalized) ||
        client.phone.includes(normalized.replace(/\D/g, ""))
    );
  }, [clients, search]);

  return (
    <div className="grid gap-3">
      <label className="grid max-w-sm gap-1">
        <span className="label">Buscar cliente</span>
        <input
          className="field h-10"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nombre o WhatsApp"
          type="search"
          value={search}
        />
      </label>

      <div className="max-h-72 overflow-y-auto rounded-md border border-black/10">
        {filteredClients.map((client) => (
          <div
            className="flex flex-col gap-3 border-b border-black/10 px-4 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between"
            key={client.id}
          >
            <div>
              <p className="font-semibold">{client.fullName}</p>
              <p className="text-sm text-ink/55">{client.phone}</p>
            </div>
            <form
              action={action}
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
