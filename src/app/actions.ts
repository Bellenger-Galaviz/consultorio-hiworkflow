"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { findAppointmentConflict, getNextClientAppointmentNumber } from "@/lib/appointments";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createAppointmentStatusNotification } from "@/lib/notifications";
import { sendReminderToN8n } from "@/lib/n8n";
import { sendAppointmentReminderByType } from "@/lib/reminders";
import { formatClinicTime, zonedDateTimeToUtc } from "@/lib/timezone";
import { notifyWaitlistForAvailableSlot, offerWaitlistOpportunity } from "@/lib/waitlist";

const clientSchema = z.object({
  fullName: z.string().trim().min(2),
  phone: z.string().trim().min(8).max(20),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional()
});

const appointmentSchema = z.object({
  appointmentDate: z.string().min(1),
  appointmentTime: z.string().min(1),
  clientId: z.string().min(1),
  durationMin: z.coerce.number().min(15).max(480),
  title: z.string().trim().min(2),
  notes: z.string().optional()
});

const crmMessageSchema = z.object({
  clientId: z.string().min(1),
  message: z.string().trim().min(1).max(1000)
});

const deleteClientSchema = z.object({
  clientId: z.string().min(1)
});

const updateClientSchema = clientSchema.extend({
  clientId: z.string().min(1)
});

const waitlistSchema = z.object({
  clientId: z.string().min(1),
  desiredDate: z.string().min(1),
  durationMin: z.coerce.number().min(15).max(480),
  endTime: z.string().min(1),
  fallbackDate: z.string().optional(),
  fallbackTime: z.string().optional(),
  notes: z.string().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  startTime: z.string().min(1),
  title: z.string().trim().min(2)
});

const deleteWaitlistSchema = z.object({
  waitlistEntryId: z.string().min(1)
});

const offerWaitlistSchema = z.object({
  opportunityId: z.string().min(1),
  waitlistEntryId: z.string().min(1)
});

function goHomeWithError(message: string): never {
  redirect(`/?error=${encodeURIComponent(message)}`);
}

function goHomeWithSuccess(message: string): never {
  redirect(`/?success=${encodeURIComponent(message)}`);
}

function redirectWithMessage(returnTo: string, type: "error" | "success", message: string): never {
  const url = new URL(returnTo.startsWith("/") ? returnTo : "/", "https://consultorio.local");

  url.searchParams.set(type, message);
  redirect(`${url.pathname}${url.search}`);
}

function getReturnTo(formData: FormData) {
  const value = String(formData.get("returnTo") ?? "/");

  return value.startsWith("/") ? value : "/";
}

function formatConflictTime(date: Date) {
  return formatClinicTime(date);
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createClient(formData: FormData) {
  const user = await requireUser();
  const result = clientSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Revisa el nombre, WhatsApp y correo del cliente.");
  }

  const data = result.data;
  const phone = normalizePhone(data.phone);
  const fullNameKey = normalizeName(data.fullName);
  const existingClients = await prisma.client.findMany({
    where: { userId: user.id },
    select: { fullName: true, phone: true }
  });
  const duplicatePhone = existingClients.some((client) => normalizePhone(client.phone) === phone);
  const duplicateName = existingClients.some((client) => normalizeName(client.fullName) === fullNameKey);

  if (duplicatePhone) {
    goHomeWithError("Ya existe un cliente con ese número de WhatsApp.");
  }

  if (duplicateName) {
    goHomeWithError("Ya existe un cliente con ese nombre.");
  }

  try {
    await prisma.client.create({
      data: {
        userId: user.id,
        fullName: data.fullName,
        phone,
        email: data.email || null,
        notes: data.notes || null
      }
    });
  } catch {
    goHomeWithError("No se pudo guardar el cliente. Intenta de nuevo.");
  }

  revalidatePath("/");
  goHomeWithSuccess("Cliente guardado.");
}

export async function deleteClient(formData: FormData) {
  const user = await requireUser();
  const result = deleteClientSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Selecciona un cliente válido.");
  }

  const deleted = await prisma.client
    .deleteMany({
      where: {
        id: result.data.clientId,
        userId: user.id
      }
    })
    .catch(() => ({ count: 0 }));

  if (deleted.count === 0) {
    goHomeWithError("No se encontró el cliente seleccionado.");
  }

  revalidatePath("/");
  goHomeWithSuccess("Cliente eliminado.");
}

