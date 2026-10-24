import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv, terminate } from "./process.js";
import { RATE_WINDOW_MS, RateMeter } from "./rate.js";
import type { PlayerStatus } from "./types.js";

const MB = 1024 * 1024;
/** Antes de abrir ffplay hace falta este mínimo de buffer acumulado. */
const MIN_PLAYBACK_BYTES = 50 * MB;
const HEALTH_INTERVAL_MS = 2000;
const MAX_BACKOFF_SECONDS = 20;

export interface PlayerOptions {
  delaySeconds: number;
  bufferSizeMb: number;
  /** Directorio del buffer. Por defecto <tmp>/iptv-buffer. */
  bufferDir?: string;
  onLog?: (message: string) => void;
  onStatus?: (status: PlayerStatus) => void;
  onStopped?: () => void;
}

/**
 * Borra los .ts más antiguos (conservando el más reciente) hasta quedar por
 * debajo del 80% del máximo. Igual que la versión Python: el fichero que se
 * está escribiendo nunca se borra, así que con un único fichero no lo recorta.
 */
export function cleanupOldBufferFiles(dir: string, maxBytes: number, log: (msg: string) => void = () => {}): void {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return { name, path, size: stat.size, mtime: stat.mtimeMs };
    });

  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= maxBytes) return;

  files.sort((a, b) => a.mtime - b.mtime);
  for (const file of files.slice(0, -1)) {
    try {
      rmSync(file.path);
      total -= file.size;
      log(`Limpiando buffer antiguo: ${file.name} (${(file.size / MB).toFixed(1)}MB)`);
      if (total <= maxBytes * 0.8) break;
    } catch (error) {
      log(`Error limpiando ${file.name}: ${String(error)}`);
    }
  }
}

/**
 * Captura el stream con ffmpeg a un fichero de buffer en disco, lo reconecta
 * con backoff exponencial si se corta y lanza ffplay sobre ese fichero cuando
 * hay suficiente material acumulado.
 */
export class IPTVPlayer {
  readonly bufferDir: string;
  readonly bufferFile: string;

  private readonly delaySeconds: number;
  private readonly bufferSizeMb: number;
  private readonly log: (message: string) => void;
  private readonly onStatus: (status: PlayerStatus) => void;
  private readonly onStopped: () => void;

  private ffmpeg: ChildProcess | null = null;
  private ffplay: ChildProcess | null = null;
  private monitoring = false;
  private streamHealthy = false;
  private reconnectCount = 0;
  private lastDataTime = 0;
  private totalBytes = 0;
  private healthTimer: NodeJS.Timeout | null = null;
  private stopPromise: Promise<void> | null = null;
  private readonly sleepers = new Set<() => void>();

  constructor(opts: PlayerOptions) {
    this.delaySeconds = opts.delaySeconds;
    this.bufferSizeMb = opts.bufferSizeMb;
    this.log = opts.onLog ?? (() => {});
    this.onStatus = opts.onStatus ?? (() => {});
    this.onStopped = opts.onStopped ?? (() => {});
    this.bufferDir = opts.bufferDir ?? join(tmpdir(), "iptv-buffer");
    this.bufferFile = join(this.bufferDir, "stream.ts");
    mkdirSync(this.bufferDir, { recursive: true });
  }

  /** True una vez pedido el stop: las tareas en curso no deben arrancar captura. */
  get isStopped(): boolean {
    return this.stopPromise !== null;
  }

  /** Arranca la captura en segundo plano (ffmpeg + reconexión + monitor de salud). */
  startCapture(streamUrl: string): void {
    if (existsSync(this.bufferFile)) {
      try {
        rmSync(this.bufferFile);
      } catch (error) {
        this.log(`Error limpiando buffer anterior: ${String(error)}`);
      }
    }

    this.log(`Iniciando captura (retraso ${this.delaySeconds}s, buffer ${this.bufferSizeMb}MB)...`);
    this.monitoring = true;
    this.reconnectCount = 0;
    this.totalBytes = 0;
    this.lastDataTime = Date.now();

    void this.superviseCapture(streamUrl);
    this.startHealthMonitor();
  }

  /** Espera a tener suficiente buffer y abre ffplay. Al cerrar la ventana, detiene todo. */
  startPlayback(): void {
    void this.playWhenBuffered();
  }

