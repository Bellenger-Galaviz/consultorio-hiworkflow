import type { Appointment, Client } from "@prisma/client";
import { findAppointmentConflict } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { sendReminderToN8n } from "@/lib/n8n";
import { zonedDateTimeToUtc } from "@/lib/timezone";

type AppointmentWithClient = Appointment & {
  client: Client;
};

type IncomingMessage = {
  phone: string;
  message: string;
};

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function detectIntent(text: string) {
  const normalized = normalizeText(text);

  if (
    /\b(cancel\w*|no voy|no asistire|no podre|no puedo asistir)\b/.test(
      normalized
    )
  ) {
    return "CANCEL";
  }

  if (/\b(reprogramar|cambiar|mover|posponer|pospongo|no puedo)\b/.test(normalized)) {
    return "REPROGRAM_REQUEST";
  }

  if (/\b(confirmo|confirmar|si|ok|asisto|voy)\b/.test(normalized)) {
    return "CONFIRM";
  }

  return "UNKNOWN";
}

function parseSpanishDateTime(text: string) {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
  );

  if (!match) {
    return null;
  }

  const now = new Date();
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const yearPart = match[3] ? Number(match[3]) : now.getFullYear();
  const year = yearPart < 100 ? 2000 + yearPart : yearPart;
  let hour = Number(match[4]);
  const minute = match[5] ? Number(match[5]) : 0;
  const meridiem = match[6];

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  }

  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  const date = zonedDateTimeToUtc(
    `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  );

  if (Number.isNaN(date.getTime()) || date <= now) {
    return null;
  }

  return date;
}

async function findActiveAppointment(phone: string) {
  const normalized = normalizePhone(phone);
  const now = new Date();

  const clients = await prisma.client.findMany({
    where: {
      phone: {
        contains: normalized.slice(-10)
      }
    },
    include: {
      appointments: {
        where: {
          startsAt: { gt: now },
          status: { in: ["PENDING", "CONFIRMED", "REPROGRAM_PENDING"] }
        },
        orderBy: { startsAt: "asc" },
        take: 1
      }
    },
    take: 10
  });

  const client = clients.find((item) => item.appointments.length > 0);
  const appointment = client?.appointments[0];

  if (!client || !appointment) {
    return null;
  }

  return {
    client,
    appointment: {
      ...appointment,
      client
    } as AppointmentWithClient
  };
}

async function reply(appointment: AppointmentWithClient, message: string, intent: string) {
  await prisma.chatMessage.create({
    data: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      direction: "OUTBOUND",
      message,
      intent
    }
  });

  await sendReminderToN8n({
    client: appointment.client,
    appointment,
    message
  });
}

export async function handleIncomingWhatsAppMessage(input: IncomingMessage) {
  const found = await findActiveAppointment(input.phone);

  if (!found) {
    return {
      ok: true,
      action: "NO_ACTIVE_APPOINTMENT"
    };
  }

  const { appointment } = found;
  const intent = detectIntent(input.message);

  await prisma.chatMessage.create({
    data: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      direction: "INBOUND",
      message: input.message,
      intent
    }
  });

  if (intent === "CONFIRM") {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CONFIRMED" }
    });

    const message = `Gracias ${appointment.client.fullName}, tu cita "${appointment.title}" queda confirmada para ${formatDateTime(
      appointment.startsAt
    )}.`;

    await reply(appointment, message, "CONFIRM_REPLY");

    return { ok: true, action: "CONFIRMED", appointmentId: appointment.id };
  }

  if (intent === "CANCEL") {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CANCELLED" }
    });

    const message = `Entendido ${appointment.client.fullName}, tu cita "${appointment.title}" del ${formatDateTime(
      appointment.startsAt
    )} quedó cancelada.`;

    await reply(appointment, message, "CANCEL_REPLY");

    return { ok: true, action: "CANCELLED", appointmentId: appointment.id };
  }

  const proposedDate = parseSpanishDateTime(input.message);

  if (appointment.status === "REPROGRAM_PENDING" && proposedDate) {
    const conflict = await findAppointmentConflict({
      userId: appointment.userId,
      startsAt: proposedDate,
      durationMin: appointment.durationMin,
      ignoreAppointmentId: appointment.id
    });

    if (conflict) {
      const message =
        "Ese horario ya está ocupado. Por favor responde con otra fecha y hora en formato DD/MM/AAAA HH:mm.";

      await reply(appointment, message, "REPROGRAM_CONFLICT_REPLY");

      return { ok: true, action: "REPROGRAM_CONFLICT", appointmentId: appointment.id };
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        previousStartsAt: appointment.previousStartsAt ?? appointment.startsAt,
        startsAt: proposedDate,
        status: "PENDING",
        notes: `${appointment.notes ?? ""}\nReprogramada de ${formatDateTime(appointment.startsAt)} a ${formatDateTime(
          proposedDate
        )}.`.trim()
      },
      include: { client: true }
    });

    const message = `Listo ${appointment.client.fullName}, registramos tu nueva cita "${appointment.title}" para ${formatDateTime(
      proposedDate
    )}.`;

    await reply(updatedAppointment, message, "REPROGRAM_CONFIRM_REPLY");

    return {
      ok: true,
      action: "REPROGRAMMED",
      appointmentId: appointment.id
    };
  }

  if (intent === "REPROGRAM_REQUEST") {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "REPROGRAM_PENDING" }
    });

    const message = `Claro ${appointment.client.fullName}. Responde con la nueva fecha y hora en formato DD/MM/AAAA HH:mm, por ejemplo 25/05/2026 16:30.`;

    await reply(appointment, message, "ASK_REPROGRAM_DATE");

    return { ok: true, action: "ASKED_REPROGRAM_DATE", appointmentId: appointment.id };
  }

  const fallback = `Gracias por tu mensaje. Responde CONFIRMO para confirmar, CANCELAR para cancelar o REPROGRAMAR para cambiar tu cita.`;

  await reply(appointment, fallback, "FALLBACK_REPLY");

  return { ok: true, action: "FALLBACK", appointmentId: appointment.id };
}
