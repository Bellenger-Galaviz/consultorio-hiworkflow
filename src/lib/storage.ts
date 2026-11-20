import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Almacenamiento de archivos clínicos.
 *
 * En local se usa el disco (storage/client-files), igual que siempre.
 * En Vercel el sistema de archivos es efímero y de solo lectura, así que cuando
 * las variables de Supabase están presentes se usa Supabase Storage.
 *
 * La clave del objeto es el mismo `storagePath` que ya guarda Prisma
 * (userId/clientId/storedName), así que no hay cambio de esquema ni migración
 * de datos existentes más allá de copiar los archivos al bucket.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "client-files";

export function isRemoteStorageEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export function getLocalStorageRoot() {
  return process.env.CLIENT_FILE_STORAGE_DIR || path.join(process.cwd(), "storage", "client-files");
}

export function getLocalAbsolutePath(storagePath: string) {
  return path.join(getLocalStorageRoot(), storagePath);
}

function buildObjectUrl(storagePath: string) {
  const encodedKey = storagePath.split("/").map(encodeURIComponent).join("/");

  return `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${encodedKey}`;
}

function buildHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

export async function putObject(storagePath: string, buffer: Buffer, mimeType: string) {
  if (!isRemoteStorageEnabled()) {
    const absolutePath = getLocalAbsolutePath(storagePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);

    return;
  }

  const response = await fetch(buildObjectUrl(storagePath), {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": mimeType || "application/octet-stream",
      "Cache-Control": "3600",
      "x-upsert": "true"
    }),
    body: new Uint8Array(buffer)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");

    throw new Error(`STORAGE_UPLOAD_FAILED:${response.status}:${detail.slice(0, 200)}`);
  }
}

export async function getObject(storagePath: string) {
  if (!isRemoteStorageEnabled()) {
    return readFile(getLocalAbsolutePath(storagePath));
  }

  const response = await fetch(buildObjectUrl(storagePath), {
    method: "GET",
    headers: buildHeaders()
  });

  if (!response.ok) {
    throw new Error(`STORAGE_DOWNLOAD_FAILED:${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
