import { NextResponse } from "next/server";
import { z } from "zod";
import { createClientFile, decodeBase64File } from "@/lib/client-files";
import { prisma } from "@/lib/db";
import { createClientFileNotification } from "@/lib/notifications";

const filePayloadSchema = z.object({
  caption: z.string().optional().nullable(),
  data: z.string().min(1),
  fileName: z.string().min(1).default("archivo"),
  mimeType: z.string().min(1).default("application/octet-stream"),
  phone: z.string().min(8)
});

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");

  if (process.env.N8N_WEBHOOK_SECRET && secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = filePayloadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  const client = await prisma.client.findFirst({
    where: {
      phone: {
        contains: phone.slice(-10)
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  if (!client) {
    return NextResponse.json({ ok: true, action: "NO_REGISTERED_CLIENT_FOR_FILE" });
  }

  try {
    const file = await createClientFile({
      buffer: decodeBase64File(parsed.data.data),
      caption: parsed.data.caption,
      clientId: client.id,
      mimeType: parsed.data.mimeType,
      originalName: parsed.data.fileName,
      source: "WHATSAPP",
      status: "RECEIVED",
      userId: client.userId
    });

    await prisma.chatMessage.create({
      data: {
        clientId: client.id,
        direction: "INBOUND",
        intent: "WHATSAPP_FILE_RECEIVED",
        message: parsed.data.caption
          ? `Archivo recibido: ${file.originalName}\n${parsed.data.caption}`
          : `Archivo recibido: ${file.originalName}`,
        userId: client.userId
      }
    });
    await createClientFileNotification(client, file.originalName);

    return NextResponse.json({
      ok: true,
      action: "CLIENT_FILE_RECEIVED",
      clientId: client.id,
      fileId: file.id
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === "FILE_TOO_LARGE"
        ? "File too large"
        : "Could not save file";

    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
