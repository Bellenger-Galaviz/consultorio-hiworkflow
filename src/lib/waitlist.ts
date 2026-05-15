import type { Appointment, Client, WaitlistEntry, WaitlistOpportunity } from "@prisma/client";
import { findAppointmentConflict, getNextClientAppointmentNumber } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { sendReminderToN8n } from "@/lib/n8n";
import { formatInputDate, formatInputTime } from "@/lib/timezone";

type AppointmentWithClient = Appointment & {
  client: Client;
};

type OpportunityWithEntry = WaitlistOpportunity & {
  offeredEntry: (WaitlistEntry & { client: Client }) | null;
};

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export function waitlistEntryMatchesSlot(
  entry: WaitlistEntry,
  startsAt: Date,
  durationMin: number
) {
  if (entry.status !== "WAITING") {
    return false;
  }

  if (entry.desiredDate !== formatInputDate(startsAt) || entry.durationMin > durationMin) {
    return false;
  }

  const slotStart = timeToMinutes(formatInputTime(startsAt));
  const slotEnd = slotStart + durationMin;
  const desiredStart = timeToMinutes(entry.startTime);
  const desiredEnd = timeToMinutes(entry.endTime);

  return slotStart >= desiredStart && slotEnd <= desiredEnd;
}

export function waitlistEntryMatchesOpportunity(
  entry: WaitlistEntry,
  opportunity: WaitlistOpportunity
) {
  return waitlistEntryMatchesSlot(entry, opportunity.startsAt, opportunity.durationMin);
}

