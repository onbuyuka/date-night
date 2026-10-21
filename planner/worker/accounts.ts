import { z } from "zod";
import {
  credentialsSchema, organiserAccessSchema, organiserInvitationSchema, organiserRegistrationSchema,
  passwordChangeSchema, passwordResetSchema,
  type OrganiserAccount, type OrganiserDirectory, type OrganiserRole,
} from "../shared/model";
import { createPassword, verifyPassword } from "./password";
import { HttpError, readLimited } from "./support";

export interface AccountEnv { DB: D1Database; AUTH_SECRET?: string }
export interface StoredSession {
  role: "admin" | "participant";
  participantId: string | null;
  eventId: string | null;
  name: string | null;
  organiserId: string | null;
  organiserRole: OrganiserRole | null;
}
interface PasswordAccount {
  id: string; username: string; salt: string; verifier: string; iterations: number;
}
interface AccountInvitation {
  id: string; kind: "owner" | "organiser" | "reset"; name: string;
  expiresAt: number; targetOrganiserId: string | null; username: string | null;
}
export const organiserCookieName = "date_night_session";
export const guestCookieName = "date_night_guest";
const invitationValid = `i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
  AND ((i.kind='owner' AND NOT EXISTS (SELECT 1 FROM organisers WHERE role='owner'))
    OR (i.kind='organiser' AND EXISTS (SELECT 1 FROM organisers issuer
      WHERE issuer.id=i.created_by AND issuer.role='owner' AND issuer.active=1))
    OR (i.kind='reset' AND EXISTS (SELECT 1 FROM organisers target
      WHERE target.id=i.target_organiser_id AND target.active=1)
      AND (i.created_by IS NULL OR EXISTS (SELECT 1 FROM organisers issuer
        WHERE issuer.id=i.created_by AND issuer.role='owner' AND issuer.active=1))))`;

export function reply(body: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json");
  result.set("Cache-Control", "no-store");
  result.set("X-Content-Type-Options", "nosniff");
  result.set("Referrer-Policy", "no-referrer");
  return new Response(JSON.stringify(body), { status, headers: result });
}
export async function body<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Send JSON data.");
  const text = new TextDecoder().decode(await readLimited(request, 40000));
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (error) {
    if (error instanceof SyntaxError) throw new HttpError(400, "The request contains invalid JSON.");
    throw error;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Check the form fields.");
  return result.data;
}
export function token(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2, "0")).join("");
}
export async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}
export function cookieToken(request: Request, name = organiserCookieName): string | null {
  return request.headers.get("cookie")?.split(";").map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}
