import type { StreamQuality } from "./types.js";

/** Códec preferido en empate: h264 se decodifica en casi cualquier equipo. */
const CODEC_RANK: Record<string, number> = { h264: 2, hevc: 1 };

function isBetter(a: StreamQuality, b: StreamQuality): boolean {
  const heightA = a.height ?? 0;
  const heightB = b.height ?? 0;
  if (heightA !== heightB) return heightA > heightB;

  const fpsA = a.fps ?? 0;
  const fpsB = b.fps ?? 0;
  if (fpsA !== fpsB) return fpsA > fpsB;

  return (CODEC_RANK[a.codec ?? ""] ?? 0) > (CODEC_RANK[b.codec ?? ""] ?? 0);
}

/**
 * Índice de la variante recomendada según la calidad real medida: mayor
 * resolución, luego más fps, luego códec más compatible. Ignora las variantes
 * que no se pudieron medir. Devuelve null si ninguna se midió.
 */
export function recommendIndex(qualities: Array<StreamQuality | null>): number | null {
  let best: number | null = null;
  qualities.forEach((quality, index) => {
    if (!quality?.height) return;
    const current = best === null ? null : qualities[best];
    if (current === null || current === undefined || isBetter(quality, current)) best = index;
  });
  return best;
}