export async function notifyWaitlistForAvailableSlot(appointment: AppointmentWithClient) {
  const entries = await prisma.waitlistEntry.findMany({
    where: {
      userId: appointment.userId,
      status: "WAITING",
      desiredDate: formatInputDate(appointment.startsAt),
      durationMin: { lte: appointment.durationMin }
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 20
  });
  const matchingEntries = entries.filter((entry) =>
    waitlistEntryMatchesSlot(entry, appointment.startsAt, appointment.durationMin)
  );

  if (matchingEntries.length === 0) {
    return null;
  }

  const existingOpportunity = await prisma.waitlistOpportunity.findFirst({
    where: {
      userId: appointment.userId,
      sourceAppointmentId: appointment.id,
      status: { in: ["AVAILABLE", "OFFERED"] }
    }
  });
  const opportunity =
    existingOpportunity ??
    (await prisma.waitlistOpportunity.create({
      data: {
        userId: appointment.userId,
        sourceAppointmentId: appointment.id,
        startsAt: appointment.startsAt,
        durationMin: appointment.durationMin
      }
    }));

  await prisma.notification.create({
    data: {
      userId: appointment.userId,
      type: "WAITLIST_SLOT_AVAILABLE",
      title: "Horario disponible para lista de espera",
      body: `Se liberó ${formatDateTime(appointment.startsAt)} para ${matchingEntries.length} cliente${
        matchingEntries.length === 1 ? "" : "s"
      } en lista de espera.`,
      target: "#lista-espera",
      appointmentId: appointment.id,
      waitlistEntryId: matchingEntries[0]?.id,
      waitlistOpportunityId: opportunity.id
    }
  });

  return opportunity;
}

export async function offerWaitlistOpportunity({
  entryId,
  opportunityId,
  userId
}: {
  entryId: string;
  opportunityId: string;
  userId: string;
}) {
  const opportunity = await prisma.waitlistOpportunity.findFirst({
    where: {
      id: opportunityId,
      userId,
      status: "AVAILABLE"
    }
  });

  if (!opportunity) {
    throw new Error("El horario ya no está disponible para ofrecer.");
  }

  const entry = await prisma.waitlistEntry.findFirst({
    where: {
      id: entryId,
      userId,
      status: "WAITING"
    },
    include: { client: true }
  });

  if (!entry || !waitlistEntryMatchesOpportunity(entry, opportunity)) {
    throw new Error("Ese cliente ya no coincide con el horario disponible.");
  }

  const conflict = await findAppointmentConflict({
    userId,
    startsAt: opportunity.startsAt,
    durationMin: entry.durationMin
  });

  if (conflict) {
    await prisma.waitlistOpportunity.update({
      where: { id: opportunity.id },
      data: { status: "EXPIRED" }
    });

    throw new Error("Ese horario ya fue ocupado por otra cita.");
  }

  const message = `Hola ${entry.client.fullName}, se liberó un horario para "${entry.title}" el ${formatDateTime(
    opportunity.startsAt
  )}. Responde SI para agendarlo o NO para seguir en lista de espera.`;

  const locked = await prisma.waitlistOpportunity.updateMany({
    where: { id: opportunity.id, status: "AVAILABLE" },
    data: {
      status: "OFFERED",
      offeredEntryId: entry.id,
      offeredAt: new Date()
    }
  });

  if (locked.count === 0) {
    throw new Error("Ese horario acaba de ser ofrecido a otro cliente.");
  }

  try {
    await sendReminderToN8n({
      client: entry.client,
      appointment: null,
      event: "waitlist.slot.available",
      message
    });
  } catch (error) {
    await prisma.waitlistOpportunity.update({
      where: { id: opportunity.id },
      data: {
        status: "AVAILABLE",
        offeredEntryId: null,
        offeredAt: null
      }
    });

    throw error;
  }

  await prisma.chatMessage.create({
    data: {
      userId,
      clientId: entry.clientId,
      waitlistEntryId: entry.id,
      waitlistOpportunityId: opportunity.id,
      direction: "OUTBOUND",
      message,
      intent: "WAITLIST_OFFER"
    }
  });

  await prisma.notification.create({
    data: {
      userId,
      type: "WAITLIST_OFFER_SENT",
      title: "Oferta enviada",
      body: `Se ofreció ${formatDateTime(opportunity.startsAt)} a ${entry.client.fullName}.`,
      target: "#lista-espera",
      waitlistEntryId: entry.id,
      waitlistOpportunityId: opportunity.id
    }
  });

  return { entry, opportunity };
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

  return prisma.waitlistOpportunity.findFirst({
    where: {
      status: "OFFERED",
      offeredEntry: {
        is: {
          clientId: { in: clientIds },
          status: "WAITING"
        }
      }
    },
    include: {
      offeredEntry: {
        include: { client: true }
      }
    },
    orderBy: { offeredAt: "desc" }
  });
}

export async function bookWaitlistOffer(opportunity: OpportunityWithEntry) {
  const entry = opportunity.offeredEntry;

  if (!entry) {
    return { action: "WAITLIST_OFFER_EXPIRED", ok: true };
  }

  const locked = await prisma.waitlistOpportunity.updateMany({
    where: {
      id: opportunity.id,
      offeredEntryId: entry.id,
      status: "OFFERED"
    },
    data: { status: "BOOKING" }
  });

  if (locked.count === 0) {
    return { action: "WAITLIST_OFFER_EXPIRED", ok: true };
  }

  const conflict = await findAppointmentConflict({
    userId: opportunity.userId,
    startsAt: opportunity.startsAt,
    durationMin: entry.durationMin,
    ignoreAppointmentId: entry.fallbackAppointmentId ?? undefined
  });

  if (conflict) {
    await prisma.waitlistOpportunity.update({
      where: { id: opportunity.id },
      data: {
        status: "EXPIRED"
      }
    });

    const message = `Lo siento ${entry.client.fullName}, ese horario ya fue ocupado. Te mantenemos en lista de espera.`;

    await prisma.chatMessage.create({
      data: {
        userId: opportunity.userId,
        clientId: entry.clientId,
        waitlistEntryId: entry.id,
        waitlistOpportunityId: opportunity.id,
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

    return { action: "WAITLIST_CONFLICT", ok: true };
  }

  const fallbackAppointment = entry.fallbackAppointmentId
    ? await prisma.appointment.findFirst({
        where: {
          id: entry.fallbackAppointmentId,
          userId: opportunity.userId,
          clientId: entry.clientId
        }
      })
    : null;
  const appointment = fallbackAppointment
    ? await prisma.appointment.update({
        where: { id: fallbackAppointment.id },
        data: {
          previousStartsAt: fallbackAppointment.startsAt,
          startsAt: opportunity.startsAt,
          durationMin: entry.durationMin,
          status: "CONFIRMED",
          notes: `${fallbackAppointment.notes ?? ""}\nAdelantada desde lista de espera de ${formatDateTime(
            fallbackAppointment.startsAt
          )} a ${formatDateTime(opportunity.startsAt)}.`.trim()
        }
      })
    : await prisma.appointment.create({
        data: {
          userId: opportunity.userId,
          clientId: entry.clientId,
          clientAppointmentNumber:
            entry.clientAppointmentNumber ?? (await getNextClientAppointmentNumber(entry.clientId)),
          title: entry.title,
          startsAt: opportunity.startsAt,
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

  await prisma.waitlistOpportunity.update({
    where: { id: opportunity.id },
    data: {
      status: "BOOKED",
      bookedAppointmentId: appointment.id
    }
  });

  await prisma.notification.create({
    data: {
      userId: opportunity.userId,
      type: "WAITLIST_BOOKED",
      title: "Lista de espera agendada",
      body: `${entry.client.fullName} aceptó el horario de ${formatDateTime(appointment.startsAt)}.`,
      target: `/?day=${formatInputDate(appointment.startsAt)}`,
      appointmentId: appointment.id,
      waitlistEntryId: entry.id,
      waitlistOpportunityId: opportunity.id
    }
  });

  const message = `Perfecto ${entry.client.fullName}, tu cita "${entry.title}" quedó agendada para ${formatDateTime(
    appointment.startsAt
  )}.`;

  await prisma.chatMessage.create({
    data: {
      userId: opportunity.userId,
      clientId: entry.clientId,
      appointmentId: appointment.id,
      waitlistEntryId: entry.id,
      waitlistOpportunityId: opportunity.id,
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

  return { action: "WAITLIST_BOOKED", appointmentId: appointment.id, ok: true };
}

export async function declineWaitlistOffer(opportunity: OpportunityWithEntry) {
  const entry = opportunity.offeredEntry;

  if (!entry) {
    return { action: "WAITLIST_DECLINED", ok: true };
  }

  await prisma.waitlistOpportunity.update({
    where: { id: opportunity.id },
    data: {
      status: "AVAILABLE",
      offeredEntryId: null,
      offeredAt: null
    }
  });

  const message = `Entendido ${entry.client.fullName}, te mantenemos en lista de espera.`;

  await prisma.chatMessage.create({
    data: {
      userId: opportunity.userId,
      clientId: entry.clientId,
      waitlistEntryId: entry.id,
      waitlistOpportunityId: opportunity.id,
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

  return { action: "WAITLIST_DECLINED", ok: true };
}
