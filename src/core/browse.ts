import { groupChannelVariants } from "./grouping.js";
import type { ChannelMap, ChannelVariant } from "./types.js";

/** Tope de filas visibles: renderizar miles de tiles congela la interfaz. */
export const MAX_VISIBLE_ROWS = 300;

export interface ChannelRow {
  displayName: string;
  variants: ChannelVariant[];
}

export interface ChannelSection {
  /** Nombre de categoría, o null cuando la lista no va agrupada. */
  title: string | null;
  /** Canales (variantes incluidas) de la categoría, aunque no se rendericen todos. */
  channelCount: number;
  rows: ChannelRow[];
}

export interface LiveView {
  sections: ChannelSection[];
  totalRows: number;
  shownRows: number;
  totalChannels: number;
}

const UNCATEGORIZED = "Sin categoría";

/** Categoría más frecuente entre las variantes; en empate gana la primera. */
function dominantCategory(variants: ChannelVariant[]): string {
  const counts = new Map<string, number>();
  for (const variant of variants) {
    const group = variant.group || UNCATEGORIZED;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  let best = UNCATEGORIZED;
  let bestCount = -1;
  for (const [group, count] of counts) {
    if (count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best;
}

const byName = (a: ChannelRow, b: ChannelRow) =>
  a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0;

/**
 * Prepara la vista de canales en directo. Las variantes de calidad se
 * fusionan sobre el conjunto filtrado completo (el group-title del proveedor
 * es inconsistente entre variantes). Con varias categorías, cada fila va a la
 * categoría mayoritaria de sus variantes.
 *
 * `allCategory` es true cuando el filtro es "Todos" (siempre agrupa por categoría).
 */
export function buildLiveView(filtered: ChannelMap, allCategory: boolean): LiveView {
  const totalChannels = Object.keys(filtered).length;
  const categories = new Set(Object.values(filtered).map((entry) => entry.group || UNCATEGORIZED));
  const groupByCategory = allCategory || categories.size > 1;

  const rows: ChannelRow[] = [...groupChannelVariants(filtered)].map(([displayName, variants]) => ({
    displayName,
    variants,
  }));

  if (!groupByCategory) {
    rows.sort(byName);
    const shown = rows.slice(0, MAX_VISIBLE_ROWS);
    return {
      sections: [{ title: null, channelCount: shown.length, rows: shown }],
      totalRows: rows.length,
      shownRows: shown.length,
      totalChannels,
    };
  }

  const byCategory = new Map<string, ChannelRow[]>();
  const channelsPerCategory = new Map<string, number>();
  for (const row of rows) {
    const category = dominantCategory(row.variants);
    const bucket = byCategory.get(category) ?? [];
    bucket.push(row);
    byCategory.set(category, bucket);
    channelsPerCategory.set(category, (channelsPerCategory.get(category) ?? 0) + row.variants.length);
  }

  const sections: ChannelSection[] = [];
  let shown = 0;
  for (const category of [...byCategory.keys()].sort()) {
    if (shown >= MAX_VISIBLE_ROWS) break;
    const sectionRows: ChannelRow[] = [];
    for (const row of (byCategory.get(category) ?? []).sort(byName)) {
      if (shown >= MAX_VISIBLE_ROWS) break;
      sectionRows.push(row);
      shown += 1;
    }
    sections.push({
      title: category,
      channelCount: channelsPerCategory.get(category) ?? 0,
      rows: sectionRows,
    });
  }

  return { sections, totalRows: rows.length, shownRows: shown, totalChannels };
}

/** Filtra un catálogo VOD por texto (sin distinguir mayúsculas), ordenado, con tope de resultados. */
export function searchVod(entries: ChannelMap, query: string, limit: number): { shown: string[]; total: number } {
  const needle = query.toUpperCase();
  const matches = Object.keys(entries)
    .filter((name) => name.toUpperCase().includes(needle))
    .sort();
  return { shown: matches.slice(0, limit), total: matches.length };
}

/**
 * Canales (variantes incluidas) de las filas cuyo nombre visible está en
 * `keys`. Un grupo de calidades se favorita por su nombre base, así que todas
 * sus variantes entran o salen juntas.
 */
export function channelsForRows(channels: ChannelMap, keys: Iterable<string>): ChannelMap {
  const wanted = new Set(keys);
  const out: ChannelMap = {};
  for (const [displayName, variants] of groupChannelVariants(channels)) {
    if (!wanted.has(displayName)) continue;
    for (const variant of variants) {
      out[variant.label] = { url: variant.url, group: variant.group, logo: variant.logo };
    }
  }
  return out;
}
