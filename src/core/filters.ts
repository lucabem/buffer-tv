import type { ChannelMap } from "./types.js";

/** Canal de fútbol. "LIGA" a secas se omite a propósito: coincide con películas ("La Liga de la Justicia"). */
export const FOOTBALL_KEYWORDS = [
  "LALIGA", "FUTBOL", "SOCCER", "FOOTBALL", "FUSSBALL",
  "UEFA", "CHAMPIONS LEAGUE", "EUROPA LEAGUE",
  "PREMIER LEAGUE", "PREMIER SPORTS", "SERIE A", "LIGUE 1", "BUNDESLIGA",
  "DAZN", "ESPN", "FOX SPORTS", "BEIN SPOR", "BEINSPOR",
  "CLARO SPORTS", "DIRECTV",
  "REAL MADRID", "BARCELONA", "ATLETICO",
  "SEVILLA", "VALENCIA", "BETIS",
];

export const MPLUS_DAZN_KEYWORDS = ["M+", "MOVISTAR", "DAZN"];

/** Presets de palabra clave. `null` = sin filtro. */
export const PRESETS: Record<string, string[] | null> = {
  Todos: null,
  "Fútbol": FOOTBALL_KEYWORDS,
  "M+ y DAZN": MPLUS_DAZN_KEYWORDS,
};

/** Filtra solo por nombre: el group-title del proveedor es inconsistente. */
export function applyFilter(channels: ChannelMap, keywords: string[] | null): ChannelMap {
  if (keywords === null) return { ...channels };

  const filtered: ChannelMap = {};
  const needles = keywords.map((kw) => kw.toUpperCase());
  for (const [name, entry] of Object.entries(channels)) {
    const haystack = name.toUpperCase();
    if (needles.some((kw) => haystack.includes(kw))) {
      filtered[name] = entry;
    }
  }
  return filtered;
}
