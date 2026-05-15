import type { Appointment, Client, WaitlistEntry } from "@prisma/client";
import { findAppointmentConflict } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { sendReminderToN8n } from "@/lib/n8n";
import { formatInputDate, formatInputTime, zonedDateTimeToUtc } from "@/lib/timezone";

type AppointmentWithClient = Appointment & {
  client: Client;
};

type WaitlistEntryWithClient = WaitlistEntry & {
  client: Client;
};

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export function waitlistEntryMatchesAppointment(
  entry: WaitlistEntry,
  appointment: Appointment
) {
  if (entry.status !== "WAITING") {
    return false;
  }

  const appointmentDate = formatInputDate(appointment.startsAt);

  if (entry.desiredDate !== appointmentDate) {
    return false;
  }

  const appointmentStart = timeToMinutes(formatInputTime(appointment.startsAt));
  const appointmentEnd = appointmentStart + appointment.durationMin;
  const desiredStart = timeToMinutes(entry.startTime);
  const desiredEnd = timeToMinutes(entry.endTime);

  return appointmentStart >= desiredStart && appointmentEnd <= desiredEnd;
}

export async function notifyWaitlistForAvailableSlot(appointment: AppointmentWithClient) {
  const entries = await prisma.waitlistEntry.findMany({
    where: {
      userId: appointment.userId,
      status: "WAITING",
      desiredDate: formatInputDate(appointment.startsAt),
      durationMin: { lte: appointment.durationMin }
    },
    include: { client: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 10
  });
  const matchingEntries = entries.filter((entry) =>
    waitlistEntryMatchesAppointment(entry, appointment)
  );

  for (const entry of matchingEntries) {
    const message = `Hola ${entry.client.fullName}, se liberó un horario para "${entry.title}" el ${formatDateTime(
      appointment.startsAt
    )}. Responde SI para agendarlo o NO para seguir en lista de espera.`;

    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: "OFFERED",
        offeredStartsAt: appointment.startsAt,
        offeredAt: new Date()
      }
    });

    await prisma.chatMessage.create({
      data: {
        userId: entry.userId,
        clientId: entry.clientId,
        waitlistEntryId: entry.id,
        direction: "OUTBOUND",
        message,
        intent: "WAITLIST_OFFER"
      }
    });

    await sendReminderToN8n({
      client: entry.client,
      appointment: null,
      event: "waitlist.slot.available",
      message
    });
  }

  return matchingEntries.length;
}

export async function findPendingWaitlistOfferByPhone(phone: string) {
  const normalized = normalizePhone(phone);
  const clients = await prisma.client.findMany({
    where: {
      phone: {
        contains: normalized.slice(-10)
      }
    },
    select: { id: true },
    take: 10
  });
  const clientIds = clients.map((client) => client.id);

  if (clientIds.length === 0) {
    return null;
  }

  const recentOffer = await prisma.chatMessage.findFirst({
    where: {
      clientId: { in: clientIds },
      direction: "OUTBOUND",
      intent: "WAITLIST_OFFER",
      waitlistEntry: {
        is: {
          status: "OFFERED",
          offeredStartsAt: { not: null }
        }
      }
    },
    include: {
      waitlistEntry: {
        include: { client: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return recentOffer?.waitlistEntry ?? null;
}

export async function bookWaitlistOffer(entry: WaitlistEntryWithClient) {
  if (!entry.offeredStartsAt) {
    return {
      action: "WAITLIST_OFFER_EXPIRED",
      ok: true
    };
  }

  const conflict = await findAppointmentConflict({
    userId: entry.userId,
    startsAt: entry.offeredStartsAt,
    durationMin: entry.durationMin
  });

  if (conflict) {
    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: "WAITING",
        offeredStartsAt: null,
        offeredAt: null
      }
    });

    const message = `Lo siento ${entry.client.fullName}, ese horario ya fue ocupado. Te mantenemos en lista de espera.`;

    await prisma.chatMessage.create({
      data: {
        userId: entry.userId,
        clientId: entry.clientId,
        waitlistEntryId: entry.id,
        direction: "OUTBOUND",
        message,
        intent: "WAITLIST_CONFLICT_REPLY"
      }
    });

    await sendReminderToN8n({
      client: entry.client,
      appointment: null,
      event: "waitlist.slot.conflict",
      message
    });

    return {
      action: "WAITLIST_CONFLICT",
      ok: true
    };
  }

  const appointment = await prisma.appointment.create({
    data: {
      userId: entry.userId,
      clientId: entry.clientId,
      title: entry.title,
      startsAt: entry.offeredStartsAt,
      durationMin: entry.durationMin,
      status: "CONFIRMED",
      notes: entry.notes ? `Desde lista de espera. ${entry.notes}` : "Desde lista de espera."
    }
  });

  await prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: {
      status: "BOOKED",
      bookedAppointmentId: appointment.id
    }
  });

  const message = `Perfecto ${entry.client.fullName}, tu cita "${entry.title}" quedó agendada para ${formatDateTime(
    appointment.startsAt
  )}.`;

  await prisma.chatMessage.create({
    data: {
      userId: entry.userId,
      clientId: entry.clientId,
      appointmentId: appointment.id,
      waitlistEntryId: entry.id,
      direction: "OUTBOUND",
      message,
      intent: "WAITLIST_BOOKED_REPLY"
    }
  });

  await sendReminderToN8n({
    client: entry.client,
    appointment,
    event: "waitlist.slot.booked",
    message
  });

  return {
    action: "WAITLIST_BOOKED",
    appointmentId: appointment.id,
    ok: true
  };
}

export async function declineWaitlistOffer(entry: WaitlistEntryWithClient) {
  await prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: {
      status: "WAITING",
      offeredStartsAt: null,
      offeredAt: null
    }
  });

  const message = `Entendido ${entry.client.fullName}, te mantenemos en lista de espera.`;

  await prisma.chatMessage.create({
    data: {
      userId: entry.userId,
      clientId: entry.clientId,
      waitlistEntryId: entry.id,
      direction: "OUTBOUND",
      message,
      intent: "WAITLIST_DECLINED_REPLY"
    }
  });

  await sendReminderToN8n({
    client: entry.client,
    appointment: null,
    event: "waitlist.slot.declined",
    message
  });

  return {
    action: "WAITLIST_DECLINED",
    ok: true
  };
}

export function getWaitlistStartDateTime(entry: WaitlistEntry) {
  return zonedDateTimeToUtc(entry.desiredDate, entry.startTime);
}
