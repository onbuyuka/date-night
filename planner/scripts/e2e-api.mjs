import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const temporaryRoot = fileURLToPath(new URL("../.wrangler/e2e/", import.meta.url));
await mkdir(temporaryRoot, { recursive: true });
const directory = await mkdtemp(join(temporaryRoot, "run-"));
const fixture = spawn(process.execPath, [fileURLToPath(new URL("../tests/fixtures/web-reader.mjs", import.meta.url))], { stdio: "inherit" });
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../worker/index.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
});
const options = {
  host: "127.0.0.1", port: 0, modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-07-01", d1Databases: ["DB"], d1Persist: directory,
  bindings: {
    AUTH_SECRET: "e2e-only-authentication-secret-not-a-real-key",
    LOCAL_DEV: "true", APP_ORIGIN: "http://127.0.0.1:5174",
    TOMTOM_API_KEY: "e2e-only-tomtom-key", TAVILY_API_KEY: "e2e-only-tavily-key",
    LOCAL_LOOKUP_ORIGIN: "http://127.0.0.1:8793", LOCAL_WEB_FETCH_ORIGIN: "http://127.0.0.1:8793",
  },
};
const mf = new Miniflare(options);
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  fixture.kill();
  await mf.dispose();
  await rm(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
}
process.once("SIGTERM", () => { void stop(0); });
process.once("SIGINT", () => { void stop(0); });
try {
  const db = await mf.getD1Database("DB");
  const migrationRoot = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrationRoot)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    const sql = await readFile(new URL(name, migrationRoot), "utf8");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  await mf.setOptions({ ...options, port: 8789 });
  await mf.ready;
  console.log("Isolated browser-test API ready on 127.0.0.1:8789");
} catch (error) {
  console.error("Browser-test API failed:", error instanceof Error ? error.message : "startup failure");
  await stop(1);
}
