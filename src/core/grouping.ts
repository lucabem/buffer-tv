import type { ChannelMap, ChannelVariant } from "./types.js";

/**
 * Sufijos de calidad conocidos. Los más específicos (FULL HD, UHD, FHD...)
 * van antes que el "HD" suelto. El número de 2-4 cifras solo se recorta
 * pegado a una palabra de calidad: "iEN Doros 01" no es una variante.
 */
const QUALITY_SUFFIX_RE = /\s*(?:FULL\s*HD|HD\+|UHD|FHD|4K|HD|SD)(?:\s+\d{2,4})?$/i;

function stripOneSuffix(name: string): [string, boolean] {
  const match = QUALITY_SUFFIX_RE.exec(name);
  if (!match) return [name, false];
  return [name.slice(0, match.index).trimEnd(), true];
}

/** Quita repetidamente los sufijos de calidad del final del nombre. */
export function computeBaseName(name: string): string {
  let base = name.trim();
  for (;;) {
    const [next, changed] = stripOneSuffix(base);
    if (!changed) return base;
    base = next;
  }
}

/**
 * Agrupa canales que son variantes de calidad del mismo canal base.
 * Devuelve Map<nombreBase, variantes[]>. Un canal sin hermanos (o cuyo
 * nombre base queda vacío) se devuelve como grupo de un elemento bajo su
 * nombre original, para que la UI lo trate como un canal normal.
 */
export function groupChannelVariants(channels: ChannelMap): Map<string, ChannelVariant[]> {
  const byBase = new Map<string, Array<[string, ChannelMap[string]]>>();
  for (const [name, entry] of Object.entries(channels)) {
    const base = computeBaseName(name);
    const bucket = byBase.get(base);
    if (bucket) bucket.push([name, entry]);
    else byBase.set(base, [[name, entry]]);
  }

  const toVariant = (name: string, entry: ChannelMap[string]): ChannelVariant => ({
    label: name,
    url: entry.url,
    group: entry.group ?? "",
    logo: entry.logo ?? "",
  });

  const result = new Map<string, ChannelVariant[]>();
  for (const [base, items] of byBase) {
    if (!base || items.length === 1) {
      for (const [name, entry] of items) result.set(name, [toVariant(name, entry)]);
      continue;
    }
    const variants = [...items]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, entry]) => toVariant(name, entry));
    result.set(base, variants);
  }
  return result;
}