export async function updateClient(formData: FormData) {
  const user = await requireUser();
  const result = updateClientSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Revisa el nombre, WhatsApp y correo del cliente.");
  }

  const data = result.data;
  const phone = normalizePhone(data.phone);
  const fullNameKey = normalizeName(data.fullName);
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, userId: user.id }
  });

  if (!client) {
    goHomeWithError("No se encontró el cliente seleccionado.");
  }

  const existingClients = await prisma.client.findMany({
    where: {
      userId: user.id,
      NOT: { id: data.clientId }
    },
    select: { fullName: true, phone: true }
  });
  const duplicatePhone = existingClients.some((item) => normalizePhone(item.phone) === phone);
  const duplicateName = existingClients.some((item) => normalizeName(item.fullName) === fullNameKey);

  if (duplicatePhone) {
    goHomeWithError("Ya existe otro cliente con ese número de WhatsApp.");
  }

  if (duplicateName) {
    goHomeWithError("Ya existe otro cliente con ese nombre.");
  }

  await prisma.client.update({
    where: { id: client.id },
    data: {
      fullName: data.fullName,
      phone,
      email: data.email || null,
      notes: data.notes || null
    }
  });

  revalidatePath("/");
  goHomeWithSuccess("Cliente actualizado.");
}

export async function createAppointment(formData: FormData) {
  const user = await requireUser();
  const result = appointmentSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Completa cliente, título, fecha y duración de la cita.");
  }

  const data = result.data;
  const startsAt = zonedDateTimeToUtc(data.appointmentDate, data.appointmentTime);

  if (Number.isNaN(startsAt.getTime())) {
    goHomeWithError("La fecha y hora de la cita no es válida.");
  }

  if (startsAt <= new Date()) {
    goHomeWithError("Agenda la cita en una fecha futura.");
  }

  const client = await prisma.client
    .findFirst({
      where: { id: data.clientId, userId: user.id }
    })
    .catch(() => null);

  if (!client) {
    goHomeWithError("Selecciona un cliente válido.");
  }

  const conflict = await findAppointmentConflict({
    userId: user.id,
    startsAt,
    durationMin: data.durationMin
  }).catch(() => null);

  if (conflict) {
    goHomeWithError(
      `Ese horario se empalma con la cita de ${conflict.client.fullName} a las ${formatConflictTime(
        conflict.startsAt
      )}.`
    );
  }

  try {
    const clientAppointmentNumber = await getNextClientAppointmentNumber(data.clientId);

    await prisma.appointment.create({
      data: {
        userId: user.id,
        clientId: data.clientId,
        clientAppointmentNumber,
        title: data.title,
        startsAt,
        durationMin: data.durationMin,
        notes: data.notes || null
      }
    });
  } catch {
    goHomeWithError("No se pudo agendar la cita. Intenta de nuevo.");
  }

  revalidatePath("/");
  goHomeWithSuccess("Cita agendada.");
}

export async function createWaitlistEntry(formData: FormData) {
  const user = await requireUser();
  const result = waitlistSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Completa cliente, motivo, fecha y horario de la lista de espera.");
  }

  const data = result.data;
  const startsAt = zonedDateTimeToUtc(data.desiredDate, data.startTime);
  const endsAt = zonedDateTimeToUtc(data.desiredDate, data.endTime);
  const fallbackRequested = Boolean(data.fallbackDate || data.fallbackTime);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
    goHomeWithError("El rango de horario de lista de espera no es válido.");
  }

  if (endsAt <= new Date()) {
    goHomeWithError("La lista de espera debe ser para una fecha u horario futuro.");
  }

  const client = await prisma.client.findFirst({
    where: { id: data.clientId, userId: user.id }
  });

  if (!client) {
    goHomeWithError("Selecciona un cliente válido.");
  }

  let fallbackAppointmentId: string | null = null;
  let clientAppointmentNumber: number | null = null;

  if (fallbackRequested) {
    if (!data.fallbackDate || !data.fallbackTime) {
      goHomeWithError("Completa fecha y hora de respaldo, o deja ambos campos vacíos.");
    }

    const fallbackStartsAt = zonedDateTimeToUtc(data.fallbackDate, data.fallbackTime);

    if (Number.isNaN(fallbackStartsAt.getTime()) || fallbackStartsAt <= new Date()) {
      goHomeWithError("La cita de respaldo debe ser una fecha futura válida.");
    }

    const fallbackConflict = await findAppointmentConflict({
      userId: user.id,
      startsAt: fallbackStartsAt,
      durationMin: data.durationMin
    });

    if (fallbackConflict) {
      goHomeWithError(
        `La cita de respaldo se empalma con la cita de ${fallbackConflict.client.fullName} a las ${formatConflictTime(
          fallbackConflict.startsAt
        )}.`
      );
    }

    clientAppointmentNumber = await getNextClientAppointmentNumber(data.clientId);
    const fallbackAppointment = await prisma.appointment.create({
      data: {
        userId: user.id,
        clientId: data.clientId,
        clientAppointmentNumber,
        title: data.title,
        startsAt: fallbackStartsAt,
        durationMin: data.durationMin,
        notes: data.notes
          ? `Cita de respaldo vinculada a lista de espera. ${data.notes}`
          : "Cita de respaldo vinculada a lista de espera."
      }
    });

    fallbackAppointmentId = fallbackAppointment.id;
  }

  await prisma.waitlistEntry.create({
    data: {
      userId: user.id,
      clientId: data.clientId,
      title: data.title,
      desiredDate: data.desiredDate,
      startTime: data.startTime,
      endTime: data.endTime,
      durationMin: data.durationMin,
      priority: data.priority,
      notes: data.notes || null,
      fallbackAppointmentId,
      clientAppointmentNumber
    }
  });

  revalidatePath("/");
  goHomeWithSuccess(
    fallbackAppointmentId
      ? "Cliente agregado a lista de espera con cita de respaldo."
      : "Cliente agregado a lista de espera."
  );
}

