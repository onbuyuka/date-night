import { z } from "zod";
import type { MapDetails, VenueCandidate, WebsiteCandidate, WebsiteSearch, WebsiteSearchInput } from "../shared/model";
import { cached, cacheKey, optionalWebsite, store, websiteUrl, type ImportEnv } from "./import";
import { HttpError, readLimited } from "./support";

export interface ProviderEnv extends ImportEnv {
  TOMTOM_API_KEY?: string;
  TAVILY_API_KEY?: string;
  LOOKUP_API?: Fetcher;
  LOCAL_LOOKUP_ORIGIN?: string;
}

type Provider = "tomtom" | "tavily";
interface LookupLock { provider: Provider; lockedUntil: number; apiKey: string }
const endpoints = {
  tomtom: "https://api.tomtom.com/maps/orbis/places/discover",
  tavily: "https://api.tavily.com/search",
} as const;
const budgets = { tomtom: 4500, tavily: 900 } as const;
const searchLabels = { tomtom: "Place search", tavily: "Website search" } as const;
const windowMs = 31 * 86400000;
const websiteCacheMs = 86400000;
const decoder = new TextDecoder();

const addressSchema = z.object({
  street: z.string().optional(), houseNumber: z.string().optional(), postalCode: z.string().optional(),
  municipalitySubdivision: z.string().optional(), municipality: z.string().optional(), country: z.string().optional(),
});
const positionSchema = z.object({
  coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
});
const tomtomResponse = z.object({
  results: z.array(z.object({
    type: z.string(),
    id: z.string().min(1).optional(), title: z.string().trim().min(1).optional(),
    address: addressSchema.optional(), position: positionSchema.optional(),
    contacts: z.array(z.object({ websites: z.array(z.string()).optional() })).optional(),
  }).superRefine((row, context) => {
    if (row.type === "poi" && (!row.id || !row.title || !row.position)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Incomplete place result." });
    }
  })).max(50),
});
const tavilyResponse = z.object({
  results: z.array(z.object({
    title: z.string(), url: z.string(), content: z.string().optional(),
  })).max(50),
});

function clip(value: string, maximum: number): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function publicWebsite(value: string): string {
  const url = new URL(websiteUrl(value));
  url.hostname = url.hostname.replace(/\.$/, "");
  return websiteUrl(url.href);
}

function transportUrl(env: ProviderEnv, provider: Provider): string {
  if (env.LOOKUP_API || !env.LOCAL_LOOKUP_ORIGIN) return endpoints[provider];
  try {
    const origin = new URL(env.LOCAL_LOOKUP_ORIGIN);
    if (env.LOCAL_DEV !== "true" || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1"
      || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
      || !/^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/.test(env.LOCAL_LOOKUP_ORIGIN)) {
      throw new Error("Invalid local lookup origin.");
    }
    return `${origin.origin}${new URL(endpoints[provider]).pathname}`;
  } catch {
    throw new HttpError(503, "Search is not set up correctly. You can still enter the details yourself.");
  }
}

async function withLookup<T>(env: ProviderEnv, provider: Provider, key: string, job: (lock: LookupLock) => Promise<T>): Promise<T> {
  const hit = await cached<T>(env.DB, key);
  if (hit !== null) return hit;
  const apiKey = (provider === "tomtom" ? env.TOMTOM_API_KEY : env.TAVILY_API_KEY)?.trim();
  if (!apiKey) throw new HttpError(503, `${searchLabels[provider]} is not set up yet. You can still enter the venue details yourself.`);
  transportUrl(env, provider);
  const now = Date.now();
  const lockedUntil = now + 40000;
  const acquired = await env.DB.prepare(`INSERT INTO import_locks (provider,next_at,locked_until) VALUES (?,?,?)
    ON CONFLICT(provider) DO UPDATE SET next_at=excluded.next_at,locked_until=excluded.locked_until
    WHERE import_locks.next_at<=? AND import_locks.locked_until<=? RETURNING provider`)
    .bind(provider, now, lockedUntil, now, now).first();
  if (!acquired) {
    const completed = await cached<T>(env.DB, key);
    if (completed !== null) return completed;
    const state = await env.DB.prepare("SELECT next_at,locked_until FROM import_locks WHERE provider=?")
      .bind(provider).first<{ next_at: number; locked_until: number }>();
    const delay = Math.max(1, Math.ceil((Math.max(state?.next_at ?? now, state?.locked_until ?? now) - now) / 1000));
    throw new HttpError(429, "This lookup service is busy or cooling down. Please wait before trying again.", delay);
  }
  try {
    const completed = await cached<T>(env.DB, key);
    return completed !== null ? completed : await job({ provider, lockedUntil, apiKey });
  } finally {
    await env.DB.prepare("UPDATE import_locks SET locked_until=0 WHERE provider=? AND locked_until=?")
      .bind(provider, lockedUntil).run();
  }
}

