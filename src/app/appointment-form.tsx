"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatInputDate, formatInputTime, zonedDateTimeToUtc } from "@/lib/timezone";
import type { createAppointment } from "./actions";

type ClientOption = {
  id: string;
  fullName: string;
};

type BlockingAppointment = {
  id: string;
  clientName: string;
  startsAt: string;
  durationMin: number;
  status: string;
};

type AppointmentFormProps = {
  action: typeof createAppointment;
  appointments: BlockingAppointment[];
  clients: ClientOption[];
};

const SLOT_START_HOUR = 7;
const SLOT_END_HOUR = 21;
const SLOT_INTERVAL_MIN = 15;
const BLOCKING_STATUSES = new Set(["PENDING", "CONFIRMED"]);

export function AppointmentForm({ action, appointments, clients }: AppointmentFormProps) {
  const today = formatInputDate(new Date());
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState(60);
  const [time, setTime] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [isClientPickerOpen, setIsClientPickerOpen] = useState(false);
  const clientPickerRef = useRef<HTMLDivElement>(null);
  const clientSearchRef = useRef<HTMLInputElement>(null);

  const slots = useMemo(
    () =>
      buildSlots().map((slot) => {
        const isPast = isPastSlot(date, slot);
        const conflict = findSlotConflict({
          appointments,
          date,
          duration,
          time: slot
        });

        return {
          conflict,
          disabled: isPast || Boolean(conflict),
          label: isPast
            ? `${slot} - hora pasada`
            : conflict
            ? `${slot} - empalma ${formatSlotRange(slot, duration)} con ${conflict.clientName} (${formatAppointmentRange(
                conflict
              )})`
            : slot,
          value: slot
        };
      }),
    [appointments, date, duration]
  );
  const filteredClients = useMemo(() => {
    const normalizedQuery = normalizeClientSearch(clientQuery);

    if (!normalizedQuery) {
      return clients;
    }

    return clients.filter((client) => normalizeClientSearch(client.fullName).includes(normalizedQuery));
  }, [clients, clientQuery]);

  useEffect(() => {
    const selectedSlot = slots.find((slot) => slot.value === time);

    if (selectedSlot?.disabled) {
      setTime("");
    }
  }, [slots, time]);

  useEffect(() => {
    function closePickerOnOutsideClick(event: MouseEvent) {
      if (clientPickerRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsClientPickerOpen(false);
    }

    document.addEventListener("mousedown", closePickerOnOutsideClick);

    return () => document.removeEventListener("mousedown", closePickerOnOutsideClick);
  }, []);

  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="grid gap-1">
          <span className="label">Cliente</span>
          <div className="relative" ref={clientPickerRef}>
            <input name="clientId" type="hidden" value={selectedClientId} />
            <input
              autoComplete="off"
              className="field pr-11"
              onChange={(event) => {
                setClientQuery(event.target.value);
                setSelectedClientId("");
                setIsClientPickerOpen(true);
              }}
              onFocus={() => setIsClientPickerOpen(true)}
              placeholder="Selecciona o busca un cliente"
              ref={clientSearchRef}
              role="combobox"
              type="search"
              value={clientQuery}
            />
            <button
              aria-label="Mostrar clientes"
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ink/65 hover:bg-cyan/10"
              onClick={() => {
                setIsClientPickerOpen((current) => !current);
                clientSearchRef.current?.focus();
              }}
              type="button"
            >
              <ChevronDown size={18} />
            </button>
            {isClientPickerOpen ? (
              <div className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-md border border-black/10 bg-white shadow-soft">
                {filteredClients.map((client) => {
                  const isSelected = client.id === selectedClientId;

                  return (
                    <button
                      className={`flex w-full items-center justify-between border-b border-black/10 px-3 py-2 text-left text-sm last:border-b-0 ${
                        isSelected ? "bg-cyan/10 font-semibold text-cyan" : "hover:bg-cyan/5"
                      }`}
                      key={client.id}
                      onClick={() => {
                        setClientQuery(client.fullName);
                        setSelectedClientId(client.id);
                        setIsClientPickerOpen(false);
                      }}
                      type="button"
                    >
                      <span>{client.fullName}</span>
                      {isSelected ? <span>Seleccionado</span> : null}
                    </button>
                  );
                })}
                {filteredClients.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-ink/60">No encontré clientes con ese nombre.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </label>
      </div>

      <label className="grid gap-1">
        <span className="label">Título</span>
        <input
          className="field"
          minLength={2}
          name="title"
          placeholder="Consulta, seguimiento, clase..."
          required
          type="text"
        />
      </label>

      <label className="grid gap-1">
        <span className="label">Duración min.</span>
        <input
          className="field"
          defaultValue="60"
          max="480"
          min="15"
          name="durationMin"
          onChange={(event) => setDuration(Number(event.target.value || 60))}
          required
          type="number"
        />
      </label>

      <label className="grid gap-1">
        <span className="label">Fecha</span>
        <input
          className="field"
          min={today}
          name="appointmentDate"
          onChange={(event) => setDate(event.target.value)}
          required
          type="date"
          value={date}
        />
      </label>

      <label className="grid gap-1">
        <span className="label">Hora</span>
        <select
          className="field"
          name="appointmentTime"
          onChange={(event) => setTime(event.target.value)}
          required
          value={time}
        >
          <option value="">Selecciona una hora</option>
          {slots.map((slot) => (
            <option disabled={slot.disabled} key={slot.value} value={slot.value}>
              {slot.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 md:col-span-2">
        <span className="label">Notas</span>
        <textarea className="field min-h-16 resize-y" name="notes" />
      </label>

      <button className="primary-button md:col-span-2" disabled={clients.length === 0 || !selectedClientId} type="submit">
        <Plus size={16} />
        Agendar cita
      </button>
    </form>
  );
}

function normalizeClientSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatSlotRange(time: string, duration: number) {
  const start = zonedDateTimeToUtc("2000-01-01", time);
  const end = new Date(start.getTime() + duration * 60 * 1000);

  return `${time}-${formatInputTime(end)}`;
}

function formatAppointmentRange(appointment: BlockingAppointment) {
  const startsAt = new Date(appointment.startsAt);
  const endsAt = new Date(startsAt.getTime() + appointment.durationMin * 60 * 1000);

  return `${formatInputTime(startsAt)}-${formatInputTime(endsAt)}`;
}

function isPastSlot(date: string, time: string) {
  return zonedDateTimeToUtc(date, time) <= new Date();
}

function findSlotConflict({
  appointments,
  date,
  duration,
  time
}: {
  appointments: BlockingAppointment[];
  date: string;
  duration: number;
  time: string;
}) {
  const slotStart = zonedDateTimeToUtc(date, time);
  const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

  return (
    appointments.find((appointment) => {
      if (!BLOCKING_STATUSES.has(appointment.status)) {
        return false;
      }

      const existingStart = new Date(appointment.startsAt);
      const existingEnd = new Date(existingStart.getTime() + appointment.durationMin * 60 * 1000);

      return slotStart < existingEnd && slotEnd > existingStart;
    }) ?? null
  );
}

function buildSlots() {
  const slots: string[] = [];

  for (let hour = SLOT_START_HOUR; hour <= SLOT_END_HOUR; hour += 1) {
    for (let minute = 0; minute < 60; minute += SLOT_INTERVAL_MIN) {
      if (hour === SLOT_END_HOUR && minute > 0) {
        continue;
      }

      slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }

  return slots;
}
