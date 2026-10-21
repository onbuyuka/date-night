import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../../redirect/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
function redirect(search = "", hash = "") {
  let destination;
  runInNewContext(script, { URL, window: { location: { search, hash, replace(value) { destination = value; } } } }, { timeout: 1000 });
  return destination;
}
test("the old address redirects directly to the live planner", () => {
  assert.equal(redirect(), "https://date-night.onbuyuka.workers.dev/");
});
test("planner invitation routes and query parameters survive the redirect", () => {
  const target = redirect("?source=bookmark", `#/invite/${"a".repeat(64)}`);
  const url = new URL(target);
  assert.equal(url.origin, "https://date-night.onbuyuka.workers.dev");
  assert.equal(url.search, "?source=bookmark");
  assert.equal(url.hash, `#/invite/${"a".repeat(64)}`);
});
test("legacy tab fragments are discarded and query strings cannot replace the destination host", () => {
  const url = new URL(redirect("?next=https://elsewhere.example.org", "#places"));
  assert.equal(url.origin, "https://date-night.onbuyuka.workers.dev");
  assert.equal(url.hash, "");
});
test("the redirect has an automatic no-script fallback and a clickable destination", () => {
  assert.match(html, /http-equiv="refresh" content="0; url=https:\/\/date-night\.onbuyuka\.workers\.dev\/"/);
  assert.match(html, /<a href="https:\/\/date-night\.onbuyuka\.workers\.dev\/">open Date Night<\/a>/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /rel="canonical" href="https:\/\/date-night\.onbuyuka\.workers\.dev\/"/);
});
