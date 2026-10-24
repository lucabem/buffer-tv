import { describe, expect, it } from "vitest";
import {
  cleanBbcode,
  findChannelId,
  getTodayProgrammes,
  normalizeName,
  parseXmltv,
  parseXmltvDate,
} from "../src/core/epg.js";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="La1.es">
    <display-name>La 1</display-name>
    <display-name>TVE 1</display-name>
  </channel>
  <channel id="dazn">
    <display-name>DAZN LaLiga</display-name>
  </channel>
  <programme start="20990101100000 +0000" stop="20990101110000 +0000" channel="La1.es">
    <title lang="es">[COLOR red]Telediario[/COLOR]</title>
    <desc>Noticias   del día</desc>
  </programme>
  <programme start="20990101090000 +0000" channel="La1.es">
    <title>Mañanero</title>
  </programme>
  <programme start="sin-fecha" channel="La1.es"><title>Roto</title></programme>
</tv>`;

describe("parseXmltvDate", () => {
  it("convierte una fecha XMLTV con zona horaria a epoch", () => {
    expect(parseXmltvDate("20990101100000 +0000")).toBe(Date.UTC(2099, 0, 1, 10) / 1000);
  });

  it("aplica el desfase horario", () => {
    expect(parseXmltvDate("20990101100000 +0200")).toBe(Date.UTC(2099, 0, 1, 8) / 1000);
  });

  it("devuelve null si el formato no encaja", () => {
    expect(parseXmltvDate("2099-01-01")).toBeNull();
    expect(parseXmltvDate(null)).toBeNull();
  });
});

describe("normalizeName y cleanBbcode", () => {
  it("quita tildes, pasa a minúsculas y colapsa espacios", () => {
    expect(normalizeName("  Canción  Ñandú ")).toBe("cancion nandu");
  });

  it("quita marcado de color", () => {
    expect(cleanBbcode("[COLOR red]Hola[/COLOR]   mundo")).toBe("Hola mundo");
  });
});

describe("parseXmltv", () => {
  const index = parseXmltv(XML);

  it("indexa nombres de canal normalizados", () => {
    expect(findChannelId(index, "tve 1")).toBe("La1.es");
    expect(findChannelId(index, "DAZN LALIGA HD")).toBe("dazn");
    expect(findChannelId(index, "Desconocido")).toBeNull();
  });

  it("ordena programas por inicio y descarta los que no tienen fecha válida", () => {
    const programmes = index.channels["La1.es"].programmes;
    expect(programmes.map((programme) => programme.title)).toEqual(["Mañanero", "Telediario"]);
    expect(programmes[1].desc).toBe("Noticias del día");
  });

  it("devuelve solo los programas del día pedido", () => {
    const day = new Date(2099, 0, 1, 12, 0);
    const today = getTodayProgrammes(index, "La1.es", day);
    expect(today).toHaveLength(2);
    expect(getTodayProgrammes(index, "La1.es", new Date(2100, 0, 1))).toHaveLength(0);
  });

  it("un canal nulo o inexistente da lista vacía", () => {
    expect(getTodayProgrammes(index, null)).toEqual([]);
    expect(getTodayProgrammes(index, "nope")).toEqual([]);
  });
});
