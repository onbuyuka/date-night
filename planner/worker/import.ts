import { z } from "zod";
import type { WebsitePreview } from "../shared/model";
import { HttpError, readLimited } from "./support";

export interface ImportEnv {
  DB: D1Database;
  AUTH_SECRET?: string;
  LOCAL_DEV?: string;
  LOCAL_WEB_FETCH_ORIGIN?: string;
  WEB_READER_ORIGIN?: string;
  WEB_READER_SECRET?: string;
  PUBLIC_WEB?: Fetcher;
}
const userAgent = "DateNightVenuePlanner/0.1 (+https://github.com/onbuyuka/date-night)";
type Mode = "html" | "text" | "json" | "image";
const decoder = new TextDecoder();

export function websiteUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")
    || /(^|\.)(localhost|local|internal|home|lan|onion|invalid|test)$/.test(url.hostname)) {
    throw new HttpError(400, "Use the venue’s public HTTPS website.");
  }
  return url.href;
}
export function optionalWebsite(value: unknown, base?: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  let input = value.trim();
  if (!base && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$)/i.test(input)) input = `https://${input}`;
  try { return websiteUrl(input.replace(/^http:/i, "https:"), base); }
  catch (error) {
    if (error instanceof HttpError || error instanceof TypeError) return "";
    throw error;
  }
}

