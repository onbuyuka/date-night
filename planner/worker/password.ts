import { HttpError, hex, unhex } from "./support";

const iterations = 100000;
const encoder = new TextEncoder();
interface PasswordRecord { salt: string; verifier: string; iterations: number }

async function pepperKey(secret?: string) {
  if (!secret || secret.length < 32) throw new HttpError(503, "Authentication is not configured. Run npm run setup:local, then restart the local servers.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function derive(password: string, salt: string, rounds: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(salt), iterations: rounds }, key, 256);
}
export async function createPassword(password: string, secret?: string): Promise<PasswordRecord> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(24)).buffer);
  const derived = await derive(password, salt, iterations);
  // Workers cap PBKDF2 at 100k iterations. A separate server-side pepper protects the stored verifier.
  const verifier = hex(await crypto.subtle.sign("HMAC", await pepperKey(secret), derived));
  return { salt, verifier, iterations };
}
export async function verifyPassword(password: string, record: PasswordRecord, secret?: string) {
  const derived = await derive(password, record.salt, record.iterations);
  return crypto.subtle.verify("HMAC", await pepperKey(secret), unhex(record.verifier), derived);
}
