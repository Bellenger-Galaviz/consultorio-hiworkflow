import { NextResponse } from "next/server";
import { createClientFile } from "@/lib/client-files";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendFileToN8n } from "@/lib/n8n";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const client = await prisma.client.findFirst({
    where: { id, userId: user.id }
  });

  if (!client) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const uploadedFile = formData?.get("file");

  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) {
    return NextResponse.json({ error: "Selecciona un archivo válido." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const caption = String(formData?.get("caption") ?? "");

    await sendFileToN8n({
      buffer,
      caption,
      client,
      fileName: uploadedFile.name || "archivo",
      mimeType: uploadedFile.type || "application/octet-stream"
    });

    const file = await createClientFile({
      buffer,
      caption,
      clientId: client.id,
      mimeType: uploadedFile.type || "application/octet-stream",
      originalName: uploadedFile.name || "archivo",
      source: "MANUAL",
      status: "SENT",
      userId: user.id
    });

    return NextResponse.json({
      file: {
        createdAt: file.createdAt.toISOString(),
        id: file.id,
        mimeType: file.mimeType,
        name: file.originalName,
        savedToRecord: file.status === "SAVED",
        source: file.source,
        status: file.status,
        size: file.size,
        url: `/api/client-files/${file.id}`
      }
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === "FILE_TOO_LARGE"
        ? "El archivo supera el límite de 25 MB."
        : "No se pudo enviar el archivo. Revisa n8n o Evolution API.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
