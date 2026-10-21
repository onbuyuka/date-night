import {
  eventSchema, invitationSchema, locationSchema, mapsSchema, participantSchema, venueSearchSchema, voteSchema, websiteImportSchema, websiteSearchSchema,
  type EventDetail, type EventLocation, type EventSummary, type Participant,
  type PlannerEvent, type Result, type Session,
} from "../shared/model";
import { z } from "zod";
import { HttpError, limit, readLimited } from "./support";
import { accountRoute, body, getSessions, hash, reply, requireAdmin, signIn, token, type StoredSession } from "./accounts";
import { resolveMapsLink } from "./maps";
import { mediaBindings, pruneMedia, serveImage, uploadImage } from "./media";
import { publicPage, websitePreview, websiteUrl } from "./import";
import { findVenues, findWebsites, type ProviderEnv } from "./providers";

interface Env extends ProviderEnv { APP_ORIGIN?: string }
interface LocationRow extends Omit<EventLocation, "imageUrls"> { imageUrls: string }
const eventFields = `id, organiser_id AS organiserId, title, description, city, date, occasion, theme, accent,
  cover_url AS coverUrl, mood, greeting, decorations, status, created_at AS createdAt, updated_at AS updatedAt`;
const locationFields = `id, event_id AS eventId, name, address, maps_url AS mapsUrl,
  menu_url AS menuUrl, description, note, image_urls AS imageUrls, position,
  latitude, longitude, place_id AS placeId, website_url AS websiteUrl, osm_url AS osmUrl`;

function localAdminAllowed(request: Request, env: Env): boolean {
  const host = new URL(request.url).hostname;
  return env.LOCAL_DEV === "true" && ["127.0.0.1", "localhost", "[::1]"].includes(host);
}

