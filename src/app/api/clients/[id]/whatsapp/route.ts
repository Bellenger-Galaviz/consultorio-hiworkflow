import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendReminderToN8n } from "@/lib/n8n";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(1000)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = messageSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: "Escribe un mensaje antes de enviarlo." }, { status: 400 });
  }

  const client = await prisma.client.findFirst({
    where: {
      id,
      userId: user.id
    }
  });

  if (!client) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }

  try {
    await sendReminderToN8n({
      client,
      appointment: null,
      event: "client.whatsapp.manual.requested",
      message: result.data.message
    });

    const message = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        clientId: client.id,
        direction: "OUTBOUND",
        message: result.data.message,
        intent: "MANUAL_CRM"
      }
    });

    return NextResponse.json({
      message: {
        appointmentTitle: null,
        createdAt: message.createdAt.toISOString(),
        direction: message.direction,
        id: message.id,
        message: message.message
      }
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo enviar el mensaje. Revisa n8n o Evolution API." },
      { status: 502 }
    );
  }
}
