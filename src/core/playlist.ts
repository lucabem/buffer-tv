import { loadCachedPlaylist, saveCachedPlaylist } from "./cache.js";
import { getText, fetchWithHeaderTimeout } from "./http.js";
import { buildPlaylistUrl, isVodGroup, parseM3uEntries, parseServerUrl } from "./m3u.js";
import type { ChannelMap } from "./types.js";

export const PLAYLIST_MAX_AGE_SECONDS = 30 * 60;
const PLAYLIST_TIMEOUT_MS = 10_000;
const CHECK_TIMEOUT_MS = 6_000;

export interface LoadOptions {
  forceRefresh?: boolean;
  log?: (message: string) => void;
  /** Inyectable para tests: por defecto se usa la caché real del usuario. */
  cacheDir?: string;
}

/** Canales en directo (sin VOD) de un servidor. Usa caché de 30 minutos. */
export async function fetchLivePlaylist(iptvUrl: string, opts: LoadOptions = {}): Promise<ChannelMap> {
  const log = opts.log ?? (() => {});
  const m3uUrl = buildPlaylistUrl(iptvUrl);

  if (!opts.forceRefresh) {
    const cached = loadCachedPlaylist(m3uUrl, PLAYLIST_MAX_AGE_SECONDS, opts.cacheDir);
    if (cached) {
      log(`Lista de canales cargada desde caché (${Object.keys(cached).length} canales)`);
      return cached;
    }
  }

  log("Obteniendo lista de canales...");
  const text = await getText(m3uUrl, PLAYLIST_TIMEOUT_MS);
  const { entries, skipped } = parseM3uEntries(text, (group) => !isVodGroup(group));

  log(`Se encontraron ${Object.keys(entries).length} canales en directo (se omitieron ${skipped} de películas/series)`);
  saveCachedPlaylist(m3uUrl, entries, opts.cacheDir);
  return entries;
}

/** Solo películas/series (VOD). Caché con clave propia (sufijo "#vod"). */
export async function fetchVodEntries(iptvUrl: string, opts: LoadOptions = {}): Promise<ChannelMap> {
  const log = opts.log ?? (() => {});
  const m3uUrl = buildPlaylistUrl(iptvUrl);
  const cacheKey = `${m3uUrl}#vod`;

  if (!opts.forceRefresh) {
    const cached = loadCachedPlaylist(cacheKey, PLAYLIST_MAX_AGE_SECONDS, opts.cacheDir);
    if (cached) {
      log(`Catálogo de películas/series cargado desde caché (${Object.keys(cached).length} títulos)`);
      return cached;
    }
  }

  log("Obteniendo catálogo de películas/series (puede tardar, son decenas de miles de entradas)...");
  const text = await getText(m3uUrl, PLAYLIST_TIMEOUT_MS);
  const { entries } = parseM3uEntries(text, isVodGroup);

  log(`Se encontraron ${Object.keys(entries).length} títulos de películas/series`);
  saveCachedPlaylist(cacheKey, entries, opts.cacheDir);
  return entries;
}

/**
 * Comprobación ligera de que el servidor responde (formulario de alta).
 * Lee solo el primer trozo de la respuesta. Devuelve un mensaje legible si falla.
 */
export async function checkServer(iptvUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const info = parseServerUrl(iptvUrl);
  if (!info.host || info.host === "://") return { ok: false, error: "URL no válida" };

  const m3uUrl = buildPlaylistUrl(iptvUrl);
  try {
    const response = await fetchWithHeaderTimeout(m3uUrl, CHECK_TIMEOUT_MS);
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return { ok: false, error: "Credenciales inválidas (usuario/contraseña rechazados por el servidor)" };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, error: `El servidor respondió con error HTTP ${response.status}` };
    }
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeNetworkError(error) };
  }
}

function describeNetworkError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return "El servidor no respondió a tiempo (timeout)";
  }
  if (error instanceof TypeError) {
    return "No se pudo conectar con el servidor (conexión rehusada o host no alcanzable)";
  }
  return `Error comprobando el servidor: ${error instanceof Error ? error.message : String(error)}`;
}
