import { imageSize } from "image-size";
import { HttpError, readLimited } from "./support";

const maxImageBytes = 384 * 1024;
const maxWorkspaceBytes = 100 * 1024 * 1024;
const mediaPattern = /^\/api\/media\/([0-9a-f-]{36})$/;

export async function uploadImage(request: Request, db: D1Database, organiserId: string) {
  const bytes = await readLimited(request, maxImageBytes);
  let dimensions: ReturnType<typeof imageSize>;
  try { dimensions = imageSize(bytes); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new HttpError(400, "Choose a valid JPEG, PNG or WebP photo.");
  }
  const types: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
  const mime = types[dimensions.type ?? ""];
  if (!mime || request.headers.get("content-type")?.split(";")[0] !== mime) {
    throw new HttpError(400, "Only JPEG, PNG and WebP photos are supported.");
  }
  if (!dimensions.width || !dimensions.height || dimensions.width > 4096 || dimensions.height > 4096
    || dimensions.width * dimensions.height > 16000000) throw new HttpError(400, "This image is too large. Choose a smaller photo.");
  await db.prepare("DELETE FROM media WHERE event_id IS NULL AND created_at<? AND organiser_id=?")
    .bind(Date.now() - 86400000, organiserId).run();
  const id = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO media (id,event_id,mime,bytes,size,created_at,organiser_id)
      SELECT ?,NULL,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM media)+? <= ?
      AND EXISTS (SELECT 1 FROM organisers WHERE id=? AND active=1)`)
    .bind(id, mime, bytes.buffer, bytes.byteLength, Date.now(), organiserId,
      bytes.byteLength, maxWorkspaceBytes, organiserId).run();
  if (!inserted.meta.changes) throw new HttpError(507, "The photo library is full. Remove unused photos or events before uploading more.");
  return { url: `/api/media/${id}` };
}

export async function mediaBindings(db: D1Database, urls: string[], eventId: string, organiserId: string): Promise<D1PreparedStatement[]> {
  const ids = [...new Set(urls.map((url) => url.match(mediaPattern)?.[1]).filter((id): id is string => Boolean(id)))];
  const statements: D1PreparedStatement[] = [];
  for (const id of ids) {
    const media = await db.prepare(`SELECT event_id AS eventId FROM media WHERE id=? AND organiser_id=?
        AND EXISTS (SELECT 1 FROM organisers WHERE id=? AND active=1)`)
      .bind(id, organiserId, organiserId).first<{ eventId: string | null }>();
    if (!media || (media.eventId !== null && media.eventId !== eventId)) throw new HttpError(400, "One of these photos is missing or belongs to another event. Please upload it again.");
    statements.push(db.prepare(`UPDATE media SET event_id=? WHERE id=? AND organiser_id=?
        AND (event_id IS NULL OR event_id=?) AND EXISTS (
          SELECT 1 FROM events e JOIN organisers o ON o.id=e.organiser_id
          WHERE e.id=? AND e.organiser_id=? AND o.active=1)`)
      .bind(eventId, id, organiserId, eventId, eventId, organiserId));
  }
  return statements;
}
export async function pruneMedia(db: D1Database, eventId: string) {
  await db.prepare(`DELETE FROM media WHERE event_id=? AND
      NOT EXISTS (SELECT 1 FROM events e WHERE e.id=media.event_id AND e.cover_url='/api/media/'||media.id) AND
      NOT EXISTS (SELECT 1 FROM locations l, json_each(l.image_urls) image
        WHERE l.event_id=media.event_id AND image.value='/api/media/'||media.id)`).bind(eventId).run();
}
export async function serveImage(db: D1Database, id: string, organiserId: string | null, eventId: string | null) {
  const row = await db.prepare(`SELECT m.mime,m.bytes FROM media m
      JOIN organisers o ON o.id=m.organiser_id AND o.active=1
      WHERE m.id=? AND ((m.organiser_id=? AND (m.event_id IS NULL OR EXISTS (
        SELECT 1 FROM events e WHERE e.id=m.event_id AND e.organiser_id=m.organiser_id)))
      OR (m.event_id=? AND EXISTS (SELECT 1 FROM events e WHERE e.id=m.event_id
        AND e.organiser_id=m.organiser_id AND e.status!='draft')))`)
    .bind(id, organiserId, eventId).first<{ mime: string; bytes: number[] | ArrayBuffer }>();
  if (!row) throw new HttpError(404, "Photo not found.");
  const bytes = row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : Uint8Array.from(row.bytes);
  return new Response(bytes, { headers: {
    "Content-Type": row.mime, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
  } });
}
