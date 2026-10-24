import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChannelMap } from "./types.js";

/** Caché en disco de playlists ya parseadas (misma ubicación que la versión Python). */
export const PLAYLIST_CACHE_DIR = join(homedir(), ".cache", "iptv-buffer", "playlists");

export function cachePathFor(url: string, dir: string = PLAYLIST_CACHE_DIR): string {
  return join(dir, `${createHash("sha256").update(url, "utf-8").digest("hex")}.json`);
}

/** Devuelve los canales cacheados si existen y no han caducado; si no, null. Nunca lanza. */
export function loadCachedPlaylist(url: string, maxAgeSeconds: number, dir?: string): ChannelMap | null {
  const path = cachePathFor(url, dir);
  if (!existsSync(path)) return null;

  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { timestamp?: number; channels?: ChannelMap };
    if (data.timestamp == null || data.channels == null) return null;
    const ageSeconds = Date.now() / 1000 - data.timestamp;
    if (ageSeconds > maxAgeSeconds) return null;
    return data.channels;
  } catch {
    return null;
  }
}

/** Guarda la playlist de forma atómica (tmp + rename). Un fallo no interrumpe la app. */
export function saveCachedPlaylist(url: string, channels: ChannelMap, dir?: string): void {
  const path = cachePathFor(url, dir);
  try {
    mkdirSync(dir ?? PLAYLIST_CACHE_DIR, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ timestamp: Date.now() / 1000, url, channels }), "utf-8");
    renameSync(tmp, path);
  } catch {
    // La caché es una optimización.
  }
}
