import { describe, expect, it } from "vitest";
import { buildLiveView, channelsForRows, MAX_VISIBLE_ROWS, searchVod } from "../src/core/browse.js";
import { FOOTBALL_KEYWORDS, applyFilter } from "../src/core/filters.js";
import { computeBaseName, groupChannelVariants } from "../src/core/grouping.js";
import type { ChannelMap } from "../src/core/types.js";

describe("applyFilter", () => {
  const channels: ChannelMap = {
    "TVE 1": { url: "u1", group: "[ES] GENERALES" },
    "Antena 3": { url: "u2", group: "[ES] GENERALES" },
    "DAZN LaLiga": { url: "u3", group: "[ES] SPORT" },
  };

  it("sin keywords devuelve una copia de todos", () => {
    const result = applyFilter(channels, null);
    expect(result).toEqual(channels);
    expect(result).not.toBe(channels);
  });

  it("filtra por nombre sin distinguir mayúsculas", () => {
    expect(applyFilter(channels, ["dazn"])).toEqual({ "DAZN LaLiga": channels["DAZN LaLiga"] });
  });

  it("el preset de fútbol no se contagia de películas con nombres parecidos", () => {
    const mixed: ChannelMap = {
      "DAZN LALIGA": { url: "1", group: "[ES] SPORT" },
      "beIN Sports 1": { url: "2", group: "[ES] SPORT" },
      "UEFA Champions League": { url: "3", group: "[ES] SPORT" },
      "La Liga de la Justicia (2017)": { url: "4", group: "CIMA ES" },
      "Champions (2023)": { url: "5", group: "CIMA ES" },
      "TVE 1": { url: "6", group: "[ES] GENERALES" },
    };
    const result = applyFilter(mixed, FOOTBALL_KEYWORDS);
    expect(Object.keys(result).sort()).toEqual(["DAZN LALIGA", "UEFA Champions League", "beIN Sports 1"].sort());
  });
});

describe("computeBaseName", () => {
  it("quita sufijos de calidad encadenados", () => {
    expect(computeBaseName("DAZN LALIGA 4K")).toBe("DAZN LALIGA");
    expect(computeBaseName("DAZN LALIGA FULL HD")).toBe("DAZN LALIGA");
    expect(computeBaseName("Canal UHD 235")).toBe("Canal");
  });

  it("conserva números de canal que no son sufijos de calidad", () => {
    expect(computeBaseName("DAZN LALIGA 2")).toBe("DAZN LALIGA 2");
    expect(computeBaseName("iEN Doros 01")).toBe("iEN Doros 01");
  });
});

describe("groupChannelVariants", () => {
  it("agrupa variantes de calidad bajo el nombre base", () => {
    const grouped = groupChannelVariants({
      "DAZN LALIGA": { url: "a", group: "[ES] LIGA" },
      "DAZN LALIGA HD": { url: "b", group: "[ES] SPORT" },
      "DAZN LALIGA 4K": { url: "c", group: "[ES] SPORT" },
      "TVE 1": { url: "d", group: "[ES] GENERALES" },
    });

    const laliga = grouped.get("DAZN LALIGA");
    expect(laliga?.map((variant) => variant.label)).toEqual(["DAZN LALIGA", "DAZN LALIGA 4K", "DAZN LALIGA HD"]);
    expect(grouped.get("TVE 1")).toHaveLength(1);
  });

  it("un canal suelto conserva su nombre original", () => {
    const grouped = groupChannelVariants({ "Canal HD": { url: "x", group: "" } });
    expect(grouped.get("Canal HD")?.[0].label).toBe("Canal HD");
  });
});

describe("buildLiveView", () => {
  const channels: ChannelMap = {
    "DAZN LALIGA": { url: "a", group: "[ES] SPORT" },
    "DAZN LALIGA HD": { url: "b", group: "[ES] SPORT" },
    "TVE 1": { url: "c", group: "[ES] GENERALES" },
  };

  it("en vista Todos agrupa por categoría y cuenta variantes", () => {
    const view = buildLiveView(channels, true);
    expect(view.sections.map((section) => section.title)).toEqual(["[ES] GENERALES", "[ES] SPORT"]);
    expect(view.sections[1].channelCount).toBe(2);
    expect(view.sections[1].rows).toHaveLength(1);
  });

  it("sin agrupar no pone cabeceras", () => {
    const view = buildLiveView({ "TVE 1": { url: "c", group: "[ES] GENERALES" } }, false);
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0].title).toBeNull();
  });

  it("limita las filas renderizadas y lo indica", () => {
    const many: ChannelMap = {};
    for (let i = 0; i < MAX_VISIBLE_ROWS + 25; i += 1) many[`Canal ${i}`] = { url: `u${i}`, group: "G" };
    const view = buildLiveView(many, false);
    expect(view.shownRows).toBe(MAX_VISIBLE_ROWS);
    expect(view.totalRows).toBe(MAX_VISIBLE_ROWS + 25);
  });
});

describe("searchVod", () => {
  it("busca sin distinguir mayúsculas y limita resultados", () => {
    const entries: ChannelMap = {
      "Matrix (1999)": { url: "1", group: "CIMA" },
      "The Matrix Reloaded": { url: "2", group: "CIMA" },
      "Otra": { url: "3", group: "CIMA" },
    };
    const result = searchVod(entries, "matrix", 1);
    expect(result.total).toBe(2);
    expect(result.shown).toEqual(["Matrix (1999)"]);
  });
});

describe("channelsForRows", () => {
  it("un grupo de calidades entra completo al favoritearlo por su nombre base", () => {
    const channels: ChannelMap = {
      "Eurosport 1": { url: "a", group: "SPORT" },
      "Eurosport 1 HD": { url: "b", group: "SPORT" },
      "TVE 1": { url: "c", group: "GEN" },
    };
    const result = channelsForRows(channels, ["Eurosport 1"]);
    expect(Object.keys(result).sort()).toEqual(["Eurosport 1", "Eurosport 1 HD"]);
  });

  it("un canal suelto se favorita por su nombre original", () => {
    const channels: ChannelMap = { "TVE 1": { url: "c", group: "GEN" } };
    expect(Object.keys(channelsForRows(channels, ["TVE 1"]))).toEqual(["TVE 1"]);
  });
});
