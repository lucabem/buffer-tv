import { describe, expect, it } from "vitest";
import { RateMeter } from "../src/core/rate.js";

const MB = 1024 * 1024;

/** Simula un servidor que envía 3 MB/s los primeros 5 s y luego 0.5 MB/s, muestreando cada 2 s. */
function bytesAt(seconds: number): number {
  return seconds <= 5 ? 3 * MB * seconds : 15 * MB + 0.5 * MB * (seconds - 5);
}

describe("RateMeter", () => {
  it("con descarga constante devuelve esa tasa", () => {
    const meter = new RateMeter();
    let last = 0;
    for (let t = 0; t <= 30; t += 2) last = meter.sample(t * 1000, t * MB);
    expect(last).toBeCloseTo(1, 5);
  });

  it("tras la ráfaga inicial converge a la tasa sostenida", () => {
    const meter = new RateMeter();
    let last = 0;
    for (let t = 0; t <= 40; t += 2) last = meter.sample(t * 1000, bytesAt(t));
    expect(last).toBeGreaterThan(0.45);
    expect(last).toBeLessThan(0.55);
  });

  it("durante la ráfaga inicial refleja la subida", () => {
    const meter = new RateMeter();
    let last = 0;
    for (let t = 0; t <= 4; t += 2) last = meter.sample(t * 1000, bytesAt(t));
    expect(last).toBeCloseTo(3, 5);
  });

  it("sin tiempo transcurrido devuelve 0", () => {
    const meter = new RateMeter();
    expect(meter.sample(1000, 0)).toBe(0);
  });
});
