"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { findAppointmentConflict } from "@/lib/appointments";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendAppointmentReminderByType } from "@/lib/reminders";

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

function goHomeWithError(message: string): never {
  redirect(`/?error=${encodeURIComponent(message)}`);
}

function goHomeWithSuccess(message: string): never {
  redirect(`/?success=${encodeURIComponent(message)}`);
}

function parseDateOrNull(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatConflictTime(date: Date) {
  return date.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export async function createClient(formData: FormData) {
  const user = await requireUser();
  const result = clientSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Revisa el nombre, WhatsApp y correo del cliente.");
  }

  const data = result.data;

  try {
    await prisma.client.create({
      data: {
        userId: user.id,
        fullName: data.fullName,
        phone: data.phone,
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

export async function createAppointment(formData: FormData) {
  const user = await requireUser();
  const result = appointmentSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    goHomeWithError("Completa cliente, título, fecha y duración de la cita.");
  }

  const data = result.data;
  const startsAt = parseDateOrNull(`${data.appointmentDate}T${data.appointmentTime}:00`);

  if (!startsAt) {
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
    await prisma.appointment.create({
      data: {
        userId: user.id,
        clientId: data.clientId,
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

export async function updateAppointmentStatus(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
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
    goHomeWithError("No se pudo cambiar el estado de la cita.");
  }

  const updated = await prisma.appointment
    .updateMany({
      where: { id, userId: user.id },
      data: { status }
    })
    .catch(() => ({ count: 0 }));

  if (updated.count === 0) {
    goHomeWithError("No se encontró la cita seleccionada.");
  }

  revalidatePath("/");
  goHomeWithSuccess("Estado de cita actualizado.");
}

export async function sendAppointmentReminder(formData: FormData) {
  const user = await requireUser();
  const appointmentId = String(formData.get("appointmentId"));

  const appointment = await prisma.appointment
    .findFirst({
      where: { id: appointmentId, userId: user.id },
      include: { client: true }
    })
    .catch(() => null);

  if (!appointment) {
    goHomeWithError("No se encontró la cita seleccionada.");
  }

  try {
    await sendAppointmentReminderByType(appointment, "MANUAL");
  } catch {
    revalidatePath("/");
    goHomeWithError("No se pudo enviar WhatsApp. Revisa n8n o Evolution API.");
  }

  revalidatePath("/");
  goHomeWithSuccess("Recordatorio enviado por WhatsApp.");
}
