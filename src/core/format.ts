import type { StreamQuality } from "./types.js";

function formatFps(fps: number): string {
  return Number.isInteger(fps) ? `${fps.toFixed(0)}fps` : `${fps.toFixed(1)}fps`;
}

/** "720p · h264 · 50fps", o null si no se midió nada (para usar el nombre como fallback). */
export function formatQualityLabel(quality: StreamQuality): string | null {
  const parts: string[] = [];
  if (quality.height) parts.push(`${quality.height}p`);
  if (quality.codec) parts.push(quality.codec);
  if (quality.fps) parts.push(formatFps(quality.fps));
  return parts.length ? parts.join(" · ") : null;
}

/** "real: 1080p · h264 · 50fps · ~8.3 Mbps" para el registro y la cabecera del canal. */
export function formatRealQuality(quality: StreamQuality, bitrateMbps: number | null): string | null {
  const parts: string[] = [];
  if (quality.height) parts.push(`real: ${quality.height}p`);
  if (quality.codec) parts.push(quality.codec);
  if (quality.fps) parts.push(formatFps(quality.fps));
  if (bitrateMbps) parts.push(`~${bitrateMbps.toFixed(1)} Mbps`);
  return parts.length ? parts.join(" · ") : null;
}

/** Tiempo "HH:MM" en la zona local. */
export function formatClock(epochSeconds: number | null): string {
  if (epochSeconds == null) return "--:--";
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/** Buffer mínimo antes de abrir ffplay (igual que MIN_PLAYBACK_BYTES en la versión Python). */
export const MIN_PLAYBACK_MB = 50;

/** Segundos hasta poder abrir ffplay: 0 si ya hay buffer, null si aún no hay tasa medida. */
export function secondsUntilReady(bufferMb: number, rateMbPerSec: number, minMb = MIN_PLAYBACK_MB): number | null {
  if (bufferMb >= minMb) return 0;
  if (rateMbPerSec <= 0) return null;
  return (minMb - bufferMb) / rateMbPerSec;
}

/** Retraso real acumulado (segundos de vídeo en el buffer), o null sin tasa medida. */
export function bufferedDelaySeconds(bufferMb: number, rateMbPerSec: number): number | null {
  if (rateMbPerSec <= 0) return null;
  return bufferMb / rateMbPerSec;
}

/** "45 s" o "2 min 5 s". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}
