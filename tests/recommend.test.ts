import { describe, expect, it } from "vitest";
import { recommendIndex } from "../src/core/recommend.js";
import type { StreamQuality } from "../src/core/types.js";

const q = (height: number | null, fps: number | null = 25, codec: string | null = "h264"): StreamQuality => ({
  width: null,
  height,
  codec,
  fps,
});

describe("recommendIndex", () => {
  it("elige la mayor resolución real medida", () => {
    expect(recommendIndex([q(720), q(2160), q(1080)])).toBe(1);
  });

  it("en empate de resolución gana el de más fps", () => {
    expect(recommendIndex([q(1080, 25), q(1080, 50)])).toBe(1);
  });

  it("en empate de resolución y fps prefiere h264", () => {
    expect(recommendIndex([q(1080, 25, "hevc"), q(1080, 25, "h264")])).toBe(1);
  });

  it("ignora variantes no medidas", () => {
    expect(recommendIndex([null, q(null), q(576)])).toBe(2);
  });

  it("devuelve null si ninguna variante se midió", () => {
    expect(recommendIndex([null, q(null)])).toBeNull();
    expect(recommendIndex([])).toBeNull();
  });
});
