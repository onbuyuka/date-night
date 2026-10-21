import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { imageSize } from "image-size";

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

test("both addresses publish identical link previews in their initial HTML without JavaScript", async () => {
  const app = await readFile(new URL("../index.html", import.meta.url), "utf8");
  function metadata(source) {
    const result = {};
    for (const match of source.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]+)"\s*\/?>/g)) {
      if (match[1] === "description" || /^(og:|twitter:)/.test(match[1])) {
        assert.equal(result[match[1]], undefined, `Duplicate preview field: ${match[1]}`);
        result[match[1]] = match[2];
      }
    }
    return result;
  }
  const preview = metadata(app);
  assert.deepEqual(metadata(html), preview);
  for (const key of ["description", "og:title", "og:description", "og:url", "og:image", "og:image:alt",
    "twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
    assert.ok(preview[key], `Missing preview field: ${key}`);
  }
  const title = app.match(/<title>([^<]+)<\/title>/)[1];
  assert.equal(html.match(/<title>([^<]+)<\/title>/)[1], title);
  assert.equal(preview["og:title"], title);
  assert.equal(preview["og:description"], preview.description);
  assert.equal(preview["twitter:title"], title);
  assert.equal(preview["twitter:description"], preview.description);
  assert.equal(preview["og:url"], "https://date-night.onbuyuka.workers.dev/");
  assert.equal(preview["og:image"], "https://date-night.onbuyuka.workers.dev/social-card.png");
  assert.equal(preview["twitter:image"], preview["og:image"]);
  assert.doesNotMatch(html, /has moved/i);
  const image = imageSize(await readFile(new URL("../public/social-card.png", import.meta.url)));
  assert.equal(image.type, "png");
  assert.equal(String(image.width), preview["og:image:width"]);
  assert.equal(String(image.height), preview["og:image:height"]);
  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
});
