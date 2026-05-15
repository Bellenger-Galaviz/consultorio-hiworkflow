import type { Appointment, Client } from "@prisma/client";

type ReminderPayload = {
  client: Client;
  appointment?: Appointment | null;
  event?: string;
  message: string;
};

export async function sendReminderToN8n(payload: ReminderPayload) {
  const webhookUrl = process.env.N8N_REMINDER_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("N8N_REMINDER_WEBHOOK_URL is not configured.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET ?? ""
    },
    body: JSON.stringify({
      event: payload.event ?? "appointment.reminder.requested",
      sentFrom: process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
      client: {
        id: payload.client.id,
        fullName: payload.client.fullName,
        phone: payload.client.phone,
        email: payload.client.email
      },
      appointment: payload.appointment
        ? {
            id: payload.appointment.id,
            title: payload.appointment.title,
            startsAt: payload.appointment.startsAt,
            durationMin: payload.appointment.durationMin,
            status: payload.appointment.status
          }
        : null,
      whatsapp: {
        to: payload.client.phone,
        message: payload.message,
        text: payload.message
      }
    })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `n8n responded with ${response.status}`);
  }

  return text;
}
