import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

/** Caché de logos de canal (misma ubicación que la versión Python). */
export const LOGO_CACHE_DIR = join(homedir(), ".cache", "iptv-buffer", "logos");

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
const DOWNLOAD_TIMEOUT_MS = 5_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_EXTENSION = ".png";
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function hashOf(url: string): string {
  return createHash("sha256").update(url, "utf-8").digest("hex");
}

function extensionFor(url: string): string {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext) ? ext : DEFAULT_EXTENSION;
  } catch {
    return DEFAULT_EXTENSION;
  }
}

function findCached(url: string, dir: string): string | null {
  if (!existsSync(dir)) return null;
  const prefix = `${hashOf(url)}.`;
  const match = readdirSync(dir).find((file) => file.startsWith(prefix) && !file.endsWith(".tmp"));
  return match ? join(dir, match) : null;
}

/** Descarga (si hace falta) el logo y devuelve su ruta local, o null. Nunca lanza. */
export async function getCachedLogoPath(url: string, dir = LOGO_CACHE_DIR): Promise<string | null> {
  if (!url) return null;

  try {
    const cached = findCached(url, dir);
    if (cached && Date.now() - statSync(cached).mtimeMs <= DEFAULT_TTL_SECONDS * 1000) {
      return cached;
    }
  } catch {
    // Si la caché falla, se intenta descargar de nuevo.
  }

  return downloadLogo(url, dir);
}

async function downloadLogo(url: string, dir: string): Promise<string | null> {
  const dest = join(dir, `${hashOf(url)}${extensionFor(url)}`);
  const tmp = `${dest}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let bytes: Buffer;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) return null;
      bytes = Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
    if (bytes.length > MAX_DOWNLOAD_BYTES) return null;
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
    return dest;
  } catch {
    rmSync(tmp, { force: true });
    return null;
  }
}

/**
 * Devuelve el logo como data URL para usarlo directamente en <img>, o null.
 * Es cosmético: cualquier fallo degrada a "sin logo", nunca rompe la lista.
 */
export async function getLogoDataUrl(url: string, dir = LOGO_CACHE_DIR): Promise<string | null> {
  const path = await getCachedLogoPath(url, dir);
  if (!path) return null;
  try {
    const mime = MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? "image/png";
    return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return null;
  }
}
