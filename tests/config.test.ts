import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS, loadConfig, saveConfig } from "../src/core/config.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "iptv-test-config-"));
  path = join(dir, "iptv-buffer", "config.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Escribe un config tal cual, como lo dejaría una versión anterior de la app. */
function writeRaw(content: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

describe("loadConfig", () => {
  it("sin archivo devuelve la estructura por defecto", () => {
    expect(loadConfig(path)).toEqual({
      servers: [],
      defaults: { ...DEFAULTS },
      favorites: {},
      last_played: {},
      last_server: null,
    });
  });

  it("un config antiguo sin favoritos ni último canal no rompe la carga", () => {
    writeRaw({
      servers: [{ name: "IPTV", url: "http://h/gets.php?user=u&pass=p" }],
      defaults: { delay_seconds: 300, buffer_mb: 500 },
    });
    const config = loadConfig(path);
    expect(config.favorites).toEqual({});
    expect(config.last_played).toEqual({});
    expect(config.servers).toHaveLength(1);
  });

  it("defaults vacíos se completan con DEFAULTS", () => {
    writeRaw({ servers: [], defaults: {} });
    expect(loadConfig(path).defaults).toEqual({ ...DEFAULTS });
  });

  it("un archivo corrupto no lanza y devuelve valores por defecto", () => {
    writeRaw("{no es json");
    expect(loadConfig(path).servers).toEqual([]);
  });
});

describe("saveConfig", () => {
  it("guarda y recupera exactamente los mismos datos", () => {
    const original = {
      servers: [{ name: "Mi servidor", url: "http://host.example/s/gets.php?user=u&pass=p", delay_seconds: 120, buffer_mb: 1000, enabled: true }],
      defaults: { delay_seconds: 120, buffer_mb: 1000 },
      favorites: { "Mi servidor": ["Canal 1", "Canal 2"] },
      last_played: { "Mi servidor": "Canal 1" },
      last_server: "Mi servidor",
    };
    saveConfig(original, path);
    expect(loadConfig(path)).toEqual(original);
    expect(readFileSync(path, "utf-8")).toContain('\n  "servers"');
  });
});
