import { describe, expect, it } from "vitest";
import {
  bufferedDelaySeconds,
  formatClock,
  formatDuration,
  formatQualityLabel,
  formatRealQuality,
  secondsUntilReady,
  truncate,
} from "../src/core/format.js";

describe("formatQualityLabel", () => {
  it("combina alto, codec y fps", () => {
    expect(formatQualityLabel({ width: 1920, height: 1080, codec: "h264", fps: 50 })).toBe("1080p · h264 · 50fps");
  });

  it("muestra un decimal en fps fraccionarios", () => {
    expect(formatQualityLabel({ width: null, height: 720, codec: null, fps: 29.97 })).toBe("720p · 30.0fps");
  });

  it("devuelve null si no se midió nada", () => {
    expect(formatQualityLabel({ width: null, height: null, codec: null, fps: null })).toBeNull();
  });
});

describe("formatRealQuality", () => {
  it("añade el bitrate si se midió", () => {
    const quality = { width: 1920, height: 1080, codec: "h264", fps: 25 };
    expect(formatRealQuality(quality, 8.34)).toBe("real: 1080p · h264 · 25fps · ~8.3 Mbps");
  });
});

describe("helpers", () => {
  it("trunca con elipsis respetando el máximo", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("formatea la hora local HH:MM", () => {
    const epoch = new Date(2026, 0, 2, 9, 5).getTime() / 1000;
    expect(formatClock(epoch)).toBe("09:05");
    expect(formatClock(null)).toBe("--:--");
  });
});

describe("estimaciones de buffer", () => {
  it("calcula cuánto falta para abrir ffplay", () => {
    expect(secondsUntilReady(20, 2)).toBe(15);
    expect(secondsUntilReady(60, 2)).toBe(0);
    expect(secondsUntilReady(10, 0)).toBeNull();
  });

  it("calcula el retraso acumulado a partir de la tasa", () => {
    expect(bufferedDelaySeconds(300, 2)).toBe(150);
    expect(bufferedDelaySeconds(300, 0)).toBeNull();
  });

  it("formatea duraciones legibles", () => {
    expect(formatDuration(45.4)).toBe("45 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
  });
});
