import { spawn, type ChildProcess } from "node:child_process";

/**
 * Las apps lanzadas desde Finder no heredan el PATH de la terminal, así que
 * ffmpeg/ffplay de Homebrew podrían no encontrarse. Se añaden los sitios
 * habituales al PATH de los procesos hijos.
 */
const EXTRA_PATH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

export function childEnv(): NodeJS.ProcessEnv {
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  const merged = [...EXTRA_PATH_DIRS.filter((dir) => !current.includes(dir)), ...current];
  return { ...process.env, PATH: merged.join(":") };
}

export interface RunResult {
  code: number | null;
  stdout: string;
  timedOut: boolean;
  /** Presente si el binario no existe o no se pudo lanzar (p. ej. ENOENT). */
  error?: Error;
}

/** Ejecuta un comando y espera su salida con timeout. Nunca lanza. */
export function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs: number; captureStdout?: boolean },
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      env: childEnv(),
      stdio: [
        "ignore",
        opts.captureStdout ? "pipe" : "ignore",
        "ignore",
      ],
    });

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", (error) => finish({ code: null, stdout, timedOut, error }));
    child.on("close", (code) => finish({ code, stdout, timedOut }));
  });
}

/** Termina un proceso: SIGTERM, y SIGKILL si no sale en `graceMs`. */
export function terminate(child: ChildProcess | null | undefined, graceMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
