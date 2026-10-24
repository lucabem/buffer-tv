import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./process.js";
import type { StreamQuality } from "./types.js";

const MB = 1024 * 1024;
/** Por debajo de esto el canal se considera inestable (datos insuficientes). */
const MIN_STABLE_BYTES = 300 * 1024;

export interface ChannelTestResult {
  ok: boolean;
  bitrateMbps: number;
}

/**
 * Graba unos segundos del stream para comprobar que llega datos. El bitrate
 * se calcula a partir de los bytes recibidos (ffprobe no lo reporta fiable en MPEG-TS).
 */
export async function testChannel(
  streamUrl: string,
  opts: { tempDir: string; durationSec?: number; log?: (msg: string) => void },
): Promise<ChannelTestResult> {
  const duration = opts.durationSec ?? 3;
  const log = opts.log ?? (() => {});
  log(`Probando canal (${duration}s)...`);

  mkdirSync(opts.tempDir, { recursive: true });
  const testFile = join(opts.tempDir, "channel_test.ts");

  const result = await runCommand(
    "ffmpeg",
    ["-y", "-timeout", "8000000", "-i", streamUrl, "-c", "copy", "-f", "mpegts", "-t", String(duration), testFile],
    { timeoutMs: (duration + 6) * 1000 },
  );

  if (result.timedOut) {
    log("Canal no respondió a tiempo (timeout)");
    return { ok: false, bitrateMbps: 0 };
  }
  if (result.error) {
    log(`Error probando canal: ${result.error.message}`);
    return { ok: false, bitrateMbps: 0 };
  }
  if (!existsSync(testFile)) {
    log("Canal no generó datos");
    return { ok: false, bitrateMbps: 0 };
  }

  const size = statSync(testFile).size;
  const bitrateMbps = ((size * 8) / MB) / duration;
  rmSync(testFile, { force: true });

  if (size > MIN_STABLE_BYTES) {
    log(`Canal estable: ${(size / MB).toFixed(2)}MB en ${duration}s (~${bitrateMbps.toFixed(1)} Mbps)`);
    return { ok: true, bitrateMbps };
  }

  log(`Canal con muy pocos datos (${(size / MB).toFixed(2)}MB) - probablemente inestable`);
  return { ok: false, bitrateMbps };
}

const EMPTY_QUALITY: StreamQuality = { width: null, height: null, codec: null, fps: null };

/**
 * Sonda real (resolución, codec, fps) con ffprobe, independiente del nombre
 * del canal ("DAZN LALIGA 4K" emite en realidad a 1080p). Nunca lanza: si
 * ffprobe falta o falla devuelve todo a null.
 */
export async function probeChannelQuality(
  streamUrl: string,
  opts: { timeoutSec?: number; log?: (msg: string) => void } = {},
): Promise<StreamQuality> {
  const log = opts.log ?? (() => {});
  const result = await runCommand(
    "ffprobe",
    [
      "-v", "error",
      "-analyzeduration", "5000000",
      "-probesize", "5000000",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,avg_frame_rate",
      "-of", "json",
      streamUrl,
    ],
    { timeoutMs: (opts.timeoutSec ?? 10) * 1000, captureStdout: true },
  );

  if (result.timedOut) {
    log("Sonda de calidad (ffprobe) no respondió a tiempo");
    return { ...EMPTY_QUALITY };
  }
  if (result.error || result.code !== 0 || !result.stdout) {
    return { ...EMPTY_QUALITY };
  }

  return parseProbeOutput(result.stdout);
}

interface FfprobeStream {
  width?: number;
  height?: number;
  codec_name?: string;
  avg_frame_rate?: string;
}

/** Interpreta la salida JSON de ffprobe. Exportada para tests. */
export function parseProbeOutput(stdout: string): StreamQuality {
  const quality: StreamQuality = { ...EMPTY_QUALITY };
  let stream: FfprobeStream | undefined;
  try {
    const data = JSON.parse(stdout) as { streams?: FfprobeStream[] };
    stream = data.streams?.[0];
  } catch {
    return quality;
  }
  if (!stream) return quality;

  quality.width = stream.width ?? null;
  quality.height = stream.height ?? null;
  quality.codec = stream.codec_name ?? null;

  const rate = stream.avg_frame_rate;
  if (rate && rate !== "0/0") {
    const [numStr, denStr = "1"] = rate.split("/");
    const num = Number(numStr);
    const den = Number(denStr);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      quality.fps = num / den;
    }
  }
  return quality;
}