export async function publicPage(env: ImportEnv, value: string, mode: Mode,
  deadline = Date.now() + (env.WEB_READER_ORIGIN ? 110000 : 18000),
  beforeRequest?: (url: string) => Promise<void>) {
  let current = websiteUrl(value);
  for (let hop = 0; hop < 4; hop++) {
    if (deadline <= Date.now()) throw new HttpError(504, "The website took too long to respond. You can still fill in the details yourself.");
    if (beforeRequest) await beforeRequest(current);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new HttpError(504, "The website took too long to respond. You can still fill in the details yourself.");
    let response: Response;
    if (env.PUBLIC_WEB) {
      response = await env.PUBLIC_WEB.fetch(current, { redirect: "manual", headers: { "User-Agent": userAgent, "X-Import-Mode": mode },
        signal: AbortSignal.timeout(Math.min(10000, remaining)) });
    } else {
      const hosted = Boolean(env.WEB_READER_ORIGIN);
      const origin = hosted ? env.WEB_READER_ORIGIN : env.LOCAL_WEB_FETCH_ORIGIN;
      const credential = hosted ? env.WEB_READER_SECRET : env.AUTH_SECRET;
      if (!origin || !credential || (hosted ? credential.length < 32 : env.LOCAL_DEV !== "true")) {
        throw new HttpError(503, "Website reading is not available yet. You can still enter details and upload photos yourself.");
      }
      const bridge = new URL(origin);
      if (bridge.username || bridge.password || bridge.pathname !== "/" || bridge.search || bridge.hash
        || (hosted ? bridge.protocol !== "https:" || bridge.port !== "" || !/^[a-z0-9-]+\.onrender\.com$/.test(bridge.hostname)
          : bridge.protocol !== "http:" || bridge.hostname !== "127.0.0.1")) {
        throw new HttpError(503, "Website reading is not set up safely.");
      }
      try {
        response = await fetch(`${bridge.origin}/fetch`, {
          method: "POST", redirect: "manual", headers: { Authorization: credential, "Content-Type": "application/json" },
          body: JSON.stringify({ url: current, mode }), signal: AbortSignal.timeout(Math.min(hosted ? 90000 : 10000, remaining)),
        });
      } catch (error) {
        console.error("Venue reader connection failed", error instanceof Error ? error.name : "network error");
        throw new HttpError(502, "Website reading could not connect. Please try again later or enter the details yourself.");
      }
      if (hosted && response.status === 403) {
        await response.body?.cancel();
        console.error("Hosted website reader rejected its private credential.");
        throw new HttpError(503, "Website reading is not set up correctly. You can still enter details yourself.");
      }
      if (response.headers.get("X-Website-Reader-Error") === "1") {
        let failure: unknown;
        try { failure = JSON.parse(decoder.decode(await readLimited(response, 4000))); }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          throw new HttpError(502, "The website reader returned an unreadable error. Please try again later.");
        }
        const parsed = z.object({ error: z.string().min(1).max(1000) }).safeParse(failure);
        if (!parsed.success) throw new HttpError(502, "The website reader returned an unreadable error. Please try again later.");
        throw new HttpError(response.status === 429 ? 429 : 502, parsed.data.error);
      }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new HttpError(422, "This website returned an incomplete redirect.");
      current = websiteUrl(location, current);
      continue;
    }
    return { url: current, response };
  }
  throw new HttpError(422, "This website redirects too many times. Try a direct link.");
}
export async function cacheKey(prefix: string, value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `${prefix}:${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("")}`;
}
export async function cached<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare("SELECT payload FROM import_cache WHERE key=? AND expires_at>?").bind(key, Date.now()).first<{ payload: string }>();
  return row ? JSON.parse(row.payload) as T : null;
}
export async function store(db: D1Database, key: string, payload: unknown, milliseconds: number) {
  await db.prepare(`INSERT INTO import_cache (key,payload,expires_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`)
    .bind(key, JSON.stringify(payload), Date.now() + milliseconds).run();
}
function clean(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}
type JsonObject = Record<string, unknown>;
function objects(value: unknown, depth = 0): JsonObject[] {
  if (depth > 5 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.slice(0, 30).flatMap((item) => objects(item, depth + 1));
  const record = value as JsonObject;
  return [record, ...Object.values(record).slice(0, 30).flatMap((item) => objects(item, depth + 1))].slice(0, 150);
}
function addressText(value: unknown): string {
  if (typeof value === "string") return clean(value, 250);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = value as JsonObject;
  const country = typeof address.addressCountry === "object" && address.addressCountry
    ? (address.addressCountry as JsonObject).name : address.addressCountry;
  return [address.streetAddress, [address.postalCode, address.addressLocality].filter((part) => typeof part === "string").join(" "), country]
    .map((part) => clean(part, 150)).filter(Boolean).join(", ").slice(0, 250);
}
function imageValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.slice(0, 12).flatMap(imageValues);
  if (value && typeof value === "object") {
    const record = value as JsonObject;
    return typeof record.url === "string" ? [record.url] : typeof record.contentUrl === "string" ? [record.contentUrl] : [];
  }
  return [];
}
function robotAllows(text: string, path: string): boolean {
  let agents: string[] = [];
  let rulesStarted = false;
  const groups: { agents: string[]; allow: boolean; path: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (rulesStarted) { agents = []; rulesStarted = false; }
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length) {
      rulesStarted = true;
      if (value) groups.push({ agents: [...agents], allow: key === "allow", path: value });
    }
  }
  const specific = groups.some((group) => group.agents.some((agent) => agent !== "*" && "datenightvenueplanner".includes(agent)));
  let best = { length: -1, allow: true };
  for (const rule of groups) {
    const applies = rule.agents.some((agent) => specific ? agent !== "*" && "datenightvenueplanner".includes(agent) : agent === "*");
    if (!applies) continue;
    const escaped = rule.path.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    if (new RegExp(`^${escaped}`).test(path) && (rule.path.length > best.length || (rule.path.length === best.length && rule.allow))) {
      best = { length: rule.path.length, allow: rule.allow };
    }
  }
  return best.allow;
}

export async function websitePreview(env: ImportEnv, input: string, placeName: string): Promise<WebsitePreview> {
  const value = websiteUrl(input);
  const key = await cacheKey("website", `${value}|${placeName}`);
  const hit = await cached<WebsitePreview>(env.DB, key);
  if (hit) return hit;
  const deadline = Date.now() + (env.WEB_READER_ORIGIN ? 110000 : 22000);
  const rules = new Map<string, string>();
  const page = await publicPage(env, value, "html", deadline, async (current) => {
    const target = new URL(current);
    if (!rules.has(target.origin)) {
      const robots = await publicPage(env, `${target.origin}/robots.txt`, "text",
        Math.min(deadline, Date.now() + (env.WEB_READER_ORIGIN ? 95000 : 6000)));
      if (robots.response.ok) rules.set(target.origin, decoder.decode(await readLimited(robots.response, 64000)));
      else {
        await robots.response.body?.cancel();
        if (robots.response.status !== 404 && robots.response.status !== 410) throw new HttpError(422, "This website couldn’t be checked for automated reading. Add the details manually instead.");
        rules.set(target.origin, "");
      }
    }
    if (!robotAllows(rules.get(target.origin) ?? "", target.pathname + target.search)) {
      throw new HttpError(422, "This website doesn’t allow automated reading. Add the details manually instead.");
    }
  });
  if (!page.response.ok) {
    await page.response.body?.cancel();
    throw new HttpError(422, `The website couldn’t be read (status ${page.response.status}). You can still enter details yourself.`);
  }
  const type = page.response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new HttpError(422, "Use the venue’s website page, not a file.");
  const html = decoder.decode(await readLimited(page.response, 2000000));
  return extractWebsite(env, page.url, html, placeName, key);
}

