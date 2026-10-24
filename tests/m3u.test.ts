import { describe, expect, it } from "vitest";
import { buildPlaylistUrl, parseM3uEntries, parseServerUrl } from "../src/core/m3u.js";
import { isVodGroup } from "../src/core/m3u.js";

const SAMPLE_URL = "http://host.example/s/gets.php?user=USER&pass=PASS&t=m3uplus&o=mpegts";

const SAMPLE_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="" tvg-logo="http://logo/laliga.png" group-title="[ES] SPORT",DAZN LALIGA
http://host.example/live/USER/PASS/111.ts
#EXTINF:-1 tvg-id="" group-title="[ES] SPORT",beIN Sports 1
http://host.example/live/USER/PASS/112.ts
#EXTINF:-1 tvg-id="" group-title="[ES] GENERALES",TVE 1
http://host.example/live/USER/PASS/113.ts
#EXTINF:-1 tvg-id="" group-title="CIMA ES",La Liga de la Justicia (2017)
http://host.example/movie/USER/PASS/114.ts
#EXTINF:-1 tvg-id="" group-title="SRS-ESP",Alguna Serie S01E01
http://host.example/series/USER/PASS/115.ts
#EXTINF:-1 tvg-id="" group-title="Archive doublons FR",Vieux Film FR
http://host.example/movie/USER/PASS/116.ts
`;

describe("parseServerUrl", () => {
  it("extrae host, path, user y pass", () => {
    expect(parseServerUrl(SAMPLE_URL)).toEqual({
      host: "http://host.example",
      path: "/s/gets.php",
      user: "USER",
      pass: "PASS",
    });
  });

  it("devuelve partes vacías para una URL inválida", () => {
    expect(parseServerUrl("no es una url").host).toBe("");
  });
});

describe("buildPlaylistUrl", () => {
  it("construye la URL m3uplus del servidor", () => {
    expect(buildPlaylistUrl(SAMPLE_URL)).toBe(
      "http://host.example/s/gets.php?user=USER&pass=PASS&t=m3uplus&o=mpegts",
    );
  });

  it("codifica credenciales con caracteres especiales", () => {
    const url = buildPlaylistUrl("http://h.example/gets.php?user=us%26er&pass=p%2Bss");
    expect(url).toContain("user=us%26er");
    expect(url).toContain("pass=p%2Bss");
  });
});

describe("parseM3uEntries", () => {
  it("excluye VOD y conserva url, grupo y logo de los canales", () => {
    const { entries, skipped } = parseM3uEntries(SAMPLE_M3U, (group) => !isVodGroup(group));

    expect(Object.keys(entries).sort()).toEqual(["DAZN LALIGA", "TVE 1", "beIN Sports 1"]);
    expect(entries["DAZN LALIGA"]).toEqual({
      url: "http://host.example/live/USER/PASS/111.ts",
      group: "[ES] SPORT",
      logo: "http://logo/laliga.png",
    });
    expect(entries["TVE 1"].logo).toBe("");
    expect(skipped).toBe(3);
  });

  it("incluye solo VOD cuando el predicado lo pide", () => {
    const { entries } = parseM3uEntries(SAMPLE_M3U, isVodGroup);
    expect(Object.keys(entries).sort()).toEqual([
      "Alguna Serie S01E01",
      "La Liga de la Justicia (2017)",
      "Vieux Film FR",
    ]);
  });

  it("ignora entradas sin URL tras #EXTINF", () => {
    const { entries } = parseM3uEntries('#EXTINF:-1 group-title="X",Sin url\n#EXTINF:-1,Otro\nhttp://x/1.ts', () => true);
    expect(Object.keys(entries)).toEqual(["Otro"]);
  });
});