export function sessionCookie(request: Request, value: string, maxAge: number, name = organiserCookieName): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
async function getSession(request: Request, env: AccountEnv, name: string): Promise<StoredSession | null> {
  const value = cookieToken(request, name);
  if (!value || !/^[0-9a-f]{64}$/.test(value)) return null;
  return env.DB.prepare(`SELECT s.role, s.participant_id AS participantId,
      p.event_id AS eventId, CASE WHEN s.role='admin' THEN o.username ELSE p.name END AS name,
      CASE WHEN s.role='admin' THEN o.id END AS organiserId,
      CASE WHEN s.role='admin' THEN o.role END AS organiserRole
      FROM sessions s LEFT JOIN participants p ON p.id=s.participant_id
      LEFT JOIN organisers o ON o.id=s.organiser_id
      WHERE s.token_hash=? AND s.expires_at>? AND
        ((s.role='admin' AND o.active=1 AND s.participant_id IS NULL) OR
         (s.role='participant' AND p.invite_hash IS NOT NULL AND EXISTS (
           SELECT 1 FROM events e JOIN organisers owner ON owner.id=e.organiser_id
           WHERE e.id=p.event_id AND owner.active=1 AND e.status!='draft')))`)
    .bind(await hash(value), Date.now()).first<StoredSession>();
}
export async function getSessions(request: Request, env: AccountEnv) {
  const [primary, secondary] = await Promise.all([
    getSession(request, env, organiserCookieName), getSession(request, env, guestCookieName),
  ]);
  return {
    organiser: primary?.role === "admin" ? primary : null,
    guest: secondary?.role === "participant" ? secondary : primary?.role === "participant" ? primary : null,
  };
}
export async function signIn(
  request: Request, env: AccountEnv, role: "admin" | "participant", id: string, proof: string,
): Promise<string> {
  const value = token();
  const age = role === "admin" ? 86400 : 604800;
  const statement = role === "admin"
    ? env.DB.prepare(`INSERT INTO sessions (token_hash,role,participant_id,organiser_id,expires_at)
        SELECT ?,'admin',NULL,id,? FROM organisers WHERE id=? AND active=1 AND verifier=?`)
    : env.DB.prepare(`INSERT INTO sessions (token_hash,role,participant_id,organiser_id,expires_at)
        SELECT ?,'participant',p.id,NULL,? FROM participants p JOIN events e ON e.id=p.event_id
        JOIN organisers o ON o.id=e.organiser_id
        WHERE p.id=? AND p.invite_hash=? AND e.status!='draft' AND o.active=1`);
  const result = await statement.bind(await hash(value), Date.now() + age * 1000, id, proof).run();
  if (!result.meta.changes) throw new HttpError(403, "This account or invitation is no longer available.");
  return sessionCookie(request, value, age, role === "admin" ? organiserCookieName : guestCookieName);
}
export function requireAdmin(session: StoredSession | null): asserts session is StoredSession & { organiserId: string } {
  if (session?.role !== "admin" || !session.organiserId) throw new HttpError(403, "Only a signed-in organiser can do that.");
}
function requireOwner(session: StoredSession | null): asserts session is StoredSession & { organiserId: string } {
  requireAdmin(session);
  if (session.organiserRole !== "owner") throw new HttpError(403, "Only the account owner can do that.");
}
async function accountBatch(db: D1Database, statements: D1PreparedStatement[]) {
  try { return await db.batch(statements); }
  catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: organisers\.username/i.test(error.message)) {
      throw new HttpError(409, "That username is already in use. Choose another username.");
    }
    if (error instanceof Error && /UNIQUE constraint failed: organisers\.role/i.test(error.message)) {
      throw new HttpError(409, "The owner account is already set up. Please sign in.");
    }
    throw error;
  }
}
async function invitation(env: AccountEnv, value: string, reset: boolean): Promise<AccountInvitation> {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new HttpError(404, "This link is invalid or has expired. Ask for a new link.");
  const found = await env.DB.prepare(`SELECT i.id,i.kind,i.name,i.expires_at AS expiresAt,
      i.target_organiser_id AS targetOrganiserId,o.username
      FROM account_invitations i LEFT JOIN organisers o ON o.id=i.target_organiser_id
      WHERE i.token_hash=? AND ${reset ? "i.kind='reset'" : "i.kind IN ('owner','organiser')"} AND ${invitationValid}`)
    .bind(await hash(value), Date.now()).first<AccountInvitation>();
  if (!found) throw new HttpError(404, "This link is invalid or has expired. Ask for a new link.");
  return found;
}
async function endSessions(request: Request, env: AccountEnv, guestOnly: boolean) {
  const headers = new Headers();
  const statements: D1PreparedStatement[] = [];
  for (const name of [organiserCookieName, guestCookieName]) {
    const value = cookieToken(request, name);
    if (guestOnly && name === organiserCookieName) {
      if (!value) continue;
      const legacy = await env.DB.prepare("SELECT role FROM sessions WHERE token_hash=?")
        .bind(await hash(value)).first<{ role: string }>();
      if (legacy?.role !== "participant") continue;
    }
    if (value) statements.push(env.DB.prepare(`DELETE FROM sessions WHERE token_hash=?${guestOnly ? " AND role='participant'" : ""}`)
      .bind(await hash(value)));
    headers.append("Set-Cookie", sessionCookie(request, "", 0, name));
  }
  if (statements.length) await env.DB.batch(statements);
  return reply({ ok: true }, 200, headers);
}

