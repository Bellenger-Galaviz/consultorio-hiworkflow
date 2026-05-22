import { NextResponse } from "next/server";
import { readClientFileBuffer } from "@/lib/client-files";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const file = await prisma.clientFile.findFirst({
    where: {
      id,
      userId: user.id
    }
  });

  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  }

  const buffer = await readClientFileBuffer(file).catch(() => null);

  if (!buffer) {
    return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 404 });
  }

  return new Response(buffer, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
      "Content-Length": String(file.size),
      "Content-Type": file.mimeType
    }
  });
}
