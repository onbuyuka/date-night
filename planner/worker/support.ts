export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter = 0) { super(message); }
}
export async function readLimited(request: Request | Response, maximum: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maximum) throw new HttpError(413, "This upload or request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new HttpError(413, "This upload or request is too large.");
    }
    chunks.push(next.value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function limit(db: D1Database, bucket: string, maximum: number, windowMs = 60000) {
  const now = Date.now();
  const result = await db.prepare(`INSERT INTO request_limits (bucket,count,window_end) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN window_end<=? THEN 1 ELSE count+1 END,
      window_end=CASE WHEN window_end<=? THEN ? ELSE window_end END RETURNING count,window_end`)
    .bind(bucket, now + windowMs, now, now, now + windowMs).first<{ count: number; window_end: number }>();
  if (result && result.count > maximum) {
    const seconds = Math.max(1, Math.ceil((result.window_end - now) / 1000));
    throw new HttpError(429, `Too many requests. Please try again in ${Math.ceil(seconds / 60)} minute(s).`, seconds);
  }
}
export function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
export function unhex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
}
