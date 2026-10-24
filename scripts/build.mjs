// Empaqueta el proceso principal, el preload y el renderer con esbuild y copia
// los recursos estáticos de la UI. Los tipos se comprueban aparte (npm run typecheck).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/main`, { recursive: true });
mkdirSync(`${out}/renderer`, { recursive: true });

const shared = { bundle: true, sourcemap: true, logLevel: "info" };

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/main/main.ts"],
    outfile: `${out}/main/main.js`,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
  }),
  build({
    ...shared,
    entryPoints: ["src/main/preload.ts"],
    outfile: `${out}/main/preload.js`,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
  }),
  build({
    ...shared,
    entryPoints: ["src/renderer/app.ts"],
    outfile: `${out}/renderer/app.js`,
    platform: "browser",
    format: "iife",
    target: "chrome120",
  }),
]);

cpSync("src/renderer/index.html", `${out}/renderer/index.html`);
cpSync("src/renderer/styles.css", `${out}/renderer/styles.css`);
console.log("[build] listo en dist/");
