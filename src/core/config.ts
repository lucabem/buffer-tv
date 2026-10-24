import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig, Defaults } from "./types.js";

export const CONFIG_DIR = join(homedir(), ".config", "iptv-buffer");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export const DEFAULTS: Defaults = { delay_seconds: 300, buffer_mb: 500 };

/**
 * Carga la configuración. Nunca lanza: un fichero corrupto o ausente
 * devuelve la estructura por defecto. Los campos añadidos después
 * (favoritos, último canal) se rellenan con {} para ser compatibles con
 * configs antiguos.
 */
export function loadConfig(path: string = CONFIG_PATH): AppConfig {
  const config: AppConfig = {
    servers: [],
    defaults: { ...DEFAULTS },
    favorites: {},
    last_played: {},
    last_server: null,
  };

  if (!existsSync(path)) return config;

  try {
    const loaded = JSON.parse(readFileSync(path, "utf-8")) as Partial<AppConfig>;
    config.servers = loaded.servers ?? [];
    config.defaults = { ...DEFAULTS, ...(loaded.defaults ?? {}) };
    config.favorites = loaded.favorites ?? {};
    config.last_played = loaded.last_played ?? {};
    config.last_server = loaded.last_server ?? null;
  } catch {
    // Config ilegible: se ignora y se usa la estructura por defecto.
  }

  return config;
}

export function saveConfig(config: AppConfig, path: string = CONFIG_PATH): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}
