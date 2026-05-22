import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClientFile } from "@prisma/client";
import { prisma } from "@/lib/db";

const MAX_CLIENT_FILE_SIZE = 25 * 1024 * 1024;
const SAFE_EXTENSIONS: Record<string, string> = {
  "application/msword": ".doc",
  "application/pdf": ".pdf",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/plain": ".txt"
};

export function getClientFileStorageRoot() {
  return process.env.CLIENT_FILE_STORAGE_DIR || path.join(process.cwd(), "storage", "client-files");
}

export function getClientFileAbsolutePath(file: Pick<ClientFile, "storagePath">) {
  return path.join(getClientFileStorageRoot(), file.storagePath);
}

function sanitizeFilename(filename: string) {
  const clean = filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return clean || "archivo";
}

function getExtension(originalName: string, mimeType: string) {
  const fromName = path.extname(originalName).toLowerCase();

  if (fromName && fromName.length <= 10) {
    return fromName;
  }

  return SAFE_EXTENSIONS[mimeType] ?? "";
}

export function decodeBase64File(data: string) {
  const clean = data.includes(",") ? data.split(",").at(-1) ?? "" : data;

  return Buffer.from(clean, "base64");
}

export async function createClientFile({
  buffer,
  caption,
  clientId,
  mimeType,
  originalName,
  source,
  status,
  userId
}: {
  buffer: Buffer;
  caption?: string | null;
  clientId: string;
  mimeType: string;
  originalName: string;
  source: "MANUAL" | "WHATSAPP";
  status: "RECEIVED" | "SAVED" | "SENT";
  userId: string;
}) {
  if (buffer.length === 0) {
    throw new Error("EMPTY_FILE");
  }

  if (buffer.length > MAX_CLIENT_FILE_SIZE) {
    throw new Error("FILE_TOO_LARGE");
  }

  const safeName = sanitizeFilename(originalName);
  const extension = getExtension(safeName, mimeType);
  const baseName = extension ? safeName.slice(0, -extension.length) || "archivo" : safeName;
  const storedName = `${randomUUID()}-${baseName}${extension}`;
  const storagePath = path.posix.join(userId, clientId, storedName);
  const absolutePath = path.join(getClientFileStorageRoot(), storagePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return prisma.clientFile.create({
    data: {
      caption: caption || null,
      clientId,
      mimeType: mimeType || "application/octet-stream",
      originalName: safeName,
      savedAt: status === "SAVED" ? new Date() : null,
      size: buffer.length,
      source,
      status,
      storagePath,
      storedName,
      userId
    }
  });
}

export async function readClientFileBuffer(file: Pick<ClientFile, "storagePath">) {
  return readFile(getClientFileAbsolutePath(file));
}