async function reserveAttempt(env: ProviderEnv, provider: Provider): Promise<void> {
  const now = Date.now();
  const cutoff = now - windowMs;
  await env.DB.prepare("DELETE FROM provider_usage WHERE requested_at<=?").bind(cutoff).run();
  const reserved = await env.DB.prepare(`INSERT INTO provider_usage (id,provider,requested_at)
    SELECT ?,?,? WHERE (SELECT COUNT(*) FROM provider_usage WHERE provider=? AND requested_at>?)<?
    RETURNING id`).bind(crypto.randomUUID(), provider, now, provider, cutoff, budgets[provider]).first();
  if (!reserved) {
    const oldest = await env.DB.prepare("SELECT MIN(requested_at) AS oldest FROM provider_usage WHERE provider=? AND requested_at>?")
      .bind(provider, cutoff).first<{ oldest: number | null }>();
    const delay = Math.max(1, Math.ceil(((oldest?.oldest ?? now) + windowMs - now) / 1000));
    throw new HttpError(429, `${searchLabels[provider]} has reached its current usage limit. Enter the details manually or try again when the limit resets.`, delay);
  }
}

function retryDelay(value: string | null): number {
  if (!value) return 60;
  const seconds = Number(value);
  const requested = Number.isFinite(seconds) ? seconds : (Date.parse(value) - Date.now()) / 1000;
  return Math.max(60, Number.isFinite(requested) ? Math.ceil(requested) : 60);
}

async function providerJson(env: ProviderEnv, lock: LookupLock, body: unknown): Promise<unknown> {
  const url = transportUrl(env, lock.provider);
  await reserveAttempt(env, lock.provider);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HttpError(504, "The lookup service took too long to respond. Try again later or enter the details yourself."));
    }, 12000);
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (lock.provider === "tomtom") {
    headers["TomTom-Api-Key"] = lock.apiKey;
    headers["TomTom-Api-Version"] = "3";
    headers.Attributes = "results.id,results.type,results.title,results.address,results.position,results.contacts.websites";
    headers["Session-Id"] = crypto.randomUUID();
  } else headers.Authorization = `Bearer ${lock.apiKey}`;
  try {
    return await Promise.race([timeout, (async () => {
      const init = { method: "POST", redirect: "manual" as const, headers, body: JSON.stringify(body), signal: controller.signal };
      const response = env.LOOKUP_API ? await env.LOOKUP_API.fetch(url, init) : await fetch(url, init);
      if (!response.ok) {
        const delay = retryDelay(response.headers.get("Retry-After"));
        if (response.status === 429 || response.status >= 500 || response.status === 401 || response.status === 403) {
          await env.DB.prepare("UPDATE import_locks SET next_at=? WHERE provider=? AND locked_until=?")
            .bind(Date.now() + delay * 1000, lock.provider, lock.lockedUntil).run();
        }
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) {
          console.error("Lookup authentication failed", lock.provider, response.status);
          throw new HttpError(503, `${searchLabels[lock.provider]} is not set up correctly. You can still enter the venue details yourself.`, delay);
        }
        throw new HttpError(response.status === 429 ? 429 : 502,
          "The lookup service is unavailable. Try again later or enter the venue details yourself.", delay);
      }
      try { return JSON.parse(decoder.decode(await readLimited(response, 240000))) as unknown; }
      catch (error) {
        if (controller.signal.aborted) throw error;
        throw new HttpError(502, "The lookup service returned an unreadable or oversized result. Please try again later.");
      }
    })()]);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (controller.signal.aborted) {
      throw new HttpError(504, "The lookup service took too long to respond. Try again later or enter the details yourself.");
    }
    throw new HttpError(502, "The lookup service could not connect. Try again later or enter the details yourself.");
  } finally {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function findVenues(env: ProviderEnv, map: MapDetails, name: string, area: string): Promise<VenueCandidate[]> {
  const searchName = name.trim() || map.name.trim();
  if (!searchName) throw new HttpError(400, "Enter the place name before searching.");
  const query = [searchName, area.trim() || map.address.trim()].filter(Boolean).join(", ");
  const hasPosition = map.longitude !== null && map.latitude !== null
    && Number.isFinite(map.longitude) && Number.isFinite(map.latitude)
    && Math.abs(map.longitude) <= 180 && Math.abs(map.latitude) <= 90;
  const geometry = hasPosition ? { type: "point", coordinates: [map.longitude, map.latitude] } : undefined;
  const body = { query, maxResults: 5, ...(geometry ? { origin: geometry, preferences: { geometry } } : {}) };
  const key = await cacheKey("tomtom", JSON.stringify(body));
  return withLookup(env, "tomtom", key, async (lock) => {
    const parsed = tomtomResponse.safeParse(await providerJson(env, lock, body));
    if (!parsed.success) throw new HttpError(502, "Place search returned an unreadable result. Please try again later.");
    const candidates: VenueCandidate[] = [];
    const ids = new Set<string>();
    for (const row of parsed.data.results) {
      if (row.type !== "poi" || !row.id || !row.title || !row.position || ids.has(row.id)) continue;
      ids.add(row.id);
      const address = row.address ?? {};
      const street = [address.street, address.houseNumber].filter(Boolean).join(" ");
      const city = [address.postalCode, address.municipality].filter(Boolean).join(" ");
      const subdivision = address.municipalitySubdivision !== address.municipality ? address.municipalitySubdivision : "";
      const websites = row.contacts?.flatMap((contact) => contact.websites ?? []) ?? [];
      let venueWebsite = "";
      for (const value of websites) {
        const normalized = optionalWebsite(value);
        if (!normalized) continue;
        try { venueWebsite = publicWebsite(normalized); break; }
        catch { console.warn("Discarded an unsafe place website."); }
      }
      candidates.push({
        id: row.id, name: clip(row.title, 120),
        address: clip([street, subdivision, city, address.country].filter(Boolean).join(", "), 250),
        latitude: row.position.coordinates[1], longitude: row.position.coordinates[0],
        websiteUrl: venueWebsite, osmUrl: "",
      });
      if (candidates.length === 5) break;
    }
    await store(env.DB, key, candidates, 3600000);
    return candidates;
  });
}

function knownDomain(value: string): string | null {
  if (!value.trim()) return null;
  try { return new URL(publicWebsite(value.trim())).hostname.replace(/^www\./, ""); }
  catch { throw new HttpError(400, "Use the venue’s public HTTPS website before searching within its domain."); }
}

async function websiteCandidates(env: ProviderEnv, lock: LookupLock, query: string, domain: string | null): Promise<WebsiteCandidate[]> {
  const parsed = tavilyResponse.safeParse(await providerJson(env, lock, {
    query, search_depth: "basic", max_results: 5,
    include_answer: false, include_raw_content: false, include_images: false,
    ...(domain ? { include_domains: [domain] } : {}),
  }));
  if (!parsed.success) throw new HttpError(502, "Website search returned an unreadable result. Please try again later.");
  const candidates: WebsiteCandidate[] = [];
  const urls = new Set<string>();
  for (const row of parsed.data.results) {
    let url: string;
    try { url = publicWebsite(row.url); }
    catch {
      console.warn("Discarded an unsafe website search result.");
      continue;
    }
    const host = new URL(url).hostname.replace(/\.$/, "");
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) {
      console.warn("Discarded an out-of-domain website search result.");
      continue;
    }
    if (urls.has(url)) continue;
    urls.add(url);
    candidates.push({ title: clip(row.title, 240), url, snippet: clip(row.content ?? "", 240) });
    if (candidates.length === 5) break;
  }
  return candidates;
}