  /** Detiene captura y reproducción. Llamadas repetidas comparten la misma operación. */
  stop(): Promise<void> {
    this.stopPromise ??= this.doStop();
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    this.monitoring = false;
    this.wakeSleepers();
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;

    await terminate(this.ffplay);
    await terminate(this.ffmpeg);

    this.log("Detenido");
    this.onStopped();
  }

  private async superviseCapture(streamUrl: string): Promise<void> {
    let backoff = 1;
    let fd: number;
    try {
      fd = openSync(this.bufferFile, "a");
    } catch (error) {
      this.log(`Error abriendo el buffer: ${String(error)}`);
      this.monitoring = false;
      return;
    }

    try {
      while (this.monitoring) {
        await this.runFfmpegOnce(streamUrl, fd);
        if (!this.monitoring) break;

        this.reconnectCount += 1;
        this.log(`Conexión perdida. Reconectando en ${backoff}s (intento ${this.reconnectCount})...`);
        await this.sleep(backoff * 1000);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_SECONDS);
      }
    } finally {
      closeSync(fd);
    }
  }

  /** Una ejecución de ffmpeg: resuelve cuando el proceso termina por cualquier motivo. */
  private runFfmpegOnce(streamUrl: string, fd: number): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.streamHealthy = false;
        resolve();
      };

      let child: ChildProcess;
      try {
        child = spawn(
          "ffmpeg",
          ["-timeout", "15000000", "-i", streamUrl, "-c", "copy", "-f", "mpegts", "pipe:1"],
          { env: childEnv(), stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch (error) {
        this.log(`Error lanzando ffmpeg: ${String(error)}`);
        finish();
        return;
      }

      this.ffmpeg = child;
      this.streamHealthy = true;

      child.stdout?.on("data", (chunk: Buffer) => {
        try {
          writeSync(fd, chunk);
        } catch (error) {
          this.log(`Error escribiendo el buffer: ${String(error)}`);
          return;
        }
        this.totalBytes += chunk.length;
        this.lastDataTime = Date.now();
      });
      child.on("error", (error) => {
        this.log(`Error lanzando ffmpeg: ${error.message}`);
        finish();
      });
      child.on("close", finish);
    });
  }

  private startHealthMonitor(): void {
    const meter = new RateMeter(RATE_WINDOW_MS);

    const tick = () => {
      if (!this.monitoring) return;
      const now = Date.now();
      const sizeMb = existsSync(this.bufferFile) ? statSync(this.bufferFile).size / MB : 0;
      // Media de la ventana móvil: evita que la ráfaga inicial dispare la estimación.
      const rate = meter.sample(now, this.totalBytes);

      const sinceLastData = this.lastDataTime ? (now - this.lastDataTime) / 1000 : 0;
      this.onStatus({
        buffer_mb: sizeMb,
        max_mb: this.bufferSizeMb,
        rate_mb_s: rate,
        healthy: this.streamHealthy && sinceLastData < 5,
        reconnects: this.reconnectCount,
      });

      try {
        cleanupOldBufferFiles(this.bufferDir, this.bufferSizeMb * MB, this.log);
      } catch {
        // La limpieza es best-effort; no debe tumbar el monitor.
      }
    };

    tick();
    this.healthTimer = setInterval(tick, HEALTH_INTERVAL_MS);
  }

  private async playWhenBuffered(): Promise<void> {
    while (this.monitoring && !existsSync(this.bufferFile)) {
      await this.sleep(500);
    }

    this.log("Acumulando buffer antes de reproducir...");
    while (this.monitoring && existsSync(this.bufferFile) && statSync(this.bufferFile).size < MIN_PLAYBACK_BYTES) {
      await this.sleep(1000);
    }
    if (!this.monitoring) return;

    this.log("Buffer suficiente. Abriendo ventana de video...");
    try {
      const child = spawn("ffplay", ["-window_title", "IPTV Player", this.bufferFile], {
        env: childEnv(),
        stdio: "ignore",
      });
      this.ffplay = child;
      await new Promise<void>((resolve) => {
        child.on("error", (error) => {
          this.log(`Error en reproducción: ${error.message}`);
          resolve();
        });
        child.on("close", () => {
          this.log("Video cerrado");
          resolve();
        });
      });
    } catch (error) {
      this.log(`Error en reproducción: ${String(error)}`);
    } finally {
      await this.stop();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }

  private wakeSleepers(): void {
    for (const wake of [...this.sleepers]) wake();
  }
}
