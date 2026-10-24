const MB = 1024 * 1024;

/** Ventana de la media de descarga: suaviza la ráfaga inicial de los servidores IPTV. */
export const RATE_WINDOW_MS = 20_000;

/**
 * Tasa media de descarga en MB/s sobre una ventana móvil. Las muestras son
 * el total acumulado de bytes en cada instante (ms).
 */
export class RateMeter {
  private samples: Array<{ at: number; bytes: number }> = [];

  constructor(private readonly windowMs: number = RATE_WINDOW_MS) {}

  sample(at: number, totalBytes: number): number {
    this.samples.push({ at, bytes: totalBytes });
    // Conserva como mucho una muestra más allá de la ventana, para medir sobre ella.
    while (this.samples.length > 2 && at - this.samples[1].at >= this.windowMs) {
      this.samples.shift();
    }
    const first = this.samples[0];
    const elapsedSeconds = (at - first.at) / 1000;
    if (elapsedSeconds <= 0) return 0;
    return (totalBytes - first.bytes) / MB / elapsedSeconds;
  }
}