async function getEvent(env: Env, id: string): Promise<PlannerEvent> {
  const event = await env.DB.prepare(`SELECT ${eventFields} FROM events WHERE id=?
      AND EXISTS (SELECT 1 FROM organisers o WHERE o.id=events.organiser_id AND o.active=1)`)
    .bind(id).first<PlannerEvent>();
  if (!event) throw new HttpError(404, "This event could not be found.");
  return { ...event, decorations: Boolean(event.decorations) };
}
function requireAccess(session: StoredSession | null, event: PlannerEvent): asserts session is StoredSession {
  if (session?.role === "admin" && session.organiserId === event.organiserId) return;
  if (session?.role !== "participant" || session.eventId !== event.id || event.status === "draft") {
    throw new HttpError(403, "You need a personal invitation to view this event.");
  }
}
async function detail(env: Env, event: PlannerEvent, session: StoredSession): Promise<EventDetail> {
  const [locationRows, participantRows, resultRows, myRows] = await Promise.all([
    env.DB.prepare(`SELECT ${locationFields} FROM locations WHERE event_id = ? ORDER BY position, id`)
      .bind(event.id).all<LocationRow>(),
    env.DB.prepare(`SELECT p.id, p.event_id AS eventId, p.name,
        (p.invite_hash IS NOT NULL) AS invited, COUNT(r.location_id) AS ratedCount
        FROM participants p LEFT JOIN ratings r ON r.participant_id = p.id
        WHERE p.event_id = ? GROUP BY p.id ORDER BY p.created_at, p.name`)
      .bind(event.id).all<Omit<Participant, "invited"> & { invited: number }>(),
    env.DB.prepare(`SELECT l.id AS locationId, AVG(r.score) AS average, COUNT(r.score) AS count
        FROM locations l LEFT JOIN ratings r ON r.location_id = l.id
        WHERE l.event_id = ? GROUP BY l.id`)
      .bind(event.id).all<Result>(),
    env.DB.prepare(`SELECT r.location_id AS locationId, r.score FROM ratings r
        JOIN locations l ON l.id = r.location_id WHERE l.event_id = ? AND r.participant_id = ?`)
      .bind(event.id, session.participantId ?? "").all<{ locationId: string; score: number }>(),
  ]);
  const locations = locationRows.results.map((row) => ({
    ...row, imageUrls: z.array(z.string()).parse(JSON.parse(row.imageUrls)),
  }));
  return {
    event, locations,
    participants: session.role === "admin" ? participantRows.results.map((p) => ({ ...p, invited: Boolean(p.invited) })) : [],
    participantCount: participantRows.results.length,
    completedCount: locations.length ? participantRows.results.filter((p) => p.ratedCount === locations.length).length : 0,
    results: resultRows.results,
    myRatings: Object.fromEntries(myRows.results.map((r) => [r.locationId, r.score])),
    viewer: { role: session.role, participantId: session.participantId, name: session.name ?? "Organiser" },
  };
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  if (!["GET", "POST", "PUT", "DELETE"].includes(method)) throw new HttpError(405, "Method not allowed.");
  if (method !== "GET") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== (env.APP_ORIGIN ?? url.origin)) throw new HttpError(403, "This request must come from the planner.");
  }
  if (path === "/api/health" && method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    const authConfigured = Boolean(env.AUTH_SECRET && env.AUTH_SECRET.length >= 32);
    const placeSearchConfigured = Boolean(env.TOMTOM_API_KEY?.trim());
    const websiteSearchConfigured = Boolean(env.TAVILY_API_KEY?.trim());
    let websiteReaderReady = Boolean(env.PUBLIC_WEB || (env.WEB_READER_ORIGIN && env.WEB_READER_SECRET?.length
      && env.WEB_READER_SECRET.length >= 32));
    if (!websiteReaderReady && env.LOCAL_DEV === "true" && env.LOCAL_WEB_FETCH_ORIGIN) {
      const reader = new URL(env.LOCAL_WEB_FETCH_ORIGIN);
      if (reader.protocol === "http:" && reader.hostname === "127.0.0.1") {
        try { websiteReaderReady = (await fetch(`${reader.origin}/health`, { signal: AbortSignal.timeout(1500) })).ok; }
        catch (error) { console.warn("Local website reader is unavailable", error instanceof Error ? error.name : "connection error"); }
      }
    }
    return reply({
      ok: authConfigured, local: localAdminAllowed(request, env), authConfigured, websiteReaderReady,
      placeSearchConfigured, websiteSearchConfigured,
    }, authConfigured ? 200 : 503);
  }
  const publicAccountLink = /^\/api\/(?:organiser-invitations|password-resets)\/[^/]+$/.test(path);
  if ((method === "POST" && ["/api/auth/setup", "/api/auth/login", "/api/auth/logout",
    "/api/invitations/redeem", "/api/organiser-invitations/redeem", "/api/password-resets/redeem"].includes(path))
    || (method === "GET" && publicAccountLink)) {
    const source = localAdminAllowed(request, env) ? "loopback" : request.headers.get("cf-connecting-ip") ?? "unknown";
    const bucket = method === "GET" ? `account-links:${path.split("/")[2]}` : path;
    await limit(env.DB, `${bucket}:${await hash(source)}`, method === "GET" || path === "/api/invitations/redeem" ? 30 : 10, 900000);
  }
  const sessions = await getSessions(request, env);
  const session = sessions.organiser ?? sessions.guest;
  if (sessions.organiser && method !== "GET") {
    await limit(env.DB, `writes:organiser:${sessions.organiser.organiserId}`, 120);
  }
  if (path === "/api/session" && method === "GET") {
    const result: Session = {
      role: session?.role ?? null,
      setupRequired: localAdminAllowed(request, env) && !(await env.DB.prepare("SELECT id FROM organisers WHERE role='owner'").first()),
      ...(session?.organiserId ? { organiserId: session.organiserId, organiserRole: session.organiserRole ?? undefined } : {}),
      ...(session?.eventId ? { eventId: session.eventId } : {}),
      ...(session?.participantId ? { participantId: session.participantId } : {}),
      ...(session?.name ? { name: session.name } : {}),
    };
    return reply(result);
  }
  const accountResponse = await accountRoute(request, env, sessions.organiser, localAdminAllowed(request, env));
  if (accountResponse) return accountResponse;
  if (path === "/api/invitations/redeem" && method === "POST") {
    const input = await body(request, invitationSchema);
    const participant = await env.DB.prepare(`SELECT p.id, p.event_id AS eventId FROM participants p
        JOIN events e ON e.id = p.event_id JOIN organisers o ON o.id=e.organiser_id
        WHERE p.invite_hash = ? AND e.status != 'draft' AND o.active=1`)
      .bind(await hash(input.token)).first<{ id: string; eventId: string }>();
    if (!participant) throw new HttpError(404, "This invitation is invalid, revoked, or the event is still a draft. Ask the organiser for a new link.");
    return reply({ eventId: participant.eventId }, 200, {
      "Set-Cookie": await signIn(request, env, "participant", participant.id, await hash(input.token)),
    });
  }
  if (path === "/api/maps/resolve" && method === "POST") {
    requireAdmin(session);
    await limit(env.DB, `maps:organiser:${session.organiserId}`, 20);
    return reply(await resolveMapsLink((await body(request, mapsSchema)).url));
  }
  if (path === "/api/places/search" && method === "POST") {
    requireAdmin(session);
    await limit(env.DB, `venue-search:organiser:${session.organiserId}`, 20);
    const input = await body(request, venueSearchSchema);
    const map = await resolveMapsLink(input.mapsUrl);
    const candidates = await findVenues(env, map, input.name, input.area);
    return reply({
      map, candidates,
      notices: candidates.length ? ["Select the correct place and branch before using its details."]
        : ["No matching places were found. You can still add a website or enter the details yourself."],
    });
  }
  if (path === "/api/places/websites" && method === "POST") {
    requireAdmin(session);
    await limit(env.DB, `website-search:organiser:${session.organiserId}`, 20);
    return reply(await findWebsites(env, await body(request, websiteSearchSchema)));
  }
  if (path === "/api/places/website" && method === "POST") {
    requireAdmin(session);
    await limit(env.DB, `website-import:organiser:${session.organiserId}`, 20);
    const input = await body(request, websiteImportSchema);
    return reply(await websitePreview(env, input.url, input.placeName));
  }
  if (path === "/api/places/photo" && method === "GET") {
    requireAdmin(session);
    await limit(env.DB, `website-photos:organiser:${session.organiserId}`, 90);
    const input = websiteImportSchema.safeParse({ url: url.searchParams.get("url") });
    if (!input.success) throw new HttpError(400, "Choose a valid website photo.");
    const page = await publicPage(env, websiteUrl(input.data.url), "image");
    if (!page.response.ok) {
      await page.response.body?.cancel();
      throw new HttpError(422, "This photo could not be read. Upload your own photo instead.");
    }
    const mime = page.response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new HttpError(422, "This is not a supported photo.");
    return new Response(await readLimited(page.response, 2000000), { headers: {
      "Content-Type": mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'", "Referrer-Policy": "no-referrer",
    } });
  }
  if (path === "/api/media" && method === "POST") {
    requireAdmin(session);
    await limit(env.DB, `media:organiser:${session.organiserId}`, 20);
    return reply(await uploadImage(request, env.DB, session.organiserId), 201);
  }
  const imageMatch = path.match(/^\/api\/media\/([0-9a-f-]{36})$/);
  if (imageMatch && method === "GET") {
    if (!session) throw new HttpError(403, "Sign in or open your invitation to view this photo.");
    return serveImage(env.DB, imageMatch[1], sessions.organiser?.organiserId ?? null, sessions.guest?.eventId ?? null);
  }
  if (path === "/api/events") {
    requireAdmin(session);
    if (method === "GET") {
      const rows = await env.DB.prepare(`SELECT ${eventFields},
          (SELECT COUNT(*) FROM locations l WHERE l.event_id = events.id) AS locationCount,
          (SELECT COUNT(*) FROM participants p WHERE p.event_id = events.id) AS participantCount,
          (SELECT COUNT(DISTINCT r.participant_id) FROM ratings r
            JOIN participants p ON p.id = r.participant_id WHERE p.event_id = events.id) AS ratedParticipantCount
          FROM events WHERE organiser_id=? ORDER BY created_at DESC, id DESC`).bind(session.organiserId).all<EventSummary>();
      return reply(rows.results.map((event) => ({ ...event, decorations: Boolean(event.decorations) })));
    }
    if (method === "POST") {
      const input = await body(request, eventSchema);
      if (input.status !== "draft") throw new HttpError(400, "Create a draft first, then add locations and people before opening voting.");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const media = await mediaBindings(env.DB, [input.coverUrl], id, session.organiserId);
      await env.DB.batch([env.DB.prepare(`INSERT INTO events
          (id,title,description,date,occasion,theme,accent,cover_url,status,created_at,updated_at,mood,greeting,decorations,city,organiser_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, input.title, input.description, input.date, input.occasion, input.theme,
          input.accent, input.coverUrl, input.status, now, now, input.mood, input.greeting, input.decorations ? 1 : 0, input.city, session.organiserId), ...media]);
      return reply(await getEvent(env, id), 201);
    }
  }
  const match = path.match(/^\/api\/events\/([^/]+)(?:\/(locations|participants|ratings)(?:\/([^/]+))?(?:\/(invitation))?)?$/);
  if (!match) throw new HttpError(404, "This API route does not exist.");
  const [, eventId, resource, resourceId, action] = match;
  const event = await getEvent(env, eventId);
  const eventSession = sessions.organiser?.organiserId === event.organiserId ? sessions.organiser : sessions.guest;
  requireAccess(eventSession, event);
  if (!resource) {
    if (method === "GET") return reply(await detail(env, event, eventSession));
    requireAdmin(eventSession);
    if (method === "PUT") {
      const input = await body(request, eventSchema);
      if (input.status === "open") {
        const counts = await env.DB.prepare(`SELECT
            (SELECT COUNT(*) FROM locations WHERE event_id = ?) AS places,
            (SELECT COUNT(*) FROM participants WHERE event_id = ?) AS people`)
          .bind(eventId, eventId).first<{ places: number; people: number }>();
        if (!counts?.places || !counts.people) throw new HttpError(400, "Add at least one location and one participant before opening voting.");
      }
      const media = await mediaBindings(env.DB, [input.coverUrl], eventId, eventSession.organiserId);
      await env.DB.batch([env.DB.prepare(`UPDATE events SET title=?,description=?,date=?,occasion=?,theme=?,
          accent=?,cover_url=?,status=?,updated_at=?,mood=?,greeting=?,decorations=?,city=? WHERE id=? AND organiser_id=?`)
        .bind(input.title, input.description, input.date, input.occasion, input.theme, input.accent,
          input.coverUrl, input.status, new Date().toISOString(), input.mood, input.greeting, input.decorations ? 1 : 0, input.city, eventId, eventSession.organiserId), ...media]);
      await pruneMedia(env.DB, eventId);
      return reply(await getEvent(env, eventId));
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM events WHERE id=? AND organiser_id=?").bind(eventId, eventSession.organiserId).run();
      return reply({ ok: true });
    }
  }
  if (resource === "ratings" && resourceId && method === "PUT" && !action) {
    if (eventSession.role !== "participant" || !eventSession.participantId) throw new HttpError(403, "Use your personal invitation to rate places. The organiser preview cannot vote.");
    await limit(env.DB, `ratings:${eventSession.participantId}`, 120);
    if (event.status !== "open") throw new HttpError(409, "Voting is closed. Your saved ratings are still here.");
    const location = await env.DB.prepare("SELECT id FROM locations WHERE id=? AND event_id=?").bind(resourceId, eventId).first();
    if (!location) throw new HttpError(404, "This location is not part of the event.");
    const input = await body(request, voteSchema);
    if (input.score === null) {
      await env.DB.prepare(`DELETE FROM ratings WHERE participant_id=? AND location_id=?
          AND EXISTS (SELECT 1 FROM events e JOIN organisers o ON o.id=e.organiser_id
            WHERE e.id=? AND e.status='open' AND o.active=1)`)
        .bind(eventSession.participantId, resourceId, eventId).run();
      if ((await getEvent(env, eventId)).status !== "open") throw new HttpError(409, "Voting just closed. Refresh to see the final results.");
    } else {
      const result = await env.DB.prepare(`INSERT INTO ratings (participant_id,location_id,score,updated_at)
          SELECT ?,?,?,? FROM events e JOIN organisers o ON o.id=e.organiser_id
          WHERE e.id=? AND e.status='open' AND o.active=1
          ON CONFLICT(participant_id,location_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at`)
        .bind(eventSession.participantId, resourceId, input.score, new Date().toISOString(), eventId).run();
      if (!result.meta.changes) throw new HttpError(409, "Voting just closed. Refresh to see the final results.");
    }
    return reply({ ok: true });
  }
  requireAdmin(eventSession);
  if (resource === "locations" && !action) {
    if (resourceId) {
      const exists = await env.DB.prepare("SELECT id FROM locations WHERE id=? AND event_id=?").bind(resourceId, eventId).first();
      if (!exists) throw new HttpError(404, "Location not found.");
    }
    if (method === "POST" && !resourceId) {
      const input = await body(request, locationSchema);
      const id = crypto.randomUUID();
      const media = await mediaBindings(env.DB, input.imageUrls, eventId, eventSession.organiserId);
      const position = await env.DB.prepare("SELECT COALESCE(MAX(position),-1)+1 AS next FROM locations WHERE event_id=?")
        .bind(eventId).first<{ next: number }>();
      await env.DB.batch([env.DB.prepare(`INSERT INTO locations
          (id,event_id,name,address,maps_url,menu_url,description,note,image_urls,position,latitude,longitude,place_id,website_url,osm_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, eventId, input.name, input.address, input.mapsUrl, input.menuUrl, input.description,
          input.note, JSON.stringify(input.imageUrls), position?.next ?? 0, input.latitude, input.longitude, input.placeId, input.websiteUrl, input.osmUrl), ...media]);
      return reply({ id }, 201);
    }
    if (method === "PUT" && resourceId) {
      const input = await body(request, locationSchema);
      const media = await mediaBindings(env.DB, input.imageUrls, eventId, eventSession.organiserId);
      await env.DB.batch([env.DB.prepare(`UPDATE locations SET name=?,address=?,maps_url=?,menu_url=?,description=?,note=?,image_urls=?,latitude=?,longitude=?,place_id=?,website_url=?,osm_url=?
          WHERE id=? AND event_id=?`).bind(input.name, input.address, input.mapsUrl, input.menuUrl,
          input.description, input.note, JSON.stringify(input.imageUrls), input.latitude, input.longitude, input.placeId, input.websiteUrl, input.osmUrl, resourceId, eventId), ...media]);
      await pruneMedia(env.DB, eventId);
      return reply({ ok: true });
    }
    if (method === "DELETE" && resourceId) {
      await env.DB.prepare("DELETE FROM locations WHERE id=? AND event_id=?").bind(resourceId, eventId).run();
      await pruneMedia(env.DB, eventId);
      return reply({ ok: true });
    }
  }
  if (resource === "participants") {
    if (method === "POST" && !resourceId) {
      const input = await body(request, participantSchema);
      const id = crypto.randomUUID();
      const inviteToken = token();
      const inserted = await env.DB.prepare("INSERT INTO participants (id,event_id,name,invite_hash,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING")
        .bind(id, eventId, input.name, await hash(inviteToken), new Date().toISOString()).run();
      if (!inserted.meta.changes) throw new HttpError(409, "Someone with that name is already on this event.");
      return reply({ id, inviteToken, name: input.name }, 201);
    }
    if (resourceId) {
      const participant = await env.DB.prepare("SELECT id FROM participants WHERE id=? AND event_id=?").bind(resourceId, eventId).first();
      if (!participant) throw new HttpError(404, "Participant not found.");
      if (action === "invitation" && (method === "POST" || method === "DELETE")) {
        const inviteToken = method === "POST" ? token() : null;
        await env.DB.batch([
          env.DB.prepare("UPDATE participants SET invite_hash=? WHERE id=?")
            .bind(inviteToken ? await hash(inviteToken) : null, resourceId),
          env.DB.prepare("DELETE FROM sessions WHERE participant_id=?").bind(resourceId),
        ]);
        return reply({ inviteToken });
      }
      if (!action && method === "DELETE") {
        await env.DB.prepare("DELETE FROM participants WHERE id=? AND event_id=?").bind(resourceId, eventId).run();
        return reply({ ok: true });
      }
    }
  }
  throw new HttpError(405, "This action is not supported.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) return reply({ error: error.message }, error.status,
        error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined);
      console.error("Planner API failure", error);
      return reply({ error: "The planner could not complete this request. Please try again." }, 500);
    }
  },
};
