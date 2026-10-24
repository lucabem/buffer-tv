/** Canal en directo o entrada VOD tal como se guarda en la playlist. */
export interface ChannelEntry {
  url: string;
  group: string;
  /** URL del tvg-logo ("" si la entrada no trae logo). */
  logo?: string;
}

/** Mapa nombre -> entrada. Se usa un objeto plano porque se serializa tal cual a caché y IPC. */
export type ChannelMap = Record<string, ChannelEntry>;

/** Variante de calidad de un mismo canal base (p. ej. "DAZN LALIGA HD"). */
export interface ChannelVariant {
  label: string;
  url: string;
  group: string;
  logo: string;
}

export interface ServerConfig {
  name: string;
  url: string;
  delay_seconds: number;
  buffer_mb: number;
  enabled: boolean;
}

export interface Defaults {
  delay_seconds: number;
  buffer_mb: number;
}

/** Esquema de ~/.config/iptv-buffer/config.json (compatible con la versión Python). */
export interface AppConfig {
  servers: ServerConfig[];
  defaults: Defaults;
  favorites: Record<string, string[]>;
  last_played: Record<string, string>;
  /** Nombre del último servidor abierto, para restaurarlo al arrancar. */
  last_server: string | null;
}

export interface StreamQuality {
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
}

export interface PlayerStatus {
  buffer_mb: number;
  max_mb: number;
  rate_mb_s: number;
  healthy: boolean;
  reconnects: number;
}

export interface ProgrammeEntry {
  start: number;
  stop: number | null;
  title: string;
  desc: string;
}
