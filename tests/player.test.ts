import { mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupOldBufferFiles } from "../src/core/player.js";
import { parseProbeOutput } from "../src/core/probe.js";
import { runCommand } from "../src/core/process.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "iptv-test-buffer-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cleanupOldBufferFiles", () => {
  it("borra los ficheros más antiguos hasta bajar del 80% y conserva el más reciente", () => {
    const mb = 1024 * 1024;
    const files = [
      { name: "old.ts", size: 4 * mb, age: 300 },
      { name: "mid.ts", size: 4 * mb, age: 200 },
      { name: "new.ts", size: 4 * mb, age: 100 },
    ];
    const now = Date.now() / 1000;
    for (const file of files) {
      const path = join(dir, file.name);
      writeFileSync(path, Buffer.alloc(file.size));
      utimesSync(path, now - file.age, now - file.age);
    }

    cleanupOldBufferFiles(dir, 8 * mb);

    expect(existsSync(join(dir, "old.ts"))).toBe(false);
    expect(existsSync(join(dir, "mid.ts"))).toBe(false);
    expect(existsSync(join(dir, "new.ts"))).toBe(true);
  });

  it("no hace nada si el total cabe en el máximo", () => {
    writeFileSync(join(dir, "a.ts"), Buffer.alloc(1024));
    cleanupOldBufferFiles(dir, 1024 * 1024);
    expect(existsSync(join(dir, "a.ts"))).toBe(true);
  });
});

describe("parseProbeOutput", () => {
  it("lee resolución, códec y fps fraccionarios", () => {
    const stdout = JSON.stringify({
      streams: [{ codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001" }],
    });
    expect(parseProbeOutput(stdout)).toEqual({
      width: 1920,
      height: 1080,
      codec: "h264",
      fps: 30000 / 1001,
    });
  });

  it("tolera frame rate 0/0 y salida sin streams", () => {
    expect(parseProbeOutput('{"streams":[{"codec_name":"hevc","avg_frame_rate":"0/0"}]}').fps).toBeNull();
    expect(parseProbeOutput("{}")).toEqual({ width: null, height: null, codec: null, fps: null });
  });

  it("JSON inválido devuelve todo a null", () => {
    expect(parseProbeOutput("no json").codec).toBeNull();
  });
});

describe("runCommand", () => {
  it("captura stdout y código de salida", async () => {
    const result = await runCommand("node", ["-e", "process.stdout.write('hola')"], {
      timeoutMs: 10_000,
      captureStdout: true,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hola");
  });

  it("informa de binario inexistente sin lanzar", async () => {
    const result = await runCommand("iptv-buffer-no-existe", [], { timeoutMs: 5_000 });
    expect(result.error).toBeDefined();
  });

  it("mata el proceso si supera el timeout", async () => {
    const result = await runCommand("node", ["-e", "setTimeout(()=>{}, 60000)"], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
  });
});
