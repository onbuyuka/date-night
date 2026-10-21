import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { pathToFileURL } from "node:url";

export function isPublicAddress(value) {
  if (isIP(value) === 4) {
    const [a, b, c] = value.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(value) !== 6) return false;
  const canonical = new URL(`https://[${value}]/`).hostname.slice(1, -1);
  const [first, second] = canonical.split(":").map((part) => parseInt(part || "0", 16));
  return (first & 0xe000) === 0x2000 && first !== 0x2002 && first !== 0x3fff
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}
export function publicUrl(value) {
  const url = new URL(value);
  url.hostname = url.hostname.replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".")
    || /(^|\.)(localhost|local|internal|invalid|test|example|home|lan|onion)$/.test(url.hostname)) {
    throw new Error("Only public HTTPS websites can be imported.");
  }
  return url;
}
export function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
      const denied = new Error("Private or reserved network addresses are not allowed.");
      denied.code = "PUBLIC_ONLY";
      return callback(denied);
    }
    // This callback supplies the checked addresses to the actual TLS connection.
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}
const limits = { html: 2000000, text: 64000, json: 240000, image: 2000000 };
const accepts = {
  html: "text/html, application/xhtml+xml", text: "text/plain", json: "application/json",
  image: "image/jpeg, image/png, image/webp",
};
const agent = "DateNightVenuePlanner/0.1 (+https://github.com/onbuyuka/date-night)";

export async function fetchPublic(value, mode, signal) {
  const url = publicUrl(value);
  if (!Object.hasOwn(limits, mode)) throw new Error("Unsupported import type.");
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(url, {
      method: "GET", lookup: publicLookup, agent: false, rejectUnauthorized: true,
      signal, headers: { "User-Agent": agent, Accept: accepts[mode], "Accept-Language": "en", "Accept-Encoding": "identity" },
    }, async (response) => {
      try {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.destroy();
          resolve({ status, headers: location ? { location } : {}, body: Buffer.alloc(0) });
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          const retry = response.headers["retry-after"];
          resolve({ status, headers: retry ? { "retry-after": String(retry).slice(0, 100) } : {}, body: Buffer.alloc(0) });
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        const allowed = mode === "html" ? ["text/html", "application/xhtml+xml"]
          : mode === "image" ? ["image/jpeg", "image/png", "image/webp"]
          : mode === "json" ? ["application/json"] : ["text/plain", "text/html"];
        if (!allowed.includes(contentType)) throw new Error("This link did not return the expected content.");
        let stream = response;
        const encoding = response.headers["content-encoding"];
        if (encoding === "gzip") stream = response.pipe(createGunzip());
        else if (encoding === "br") stream = response.pipe(createBrotliDecompress());
        else if (encoding === "deflate") stream = response.pipe(createInflate());
        else if (encoding && encoding !== "identity") throw new Error("Unsupported website response encoding.");
        const chunks = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > limits[mode]) throw new Error("This page or photo is too large to import.");
          chunks.push(chunk);
        }
        resolve({ status, headers: { "content-type": contentType }, body: Buffer.concat(chunks) });
      } catch (error) { response.destroy(); outgoing.destroy(); reject(error); }
    });
    outgoing.setTimeout(8000, () => outgoing.destroy(new Error("The website took too long to respond.")));
    outgoing.once("error", reject);
    outgoing.end();
  });
}

export function readerServer(secret, fetcher = fetchPublic) {
  if (typeof secret !== "string" || secret.trim().length < 32) throw new Error("A private website-reader credential is required.");
  const expected = createHash("sha256").update(secret).digest();
  let active = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
      return;
    }
    const actual = createHash("sha256").update(request.headers.authorization ?? "").digest();
    if (request.method !== "POST" || request.url !== "/fetch" || !timingSafeEqual(actual, expected)) {
      response.writeHead(403).end();
      return;
    }
    if (active >= 3) {
      response.writeHead(429, { "Retry-After": "5", "Content-Type": "application/json", "X-Website-Reader-Error": "1" })
        .end(JSON.stringify({ error: "Website reading is busy. Wait a moment before trying again." }));
      return;
    }
    active++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    response.once("close", () => controller.abort());
    try {
      let input = "";
      for await (const chunk of request) {
        input += chunk.toString("utf8");
        if (input.length > 6000) throw new Error("Import request is too large.");
      }
      const data = JSON.parse(input);
      if (!data || typeof data !== "object" || typeof data.url !== "string"
        || typeof data.mode !== "string" || !Object.hasOwn(limits, data.mode)) throw new Error("Choose a valid website import request.");
      publicUrl(data.url);
      const result = await fetcher(data.url, data.mode, controller.signal);
      response.writeHead(result.status, { ...result.headers, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(result.body);
    } catch (error) {
      console.error("Public website import failed:", error instanceof Error ? error.message : "request error");
      if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json", "X-Website-Reader-Error": "1" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not read this website." }));
    } finally { active--; clearTimeout(timeout); }
  });
  server.requestTimeout = 12000;
  server.headersTimeout = 10000;
  return server;
}

async function start() {
  const hosted = Boolean(process.env.PORT);
  let secret = process.env.WEB_READER_SECRET;
  if (!secret && !hosted) {
    const config = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
    secret = config.match(/^AUTH_SECRET=(.+)$/m)?.[1].trim();
  }
  const port = Number(process.env.PORT || process.env.WEB_FETCH_PORT || "8791");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The website-reader port is invalid.");
  const host = hosted ? "0.0.0.0" : "127.0.0.1";
  const server = readerServer(secret);
  server.listen(port, host, () => console.log(`Public website reader ready on ${host}:${port}`));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await start();