export async function accountRoute(
  request: Request, env: AccountEnv, session: StoredSession | null, localSetup: boolean,
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const method = request.method;
  if (path === "/api/auth/logout" && method === "POST") return endSessions(request, env, false);
  if (path === "/api/invitations/leave" && method === "POST") return endSessions(request, env, true);
  if (path === "/api/auth/setup" && method === "POST") {
    if (!localSetup) throw new HttpError(403, "Initial organiser setup is only available on this computer.");
    const input = await body(request, credentialsSchema);
    if (await env.DB.prepare("SELECT id FROM organisers WHERE role='owner'").first()) {
      throw new HttpError(409, "The owner account is already set up. Please sign in.");
    }
    const password = await createPassword(input.password, env.AUTH_SECRET);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const results = await accountBatch(env.DB, [env.DB.prepare(`INSERT INTO organisers
        (id,username,salt,verifier,iterations,role,active,created_at,updated_at)
        SELECT ?,?,?,?,?,'owner',1,?,? WHERE NOT EXISTS (SELECT 1 FROM organisers WHERE role='owner')`)
      .bind(id, input.username.toLowerCase(), password.salt, password.verifier, password.iterations, now, now)]);
    if (!results[0].meta.changes) throw new HttpError(409, "The owner account is already set up. Please sign in.");
    return reply({ ok: true }, 201, { "Set-Cookie": await signIn(request, env, "admin", id, password.verifier) });
  }
  if (path === "/api/auth/login" && method === "POST") {
    const input = await body(request, credentialsSchema);
    const account = await env.DB.prepare("SELECT id,username,salt,verifier,iterations FROM organisers WHERE username=? AND active=1")
      .bind(input.username.toLowerCase()).first<PasswordAccount>();
    if (!account || !(await verifyPassword(input.password, account, env.AUTH_SECRET))) {
      throw new HttpError(401, "The username or password is incorrect.");
    }
    return reply({ ok: true }, 200, { "Set-Cookie": await signIn(request, env, "admin", account.id, account.verifier) });
  }
  if (path === "/api/organisers" && method === "GET") {
    requireOwner(session);
    const [accounts, invites] = await Promise.all([
      env.DB.prepare(`SELECT id,username,role,active,created_at AS createdAt FROM organisers ORDER BY created_at,id`)
        .all<Omit<OrganiserAccount, "active"> & { active: number }>(),
      env.DB.prepare(`SELECT id,name,expires_at AS expiresAt,created_at AS createdAt FROM account_invitations
          WHERE kind='organiser' AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at,id`)
        .bind(Date.now()).all<OrganiserDirectory["invitations"][number]>(),
    ]);
    const result: OrganiserDirectory = {
      organisers: accounts.results.map((account) => ({ ...account, active: Boolean(account.active) })),
      invitations: invites.results,
    };
    return reply(result);
  }
  if (path === "/api/organiser-invitations" && method === "POST") {
    requireOwner(session);
    const input = await body(request, organiserInvitationSchema);
    const inviteToken = token();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = Date.now() + 7 * 86400000;
    await env.DB.prepare(`INSERT INTO account_invitations (id,kind,name,token_hash,created_by,created_at,expires_at)
        VALUES (?,'organiser',?,?,?,?,?)`)
      .bind(id, input.name, await hash(inviteToken), session.organiserId, now, expiresAt).run();
    return reply({ id, name: input.name, token: inviteToken, createdAt: now, expiresAt }, 201);
  }
  const inviteMatch = path.match(/^\/api\/organiser-invitations\/([^/]+)$/);
  if (inviteMatch && method === "DELETE") {
    requireOwner(session);
    const result = await env.DB.prepare(`UPDATE account_invitations SET revoked_at=?
        WHERE id=? AND kind='organiser' AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?`)
      .bind(Date.now(), inviteMatch[1], Date.now()).run();
    if (!result.meta.changes) throw new HttpError(404, "This pending invitation could not be found.");
    return reply({ ok: true });
  }
  if (inviteMatch && method === "GET") {
    const found = await invitation(env, inviteMatch[1], false);
    return reply({ name: found.name, kind: found.kind, expiresAt: found.expiresAt });
  }
  if (path === "/api/organiser-invitations/redeem" && method === "POST") {
    const input = await body(request, organiserRegistrationSchema);
    const found = await invitation(env, input.token, false);
    const password = await createPassword(input.password, env.AUTH_SECRET);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const sessionToken = token();
    const results = await accountBatch(env.DB, [
      env.DB.prepare(`INSERT INTO organisers (id,username,salt,verifier,iterations,role,active,created_at,updated_at)
          SELECT ?,?,?,?,?,i.kind,1,?,? FROM account_invitations i
          WHERE i.id=? AND i.token_hash=? AND i.kind IN ('owner','organiser') AND ${invitationValid}`)
        .bind(id, input.username.toLowerCase(), password.salt, password.verifier, password.iterations,
          now, now, found.id, await hash(input.token), Date.now()),
      env.DB.prepare(`UPDATE account_invitations SET used_at=? WHERE id=?
          AND EXISTS (SELECT 1 FROM organisers WHERE id=?)`)
        .bind(Date.now(), found.id, id),
      env.DB.prepare(`INSERT INTO sessions (token_hash,role,participant_id,organiser_id,expires_at)
          SELECT ?,'admin',NULL,id,? FROM organisers WHERE id=? AND active=1`)
        .bind(await hash(sessionToken), Date.now() + 86400000, id),
    ]);
    if (!results[0].meta.changes) throw new HttpError(409, "This invitation has already been used or is no longer available.");
    return reply({ ok: true }, 201, { "Set-Cookie": sessionCookie(request, sessionToken, 86400) });
  }
  const accountMatch = path.match(/^\/api\/organisers\/([^/]+)(?:\/(reset))?$/);
  if (accountMatch && ((method === "PUT" && !accountMatch[2]) || (method === "POST" && accountMatch[2] === "reset"))) {
    requireOwner(session);
    const target = await env.DB.prepare("SELECT id,username,role,active FROM organisers WHERE id=?")
      .bind(accountMatch[1]).first<{ id: string; username: string; role: OrganiserRole; active: number }>();
    if (!target) throw new HttpError(404, "This organiser could not be found.");
    if (target.role === "owner") throw new HttpError(403, "The owner account cannot be suspended or reset here.");
    if (method === "PUT") {
      const input = await body(request, organiserAccessSchema);
      const statements = [env.DB.prepare("UPDATE organisers SET active=?,updated_at=? WHERE id=? AND role!='owner'")
        .bind(input.active ? 1 : 0, new Date().toISOString(), target.id)];
      if (!input.active) statements.push(env.DB.prepare("DELETE FROM sessions WHERE organiser_id=? AND role='admin'").bind(target.id));
      await env.DB.batch(statements);
      return reply({ ok: true });
    }
    if (!target.active) throw new HttpError(409, "Reactivate this organiser before sending a password reset.");
    const resetToken = token();
    const now = Date.now();
    const expiresAt = now + 1800000;
    await env.DB.batch([
      env.DB.prepare(`UPDATE account_invitations SET revoked_at=? WHERE kind='reset' AND target_organiser_id=?
          AND used_at IS NULL AND revoked_at IS NULL`).bind(now, target.id),
      env.DB.prepare(`INSERT INTO account_invitations
          (id,kind,name,token_hash,target_organiser_id,created_by,created_at,expires_at)
          VALUES (?,'reset',?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), target.username, await hash(resetToken), target.id,
          session.organiserId, new Date(now).toISOString(), expiresAt),
    ]);
    return reply({ token: resetToken, expiresAt }, 201);
  }
  const resetMatch = path.match(/^\/api\/password-resets\/([^/]+)$/);
  if (resetMatch && method === "GET") {
    const found = await invitation(env, resetMatch[1], true);
    return reply({ username: found.username, expiresAt: found.expiresAt });
  }
  if (path === "/api/password-resets/redeem" && method === "POST") {
    const input = await body(request, passwordResetSchema);
    const found = await invitation(env, input.token, true);
    const password = await createPassword(input.password, env.AUTH_SECRET);
    const sessionToken = token();
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE organisers SET salt=?,verifier=?,iterations=?,updated_at=?
          WHERE id=? AND active=1 AND EXISTS (SELECT 1 FROM account_invitations i
            WHERE i.id=? AND i.token_hash=? AND i.kind='reset' AND i.target_organiser_id=organisers.id AND ${invitationValid})`)
        .bind(password.salt, password.verifier, password.iterations, new Date().toISOString(),
          found.targetOrganiserId, found.id, await hash(input.token), Date.now()),
      env.DB.prepare(`UPDATE account_invitations SET used_at=? WHERE id=? AND EXISTS
          (SELECT 1 FROM organisers WHERE id=? AND salt=? AND verifier=?)`)
        .bind(Date.now(), found.id, found.targetOrganiserId, password.salt, password.verifier),
      env.DB.prepare(`DELETE FROM sessions WHERE role='admin' AND organiser_id=? AND EXISTS
          (SELECT 1 FROM organisers WHERE id=? AND salt=? AND verifier=?)`)
        .bind(found.targetOrganiserId, found.targetOrganiserId, password.salt, password.verifier),
      env.DB.prepare(`INSERT INTO sessions (token_hash,role,participant_id,organiser_id,expires_at)
          SELECT ?,'admin',NULL,id,? FROM organisers WHERE id=? AND active=1 AND salt=? AND verifier=?`)
        .bind(await hash(sessionToken), Date.now() + 86400000, found.targetOrganiserId, password.salt, password.verifier),
    ]);
    if (!results[0].meta.changes) throw new HttpError(409, "This password reset has already been used or is no longer available.");
    return reply({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, sessionToken, 86400) });
  }
  if (path === "/api/auth/password" && method === "POST") {
    requireAdmin(session);
    const input = await body(request, passwordChangeSchema);
    const account = await env.DB.prepare("SELECT id,username,salt,verifier,iterations FROM organisers WHERE id=? AND active=1")
      .bind(session.organiserId).first<PasswordAccount>();
    if (!account || !(await verifyPassword(input.currentPassword, account, env.AUTH_SECRET))) {
      throw new HttpError(401, "Your current password is incorrect.");
    }
    const password = await createPassword(input.newPassword, env.AUTH_SECRET);
    const sessionToken = token();
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE organisers SET salt=?,verifier=?,iterations=?,updated_at=?
          WHERE id=? AND active=1 AND verifier=?`)
        .bind(password.salt, password.verifier, password.iterations, new Date().toISOString(), account.id, account.verifier),
      env.DB.prepare(`DELETE FROM sessions WHERE role='admin' AND organiser_id=? AND EXISTS
          (SELECT 1 FROM organisers WHERE id=? AND salt=? AND verifier=?)`)
        .bind(account.id, account.id, password.salt, password.verifier),
      env.DB.prepare(`UPDATE account_invitations SET revoked_at=? WHERE kind='reset' AND target_organiser_id=?
          AND used_at IS NULL AND revoked_at IS NULL AND EXISTS
          (SELECT 1 FROM organisers WHERE id=? AND salt=? AND verifier=?)`)
        .bind(Date.now(), account.id, account.id, password.salt, password.verifier),
      env.DB.prepare(`INSERT INTO sessions (token_hash,role,participant_id,organiser_id,expires_at)
          SELECT ?,'admin',NULL,id,? FROM organisers WHERE id=? AND active=1 AND salt=? AND verifier=?`)
        .bind(await hash(sessionToken), Date.now() + 86400000, account.id, password.salt, password.verifier),
    ]);
    if (!results[0].meta.changes) throw new HttpError(409, "Your password just changed. Sign in again before changing it.");
    return reply({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, sessionToken, 86400) });
  }
  return null;
}
