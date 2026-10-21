import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

let mf;
let imports;
const readerKey = "test-only-independent-reader-key-123456789";
before(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../worker/production.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
  });
  mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-01",
    d1Databases: ["DB"],
    bindings: { AUTH_SECRET: "test-only-server-authentication-secret-123456789", LOCAL_DEV: "true", APP_ORIGIN: "https://planner.example.org" },
    serviceBindings: { ASSETS: async () => new Response("<html><title>Date Night</title></html>", { headers: { "Content-Type": "text/html" } }) },
  });
  const root = new URL("../migrations/", import.meta.url);
  const db = await mf.getD1Database("DB");
  for (const name of (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    const sql = await readFile(new URL(name, root), "utf8");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const importer = await build({
    entryPoints: [fileURLToPath(new URL("../worker/import.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
  });
  imports = await import(`data:text/javascript;base64,${Buffer.from(importer.outputFiles[0].text).toString("base64")}`);
});
after(async () => { await mf?.dispose(); });

test("production serves the frontend and security headers without exposing local setup", async () => {
  const response = await mf.dispatchFetch("https://planner.example.org/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Date Night/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const session = await (await mf.dispatchFetch("http://localhost/api/session")).json();
  assert.equal(session.setupRequired, false, "Production entry overrides a mistakenly enabled local flag");
  const setup = await mf.dispatchFetch("http://localhost/api/auth/setup", {
    method: "POST", headers: { Origin: "https://planner.example.org", "Content-Type": "application/json" },
    body: JSON.stringify({ username: "must-not-be-created", password: "only-a-test-password-123" }),
  });
  assert.equal(setup.status, 403);
  assert.equal((await (await mf.getD1Database("DB")).prepare("SELECT COUNT(*) AS count FROM organisers").first()).count, 0);
});
test("production rejects cross-origin API writes and does not turn API failures into HTML", async () => {
  const response = await mf.dispatchFetch("https://planner.example.org/api/auth/login", {
    method: "POST", headers: { Origin: "https://elsewhere.example.org", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const missing = await mf.dispatchFetch("https://planner.example.org/api/does-not-exist");
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /application\/json/);
});
test("hosted reading uses only the independent reader secret and never forwards source credentials", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (target, init) => {
    assert.equal(target, "https://date-night-reader.onrender.com/fetch");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, readerKey);
    assert.deepEqual(JSON.parse(init.body), { url: "https://venue.example.org/", mode: "html" });
    assert.ok(!init.body.includes("application-auth-secret"));
    return new Response("<title>Venue</title>", { headers: { "Content-Type": "text/html" } });
  });
  const page = await imports.publicPage({
    WEB_READER_ORIGIN: "https://date-night-reader.onrender.com", WEB_READER_SECRET: readerKey, AUTH_SECRET: "application-auth-secret",
  }, "https://venue.example.org/", "html");
  assert.equal(await page.response.text(), "<title>Venue</title>");
  assert.equal(fetch.mock.callCount(), 1);
});
test("invalid hosted-reader origins and missing credentials fail before any network request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("No network request expected"); });
  for (const origin of [
    "http://date-night-reader.onrender.com", "https://localhost", "https://reader.onrender.com.evil.com",
    "https://reader.onrender.com/path", "https://reader.onrender.com?query=1",
    "https://username:password@reader.onrender.com", "https://reader.onrender.com:8443",
  ]) {
    await assert.rejects(imports.publicPage({ WEB_READER_ORIGIN: origin, WEB_READER_SECRET: readerKey }, "https://venue.example.org/", "html"),
      (error) => error.status === 503);
  }
  await assert.rejects(imports.publicPage({ WEB_READER_ORIGIN: "https://reader.onrender.com" }, "https://venue.example.org/", "html"),
    (error) => error.status === 503);
  assert.equal(fetch.mock.callCount(), 0);
});
test("hosted-reader authentication and throttling failures remain explicit", async (t) => {
  const env = { WEB_READER_ORIGIN: "https://reader.onrender.com", WEB_READER_SECRET: readerKey };
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  await assert.rejects(imports.publicPage(env, "https://venue.example.org/", "html"), (error) => error.status === 503);
  fetch.mock.mockImplementation(async () => Response.json({ error: "Website reading is busy." }, {
    status: 429, headers: { "X-Website-Reader-Error": "1" },
  }));
  await assert.rejects(imports.publicPage(env, "https://venue.example.org/", "html"), (error) => error.status === 429);
});
