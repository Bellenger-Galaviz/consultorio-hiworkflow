import type { Appointment, Client, User } from "@prisma/client";
import { findAppointmentConflict } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import {
  createAppointmentStatusNotification,
  createClientMessageNotification,
  createUnknownContactNotification
} from "@/lib/notifications";
import { sendReminderToN8n } from "@/lib/n8n";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import {
  bookWaitlistOffer,
  declineWaitlistOffer,
  findPendingWaitlistOfferByPhone,
  notifyWaitlistForAvailableSlot
} from "@/lib/waitlist";

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

function isWaitlistConfirm(text: string) {
  const normalized = normalizeText(text);

  return /\b(si|sí|confirmo|acepto|quiero|agendalo|agendar)\b/.test(normalized);
}

function isWaitlistDecline(text: string) {
  const normalized = normalizeText(text);

  return /\b(no|paso|no puedo|cancelar|cancelo)\b/.test(normalized);
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
  const statusFilter = ["PENDING", "CONFIRMED", "REPROGRAM_PENDING", "CANCELLED"];

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
          status: { in: statusFilter }
        },
        orderBy: { startsAt: "asc" },
        take: 5
      }
    },
    take: 10
  });

  const clientIds = clients.map((client) => client.id);
  const recentChat = clientIds.length
    ? await prisma.chatMessage.findFirst({
        where: {
          clientId: { in: clientIds },
          appointment: {
            is: {
              startsAt: { gt: now },
              status: { in: statusFilter }
            }
          }
        },
        include: {
          appointment: { include: { client: true } },
          client: true
        },
        orderBy: { createdAt: "desc" }
      })
    : null;

  if (recentChat?.appointment) {
    return {
      client: recentChat.client,
      appointment: {
        ...recentChat.appointment,
        client: recentChat.client
      } as AppointmentWithClient
    };
  }

  const client = clients.find((item) =>
    item.appointments.some((appointment) => appointment.status !== "CANCELLED")
  );
  const appointment = client?.appointments.find((item) => item.status !== "CANCELLED");

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