export async function findWebsites(env: ProviderEnv, input: WebsiteSearchInput): Promise<WebsiteSearch> {
  const domain = knownDomain(input.websiteUrl);
  const query = [input.name.trim(), input.address.trim(), input.area.trim()].filter(Boolean).join(", ");
  if (!input.name.trim()) throw new HttpError(400, "Enter the place name before looking for a website.");
  const context = { query, domain };
  const key = await cacheKey("tavily", JSON.stringify({ ...context, broader: input.broader }));
  return withLookup(env, "tavily", key, async (lock) => {
    let constrainedDomain = input.broader ? null : domain;
    let candidates = await websiteCandidates(env, lock, query, constrainedDomain);
    let broadened = input.broader;
    if (constrainedDomain && !candidates.length) {
      const broadKey = await cacheKey("tavily", JSON.stringify({ ...context, broader: true }));
      const broadHit = await cached<WebsiteSearch>(env.DB, broadKey);
      if (broadHit !== null) {
        await store(env.DB, key, broadHit, websiteCacheMs);
        return broadHit;
      }
      candidates = await websiteCandidates(env, lock, query, null);
      constrainedDomain = null;
      broadened = true;
    }
    const result: WebsiteSearch = {
      domain: constrainedDomain, candidates, broadened,
      notices: [
        ...(broadened && domain ? ["No domain restriction was used for these wider search results."] : []),
        "These are unverified website suggestions, not confirmation of official ownership. Review a link before choosing to read it.",
        ...(!candidates.length ? ["No website suggestions were found. You can still enter a website or the venue details yourself."] : []),
      ],
    };
    await store(env.DB, key, result, websiteCacheMs);
    if (broadened && domain && !input.broader) {
      await store(env.DB, await cacheKey("tavily", JSON.stringify({ ...context, broader: true })), result, websiteCacheMs);
    }
    return result;
  });
}
