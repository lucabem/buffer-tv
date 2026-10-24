import { gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sax from "sax";
import { computeBaseName } from "./grouping.js";
import { fetchWithHeaderTimeout } from "./http.js";
import type { ProgrammeEntry } from "./types.js";

export const EPG_URL = "https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv.xml.gz";
export const EPG_CACHE_DIR = join(homedir(), ".cache", "iptv-buffer", "epg");
export const EPG_INDEX_PATH = join(EPG_CACHE_DIR, "index.json");

/** La guía se regenera ~4 veces al día: un TTL de 5 h evita descargas innecesarias. */
export const EPG_TTL_SECONDS = 5 * 3600;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface EpgChannel {
  names: string[];
  programmes: ProgrammeEntry[];
}

/** Índice compacto: canal -> programas, más una tabla nombre normalizado -> id. */
export interface EpgIndex {
  built_at: number;
  channels: Record<string, EpgChannel>;
  name_to_id: Record<string, string>;
}

const COLOR_TAG_RE = /\[\/?COLOR[^\]]*\]/gi;
const WHITESPACE_RE = /\s+/g;
const XMLTV_DATE_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])(\d{2})(\d{2})$/;

export function cleanBbcode(text: string): string {
  return text.replace(COLOR_TAG_RE, "").replace(WHITESPACE_RE, " ").trim();
}

/** Minúsculas, sin tildes, espacios colapsados. */
export function normalizeName(name: string): string {
  if (!name) return "";
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .toLowerCase();
}

/** "YYYYMMDDHHMMSS +ZZZZ" -> epoch en segundos, o null si no encaja. */
export function parseXmltvDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = XMLTV_DATE_RE.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  const offsetMinutes = (Number(oh) * 60 + Number(om)) * (sign === "+" ? 1 : -1);
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return utcMs / 1000 - offsetMinutes * 60;
}

/**
 * Parsea el XMLTV en streaming (sax) para no montar en memoria el árbol
 * completo (~93 MB descomprimido). Solo guarda lo que la UI necesita.
 */
export function parseXmltv(xml: string): EpgIndex {
  const channels: Record<string, EpgChannel> = {};
  const nameToId: Record<string, string> = {};

  const parser = sax.parser(true);
  let inChannel: { id: string; names: string[] } | null = null;
  let inProgramme: { channel: string; start: number; stop: number | null; title: string; desc: string } | null = null;
  let field: "display-name" | "title" | "desc" | null = null;
  let text = "";

  const ensureChannel = (id: string): EpgChannel => {
    channels[id] ??= { names: [], programmes: [] };
    return channels[id];
  };

  parser.onopentag = (node) => {
    switch (node.name) {
      case "channel": {
        const id = node.attributes.id;
        inChannel = typeof id === "string" && id ? { id, names: [] } : null;
        break;
      }
      case "programme": {
        const channel = node.attributes.channel;
        const start = parseXmltvDate(typeof node.attributes.start === "string" ? node.attributes.start : null);
        inProgramme =
          typeof channel === "string" && channel && start !== null
            ? {
                channel,
                start,
                stop: parseXmltvDate(typeof node.attributes.stop === "string" ? node.attributes.stop : null),
                title: "",
                desc: "",
              }
            : null;
        break;
      }
      case "display-name":
        if (inChannel) field = "display-name";
        break;
      case "title":
        if (inProgramme) field = "title";
        break;
      case "desc":
        if (inProgramme) field = "desc";
        break;
    }
    text = "";
  };

  parser.ontext = (chunk) => {
    if (field) text += chunk;
  };
  parser.oncdata = (chunk) => {
    if (field) text += chunk;
  };

  parser.onclosetag = (name) => {
    if (field && name === field) {
      if (field === "display-name" && inChannel) {
        const normalized = normalizeName(text);
        if (normalized) {
          inChannel.names.push(normalized);
          nameToId[normalized] ??= inChannel.id;
        }
      } else if (field === "title" && inProgramme) {
        inProgramme.title = cleanBbcode(text);
      } else if (field === "desc" && inProgramme) {
        inProgramme.desc = cleanBbcode(text);
      }
      field = null;
      text = "";
    }

    if (name === "channel" && inChannel) {
      ensureChannel(inChannel.id).names = inChannel.names;
      inChannel = null;
    } else if (name === "programme" && inProgramme) {
      ensureChannel(inProgramme.channel).programmes.push({
        start: inProgramme.start,
        stop: inProgramme.stop,
        title: inProgramme.title,
        desc: inProgramme.desc,
      });
      inProgramme = null;
    }
  };

  parser.write(xml).close();

  for (const entry of Object.values(channels)) {
    entry.programmes.sort((a, b) => a.start - b.start);
  }

  return { built_at: Date.now() / 1000, channels, name_to_id: nameToId };
}

function emptyIndex(): EpgIndex {
  return { built_at: Date.now() / 1000, channels: {}, name_to_id: {} };
}

function loadDiskIndex(path: string, maxAgeSeconds: number): EpgIndex | null {
  if (!existsSync(path)) return null;
  try {
    const index = JSON.parse(readFileSync(path, "utf-8")) as Partial<EpgIndex>;
    if (typeof index.built_at !== "number") return null;
    if (Date.now() / 1000 - index.built_at > maxAgeSeconds) return null;
    if (!index.channels || !index.name_to_id) return null;
    return index as EpgIndex;
  } catch {
    return null;
  }
}

function saveDiskIndex(index: EpgIndex, path: string): void {
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(index), "utf-8");
    renameSync(tmp, path);
  } catch {
    // Caché opcional.
  }
}

async function downloadAndBuild(url: string): Promise<EpgIndex | null> {
  try {
    const response = await fetchWithHeaderTimeout(url, DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) return null;
    const xml = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf-8");
    return parseXmltv(xml);
  } catch {
    return null;
  }
}

/**
 * Índice EPG desde caché de disco o descargando la guía. Nunca lanza: si
 * todo falla devuelve un índice vacío con la misma forma.
 */
export async function loadEpgIndex(
  opts: { maxAgeSeconds?: number; forceRefresh?: boolean; indexPath?: string; url?: string } = {},
): Promise<EpgIndex> {
  const path = opts.indexPath ?? EPG_INDEX_PATH;
  if (!opts.forceRefresh) {
    const cached = loadDiskIndex(path, opts.maxAgeSeconds ?? EPG_TTL_SECONDS);
    if (cached) return cached;
  }

  const index = await downloadAndBuild(opts.url ?? EPG_URL);
  if (!index) return emptyIndex();
  saveDiskIndex(index, path);
  return index;
}

/** channel_id de la guía para un nombre de canal, con fallback a su nombre base. */
export function findChannelId(index: EpgIndex, channelName: string | null | undefined): string | null {
  if (!channelName) return null;
  const direct = index.name_to_id[normalizeName(channelName)];
  if (direct) return direct;

  const base = computeBaseName(channelName);
  if (base && base !== channelName) {
    return index.name_to_id[normalizeName(base)] ?? null;
  }
  return null;
}

/** Programas de HOY (fecha local) para un canal, ordenados por inicio. */
export function getTodayProgrammes(index: EpgIndex, channelId: string | null, now = new Date()): ProgrammeEntry[] {
  if (!channelId) return [];
  const channel = index.channels[channelId];
  if (!channel) return [];

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const dayEnd = dayStart + 24 * 3600;
  return channel.programmes
    .filter((programme) => programme.start >= dayStart && programme.start < dayEnd)
    .sort((a, b) => a.start - b.start);
}
