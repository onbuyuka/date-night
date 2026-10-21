import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readerServer, publicUrl, publicLookup } from "../scripts/public-web.mjs";

const secret = "test-only-private-reader-credential-123456789";
let server;
let origin;
let calls = [];
let release;
before(async () => {
  server = readerServer(secret, async (url, mode) => {
    calls.push({ url, mode });
    if (url.endsWith("/wait")) await new Promise((resolve) => { release = resolve; });
    if (url.endsWith("/failure")) throw new Error("This page or photo is too large to import.");
    if (url.endsWith("/redirect")) return { status: 302, headers: { location: "https://venue.example.org/current" }, body: Buffer.alloc(0) };
    return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<title>A venue</title>") };
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  release?.();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
function call(input, credential = secret, options = {}) {
  return fetch(`${origin}/fetch`, {
    method: "POST", headers: { Authorization: credential, "Content-Type": "application/json" },
    body: typeof input === "string" ? input : JSON.stringify(input), redirect: "manual", ...options,
  });
}
test("the hosted reader needs a separate private credential and exposes no secrets in health", async () => {
  assert.throws(() => readerServer(""), /credential/);
  const health = await fetch(`${origin}/health`);
  assert.deepEqual(await health.json(), { ok: true });
  const count = calls.length;
  const denied = await call({ url: "https://venue.example.org/", mode: "html" }, "incorrect");
  assert.equal(denied.status, 403);
  assert.equal(calls.length, count);
});
test("authenticated website reading returns only content and safe response headers", async () => {
  const response = await call({ url: "https://venue.example.org/", mode: "html" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "<title>A venue</title>");
  assert.deepEqual(calls.at(-1), { url: "https://venue.example.org/", mode: "html" });
});
test("private, non-HTTPS and malformed requests never reach the website fetcher", async () => {
  const count = calls.length;
  for (const input of [
    { url: "https://127.0.0.1/", mode: "html" },
    { url: "https://host.local./", mode: "html" },
    { url: "https://service.internal/", mode: "html" },
    { url: "http://venue.example.org/", mode: "html" },
    { url: "https://venue.example.org/", mode: "unsupported" },
    { url: 123, mode: "html" }, null, "invalid-json", " ".repeat(6001),
  ]) {
    const response = await call(input);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("x-website-reader-error"), "1");
    assert.ok((await response.json()).error);
  }
  assert.equal(calls.length, count);
  assert.throws(() => publicUrl("https://localhost./"), /public HTTPS/);
  const error = await new Promise((resolve) => publicLookup("localhost", { all: true }, (failure) => resolve(failure)));
  assert.equal(error.code, "PUBLIC_ONLY");
});
test("redirects remain explicit so every new destination is checked by the app", async () => {
  const response = await call({ url: "https://venue.example.org/redirect", mode: "html" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://venue.example.org/current");
  assert.equal(await response.text(), "");
});
test("reader failures stay explicit without exposing the private credential", async () => {
  const response = await call({ url: "https://venue.example.org/failure", mode: "html" });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.match(body.error, /too large/);
  assert.ok(!JSON.stringify(body).includes(secret));
});
test("concurrent website requests are bounded and recover after one finishes", async () => {
  const waiting = [call({ url: "https://venue.example.org/wait", mode: "html" })];
  while (calls.at(-1)?.url !== "https://venue.example.org/wait") await new Promise((resolve) => setTimeout(resolve, 5));
  const firstRelease = release;
  waiting.push(call({ url: "https://venue.example.org/wait", mode: "html" }));
  while (release === firstRelease) await new Promise((resolve) => setTimeout(resolve, 5));
  const secondRelease = release;
  waiting.push(call({ url: "https://venue.example.org/wait", mode: "html" }));
  while (release === secondRelease) await new Promise((resolve) => setTimeout(resolve, 5));
  const thirdRelease = release;
  try {
    const busy = await call({ url: "https://venue.example.org/", mode: "html" });
    assert.equal(busy.status, 429);
    assert.equal(busy.headers.get("retry-after"), "5");
    assert.match((await busy.json()).error, /busy/);
  } finally { firstRelease(); secondRelease(); thirdRelease(); }
  for (const response of await Promise.all(waiting)) {
    assert.equal(response.status, 200);
    await response.text();
  }
  assert.equal((await call({ url: "https://venue.example.org/", mode: "html" })).status, 200);
});