async function findClientByPhone(phone: string) {
  const normalized = normalizePhone(phone);

  if (!normalized) {
    return null;
  }

  return prisma.client.findFirst({
    where: {
      phone: {
        contains: normalized.slice(-10)
      }
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function resolveUnknownContactOwner() {
  const configuredEmail = process.env.INBOUND_DEFAULT_USER_EMAIL?.trim();

  if (configuredEmail) {
    const configuredUser = await prisma.user.findUnique({
      where: { email: configuredEmail }
    });

    if (configuredUser) {
      return configuredUser;
    }
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    take: 2
  });

  return users.length === 1 ? users[0] : null;
}

async function recordKnownClientMessage(client: Client, message: string, intent: string) {
  await prisma.chatMessage.create({
    data: {
      userId: client.userId,
      clientId: client.id,
      direction: "INBOUND",
      message,
      intent
    }
  });

  await createClientMessageNotification(client, message);
}

async function recordUnknownContactMessage(user: User, phone: string, message: string, intent: string) {
  const normalizedPhone = normalizePhone(phone);
  const contact = await prisma.unknownContact.upsert({
    where: {
      userId_phone: {
        userId: user.id,
        phone: normalizedPhone
      }
    },
    create: {
      userId: user.id,
      phone: normalizedPhone,
      displayName: `Número nuevo ${normalizedPhone}`
    },
    update: {
      status: "NEW"
    }
  });

  await prisma.unknownContactMessage.create({
    data: {
      userId: user.id,
      unknownContactId: contact.id,
      direction: "INBOUND",
      message,
      intent
    }
  });

  await createUnknownContactNotification(contact, message);

  return contact;
}

async function recordMessageWithoutActiveAppointment(input: IncomingMessage, intent: string) {
  const client = await findClientByPhone(input.phone);

  if (client) {
    await recordKnownClientMessage(client, input.message, intent);

    return {
      ok: true,
      action: "CLIENT_MESSAGE_RECORDED",
      clientId: client.id
    };
  }

  const owner = await resolveUnknownContactOwner();

  if (!owner) {
    return {
      ok: true,
      action: "NO_OWNER_FOR_UNKNOWN_CONTACT"
    };
  }

  const contact = await recordUnknownContactMessage(owner, input.phone, input.message, intent);

  return {
    ok: true,
    action: "UNKNOWN_CONTACT_RECORDED",
    unknownContactId: contact.id
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

async function reprogramAppointment(appointment: AppointmentWithClient, proposedDate: Date) {
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

export async function handleIncomingWhatsAppMessage(input: IncomingMessage) {
  const found = await findActiveAppointment(input.phone);
  const waitlistOffer = await findPendingWaitlistOfferByPhone(input.phone);
  const intent = detectIntent(input.message);

  if (!found && !waitlistOffer) {
    return recordMessageWithoutActiveAppointment(input, intent);
  }

  if (waitlistOffer && isWaitlistConfirm(input.message)) {
    const entry = waitlistOffer.offeredEntry;

    if (!entry) {
      return { ok: true, action: "WAITLIST_OFFER_EXPIRED" };
    }

    await prisma.chatMessage.create({
      data: {
        userId: waitlistOffer.userId,
        clientId: entry.clientId,
        waitlistEntryId: entry.id,
        waitlistOpportunityId: waitlistOffer.id,
        direction: "INBOUND",
        message: input.message,
        intent: "WAITLIST_ACCEPT"
      }
    });

    return bookWaitlistOffer(waitlistOffer);
  }

  if (waitlistOffer && isWaitlistDecline(input.message)) {
    const entry = waitlistOffer.offeredEntry;

    if (!entry) {
      return { ok: true, action: "WAITLIST_DECLINED" };
    }

    await prisma.chatMessage.create({
      data: {
        userId: waitlistOffer.userId,
        clientId: entry.clientId,
        waitlistEntryId: entry.id,
        waitlistOpportunityId: waitlistOffer.id,
        direction: "INBOUND",
        message: input.message,
        intent: "WAITLIST_DECLINE"
      }
    });

    return declineWaitlistOffer(waitlistOffer);
  }

  if (!found) {
    return recordMessageWithoutActiveAppointment(input, intent);
  }

  const { appointment } = found;

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

  const proposedDate = parseSpanishDateTime(input.message);

  if (appointment.status === "CANCELLED") {
    if (proposedDate) {
      return reprogramAppointment(appointment, proposedDate);
    }

    if (intent === "REPROGRAM_REQUEST") {
      const reprogramAppointment = await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "REPROGRAM_PENDING" },
        include: { client: true }
      });
      await createAppointmentStatusNotification(reprogramAppointment, "REPROGRAM_PENDING");

      const message = `Claro ${appointment.client.fullName}. Esta cita estaba cancelada; para reprogramarla responde con la nueva fecha y hora en formato DD/MM/AAAA HH:mm, por ejemplo 25/05/2026 16:30.`;

      await reply(appointment, message, "ASK_REPROGRAM_DATE");

      return { ok: true, action: "ASKED_REPROGRAM_DATE", appointmentId: appointment.id };
    }

    if (intent === "CONFIRM") {
      const message = `${appointment.client.fullName}, esa cita ya fue cancelada y no se puede volver a activar con CONFIRMO. Responde REPROGRAMAR si quieres agendar una nueva fecha.`;

      await reply(appointment, message, "CANCELLED_CONFIRM_REJECTED");

      return { ok: true, action: "CANCELLED_CONFIRM_REJECTED", appointmentId: appointment.id };
    }

    const message = `${appointment.client.fullName}, esa cita está cancelada. Responde REPROGRAMAR si quieres agendar una nueva fecha.`;

    await reply(appointment, message, "CANCELLED_FALLBACK_REPLY");

    return { ok: true, action: "CANCELLED_FALLBACK", appointmentId: appointment.id };
  }

  if (appointment.status === "REPROGRAM_PENDING" && proposedDate) {
    return reprogramAppointment(appointment, proposedDate);
  }

  if (appointment.status === "REPROGRAM_PENDING" && intent === "CONFIRM") {
    const message = `${appointment.client.fullName}, esta cita está pendiente de reprogramación. Responde con la nueva fecha y hora en formato DD/MM/AAAA HH:mm para dejarla agendada.`;

    await reply(appointment, message, "REPROGRAM_CONFIRM_REJECTED");

    return { ok: true, action: "REPROGRAM_CONFIRM_REJECTED", appointmentId: appointment.id };
  }

  if (intent === "CONFIRM") {
    const confirmedAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CONFIRMED" },
      include: { client: true }
    });
    await createAppointmentStatusNotification(confirmedAppointment, "CONFIRMED");

    const message = `Gracias ${appointment.client.fullName}, tu cita "${appointment.title}" queda confirmada para ${formatDateTime(
      appointment.startsAt
    )}.`;

    await reply(appointment, message, "CONFIRM_REPLY");

    return { ok: true, action: "CONFIRMED", appointmentId: appointment.id };
  }

  if (intent === "CANCEL") {
    const cancelledAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CANCELLED" },
      include: { client: true }
    });

    const message = `Entendido ${appointment.client.fullName}, tu cita "${appointment.title}" del ${formatDateTime(
      appointment.startsAt
    )} quedó cancelada.`;

    await reply(appointment, message, "CANCEL_REPLY");
    await createAppointmentStatusNotification(cancelledAppointment, "CANCELLED");
    await notifyWaitlistForAvailableSlot(cancelledAppointment);

    return { ok: true, action: "CANCELLED", appointmentId: appointment.id };
  }

  if (intent === "REPROGRAM_REQUEST") {
    const reprogramAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "REPROGRAM_PENDING" },
      include: { client: true }
    });
    await createAppointmentStatusNotification(reprogramAppointment, "REPROGRAM_PENDING");
    await notifyWaitlistForAvailableSlot(reprogramAppointment);

    const message = `Claro ${appointment.client.fullName}. Responde con la nueva fecha y hora en formato DD/MM/AAAA HH:mm, por ejemplo 25/05/2026 16:30.`;

    await reply(appointment, message, "ASK_REPROGRAM_DATE");

    return { ok: true, action: "ASKED_REPROGRAM_DATE", appointmentId: appointment.id };
  }

  const fallback = `Gracias por tu mensaje. Responde CONFIRMO para confirmar, CANCELAR para cancelar o REPROGRAMAR para cambiar tu cita.`;

  await reply(appointment, fallback, "FALLBACK_REPLY");
  await createClientMessageNotification(appointment.client, input.message);

  return { ok: true, action: "FALLBACK", appointmentId: appointment.id };
}