export async function extractWebsite(env: ImportEnv, url: string, html: string, placeName: string, cache?: string): Promise<WebsitePreview> {
  const meta = new Map<string, string>();
  const scripts: { text: string }[] = [];
  const anchors: { href: string; text: string }[] = [];
  let script: { text: string } | null = null;
  let anchor: { href: string; text: string } | null = null;
  let title = "";
  await new HTMLRewriter()
    .on("meta", { element(element) {
      const key = (element.getAttribute("property") || element.getAttribute("name") || "").toLowerCase();
      const content = element.getAttribute("content");
      if (content && !meta.has(key)) meta.set(key, content.slice(0, 4000));
    } })
    .on("title", { text(chunk) { if (title.length < 500) title += chunk.text; } })
    .on('script[type="application/ld+json"]', {
      element() { script = { text: "" }; if (scripts.length < 20) scripts.push(script); },
      text(chunk) { if (script && script.text.length < 100000) script.text += chunk.text; },
    })
    .on("a[href]", {
      element(element) { anchor = { href: element.getAttribute("href") || "", text: "" }; if (anchors.length < 800) anchors.push(anchor); },
      text(chunk) { if (anchor && anchor.text.length < 100) anchor.text += chunk.text; },
    }).transform(new Response(html, { headers: { "Content-Type": "text/html" } })).arrayBuffer();
  const notices: string[] = [];
  const records: JsonObject[] = [];
  for (const script of scripts) {
    try { records.push(...objects(JSON.parse(script.text))); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; notices.push("Some website details couldn’t be read."); }
  }
  const businesses = records.filter((record) => {
    const type = Array.isArray(record["@type"]) ? record["@type"].join(" ") : String(record["@type"] || "");
    return /Restaurant|CafeOrCoffeeShop|BarOrPub|LocalBusiness|FoodEstablishment|Place|Hotel|EventVenue/.test(type);
  });
  const normal = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const business = businesses.find((record) => placeName && normal(String(record.name || "")).includes(normal(placeName))) || businesses[0];
  if (businesses.length > 1) notices.push("This website lists several places or branches. Check the address carefully.");
  const images = [...new Set([...imageValues(business?.image), meta.get("og:image"), meta.get("twitter:image")]
    .map((image) => optionalWebsite(image, url)).filter(Boolean))].slice(0, 6);
  const menus: WebsitePreview["menus"] = [];
  for (const value of imageValues(business?.hasMenu || business?.menu)) {
    const link = optionalWebsite(value, url);
    if (link) menus.push({ url: link, label: "Menu" });
  }
  for (const anchor of anchors) {
    if (!/\b(menu|menus|menukort|dinner|aftenmenu|food)\b/i.test(`${anchor.text} ${anchor.href}`)) continue;
    const link = optionalWebsite(anchor.href, url);
    if (link && !menus.some((menu) => menu.url === link)) menus.push({ url: link, label: clean(anchor.text, 60) || "Menu" });
    if (menus.length >= 6) break;
  }
  const robots = (meta.get("robots") || "").toLowerCase();
  const result: WebsitePreview = {
    url, name: clean(business?.name || meta.get("og:title") || title, 120),
    address: addressText(business?.address),
    description: robots.includes("nosnippet") ? "" : clean(business?.description || meta.get("og:description") || meta.get("description"), 400),
    images: robots.includes("noimageindex") ? [] : images,
    menus, notices: [...new Set(notices)],
  };
  if (!result.description && !result.address && !result.images.length && !result.menus.length) {
    result.notices.push("The website didn’t publish a description, address, menu or suitable photos in its page details.");
  }
  if (cache) await store(env.DB, cache, result, 3600000);
  return result;
}
