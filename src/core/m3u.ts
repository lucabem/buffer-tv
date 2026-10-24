import type { ChannelMap } from "./types.js";

const GROUP_TITLE_RE = /group-title="([^"]*)"/;
const TVG_LOGO_RE = /tvg-logo="([^"]*)"/;

/**
 * Categorías de películas/series (VOD). Este reproductor es para canales en
 * directo: mezclarlas inflaba la lista a decenas de miles de entradas.
 */
export const VOD_GROUP_PREFIXES = ["CIMA", "SRS-", "ARCHIVE DOUBLONS"];

export function isVodGroup(groupUpper: string): boolean {
  return VOD_GROUP_PREFIXES.some((prefix) => groupUpper.startsWith(prefix));
}

export interface ServerParts {
  host: string;
  path: string;
  user: string;
  pass: string;
}

export function parseServerUrl(url: string): ServerParts {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { host: "", path: "", user: "", pass: "" };
  }
  return {
    host: `${parsed.protocol}//${parsed.host}`,
    path: parsed.pathname,
    user: parsed.searchParams.get("user") ?? "",
    pass: parsed.searchParams.get("pass") ?? "",
  };
}

/** URL de la playlist M3U derivada de la URL completa guardada por el usuario. */
export function buildPlaylistUrl(iptvUrl: string): string {
  const info = parseServerUrl(iptvUrl);
  return `${info.host}${info.path}?user=${encodeURIComponent(info.user)}&pass=${encodeURIComponent(info.pass)}&t=m3uplus&o=mpegts`;
}

export interface ParsedPlaylist {
  entries: ChannelMap;
  skipped: number;
}

/**
 * Parsea el texto de una M3U. `include(groupUpper)` decide si una entrada
 * entra en el resultado; así la misma lógica sirve para canales en directo
 * y para VOD. Las entradas duplicadas sobrescriben, como en la versión Python.
 */
export function parseM3uEntries(text: string, include: (groupUpper: string) => boolean): ParsedPlaylist {
  const entries: ChannelMap = {};
  let currentName: string | null = null;
  let currentGroup = "";
  let currentLogo = "";
  let skipped = 0;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      currentGroup = GROUP_TITLE_RE.exec(line)?.[1] ?? "";
      currentLogo = TVG_LOGO_RE.exec(line)?.[1] ?? "";
      const parts = line.split(",");
      currentName = parts.length >= 2 ? parts[parts.length - 1].trim() : null;
    } else if (line.startsWith("http") && currentName) {
      if (include(currentGroup.toUpperCase())) {
        entries[currentName] = { url: line, group: currentGroup, logo: currentLogo };
      } else {
        skipped += 1;
      }
      currentName = null;
    }
  }

  return { entries, skipped };
}