export async function deleteWaitlistEntry(formData: FormData) {
  const user = await requireUser();
  const result = deleteWaitlistSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Selecciona una entrada válida de lista de espera.");
  }

  const deleted = await prisma.waitlistEntry
    .deleteMany({
      where: {
        id: result.data.waitlistEntryId,
        userId: user.id
      }
    })
    .catch(() => ({ count: 0 }));

  if (deleted.count === 0) {
    goHomeWithError("No se encontró la entrada de lista de espera.");
  }

  revalidatePath("/");
  goHomeWithSuccess("Entrada eliminada de lista de espera.");
}

export async function updateAppointmentStatus(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const returnTo = getReturnTo(formData);
  const status = String(formData.get("status"));

  const allowedStatuses = [
    "PENDING",
    "CONFIRMED",
    "CANCELLED",
    "ATTENDED",
    "MISSED",
    "REPROGRAM_PENDING",
    "REPROGRAMMED"
  ];

  if (!id || !allowedStatuses.includes(status)) {
    redirectWithMessage(returnTo, "error", "No se pudo cambiar el estado de la cita.");
  }

  const appointment = await prisma.appointment
    .findFirst({
      where: { id, userId: user.id },
      include: { client: true }
    })
    .catch(() => null);

  if (!appointment) {
    redirectWithMessage(returnTo, "error", "No se encontró la cita seleccionada.");
  }

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status }
  });

  const updatedAppointment = { ...appointment, status };

  await createAppointmentStatusNotification(updatedAppointment, status);

  if (status === "CANCELLED" || status === "REPROGRAM_PENDING") {
    await notifyWaitlistForAvailableSlot(updatedAppointment);
  }

  revalidatePath("/");
  redirectWithMessage(returnTo, "success", "Estado de cita actualizado.");
}

export async function offerWaitlistSlot(formData: FormData) {
  const user = await requireUser();
  const result = offerWaitlistSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("No se pudo ofrecer ese horario.");
  }

  try {
    await offerWaitlistOpportunity({
      entryId: result.data.waitlistEntryId,
      opportunityId: result.data.opportunityId,
      userId: user.id
    });
  } catch (error) {
    goHomeWithError(error instanceof Error ? error.message : "No se pudo ofrecer ese horario.");
  }

  revalidatePath("/");
  goHomeWithSuccess("Oferta enviada por WhatsApp.");
}

export async function sendAppointmentReminder(formData: FormData) {
  const user = await requireUser();
  const appointmentId = String(formData.get("appointmentId"));
  const returnTo = getReturnTo(formData);

  const appointment = await prisma.appointment
    .findFirst({
      where: { id: appointmentId, userId: user.id },
      include: { client: true }
    })
    .catch(() => null);

  if (!appointment) {
    redirectWithMessage(returnTo, "error", "No se encontró la cita seleccionada.");
  }

  try {
    await sendAppointmentReminderByType(appointment, "MANUAL");
  } catch {
    revalidatePath("/");
    redirectWithMessage(returnTo, "error", "No se pudo enviar WhatsApp. Revisa n8n o Evolution API.");
  }

  revalidatePath("/");
  redirectWithMessage(returnTo, "success", "Recordatorio enviado por WhatsApp.");
}

export async function sendClientWhatsappMessage(formData: FormData) {
  const user = await requireUser();
  const returnTo = getReturnTo(formData);
  const result = crmMessageSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    redirectWithMessage(returnTo, "error", "Escribe un mensaje antes de enviarlo.");
  }

  const client = await prisma.client
    .findFirst({
      where: {
        id: result.data.clientId,
        userId: user.id
      }
    })
    .catch(() => null);

  if (!client) {
    redirectWithMessage(returnTo, "error", "No se encontró el cliente seleccionado.");
  }

  try {
    await sendReminderToN8n({
      client,
      appointment: null,
      event: "client.whatsapp.manual.requested",
      message: result.data.message
    });

    await prisma.chatMessage.create({
      data: {
        userId: user.id,
        clientId: client.id,
        direction: "OUTBOUND",
        message: result.data.message,
        intent: "MANUAL_CRM"
      }
    });
  } catch {
    revalidatePath("/");
    redirectWithMessage(returnTo, "error", "No se pudo enviar el mensaje. Revisa n8n o Evolution API.");
  }

  revalidatePath("/");
  redirectWithMessage(returnTo, "success", "Mensaje enviado por WhatsApp.");
}
