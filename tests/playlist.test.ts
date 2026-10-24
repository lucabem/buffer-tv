import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchLivePlaylist, fetchVodEntries, checkServer } from "../src/core/playlist.js";

const M3U = `#EXTM3U
#EXTINF:-1 group-title="[ES] SPORT",DAZN LALIGA
http://cdn/111.ts
#EXTINF:-1 group-title="CIMA ES",Película Uno
http://cdn/movie/1.ts
`;

let server: Server;
let baseUrl = "";
let hits = 0;
let cacheDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits += 1;
    const url = new URL(req.url ?? "/", "http://x");
    if (url.searchParams.get("pass") === "bad") {
      res.writeHead(401).end();
      return;
    }
    if (url.pathname === "/broken") {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/x-mpegURL" }).end(M3U);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sin puerto");
  baseUrl = `http://127.0.0.1:${address.port}`;
  cacheDir = mkdtempSync(join(tmpdir(), "iptv-test-cache-"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("fetchLivePlaylist", () => {
  it("devuelve solo canales en directo y guarda caché", async () => {
    const before = hits;
    const channels = await fetchLivePlaylist(`${baseUrl}/gets.php?user=u&pass=p`, { cacheDir });
    expect(Object.keys(channels)).toEqual(["DAZN LALIGA"]);
    expect(hits).toBe(before + 1);

    // Segunda llamada: sale de la caché, sin nueva petición HTTP.
    const again = await fetchLivePlaylist(`${baseUrl}/gets.php?user=u&pass=p`, { cacheDir });
    expect(again).toEqual(channels);
    expect(hits).toBe(before + 1);
  });

  it("forceRefresh ignora la caché", async () => {
    const before = hits;
    await fetchLivePlaylist(`${baseUrl}/gets.php?user=u&pass=p`, { cacheDir, forceRefresh: true });
    expect(hits).toBe(before + 1);
  });
});

describe("fetchVodEntries", () => {
  it("devuelve solo VOD con su propia clave de caché", async () => {
    const vod = await fetchVodEntries(`${baseUrl}/gets.php?user=u2&pass=p`, { cacheDir });
    expect(Object.keys(vod)).toEqual(["Película Uno"]);
  });
});

describe("checkServer", () => {
  it("acepta un servidor que responde", async () => {
    expect(await checkServer(`${baseUrl}/gets.php?user=u&pass=ok`)).toEqual({ ok: true });
  });

  it("explica credenciales rechazadas", async () => {
    const result = await checkServer(`${baseUrl}/gets.php?user=u&pass=bad`);
    expect(result).toEqual({
      ok: false,
      error: "Credenciales inválidas (usuario/contraseña rechazados por el servidor)",
    });
  });

  it("explica un error HTTP", async () => {
    const result = await checkServer(`${baseUrl}/broken?user=u&pass=p`);
    expect(result).toEqual({ ok: false, error: "El servidor respondió con error HTTP 500" });
  });

  it("rechaza URLs sin host", async () => {
    expect(await checkServer("texto suelto")).toEqual({ ok: false, error: "URL no válida" });
  });

  it("informa de conexión fallida", async () => {
    const result = await checkServer("http://127.0.0.1:1/gets.php?user=u&pass=p");
    expect(result.ok).toBe(false);
  });
});
