"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatClinicTime, formatInputDate, zonedDateTimeToUtc } from "@/lib/timezone";
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
            ? `${slot} - ocupado con ${conflict.clientName} (${formatClinicTime(new Date(conflict.startsAt))})`
            : slot,
          value: slot
        };
      }),
    [appointments, date, duration]
  );

  useEffect(() => {
    const selectedSlot = slots.find((slot) => slot.value === time);

    if (selectedSlot?.disabled) {
      setTime("");
    }
  }, [slots, time]);

  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="grid gap-1">
          <span className="label">Cliente</span>
          <select className="field" name="clientId" required>
            <option value="">Selecciona un cliente</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.fullName}
              </option>
            ))}
          </select>
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

      <button className="primary-button md:col-span-2" disabled={clients.length === 0} type="submit">
        <Plus size={16} />
        Agendar cita
      </button>
    </form>
  );
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
