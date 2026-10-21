import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { isPublicAddress, publicLookup, publicUrl } from "../scripts/public-web.mjs";

let mf;
let workerScript;
let maps;
let imports;
let providers;
let tomtomFixture = [];
let tomtomStatus = 200;
let tavilyDomainFixture = [];
let tavilyBroadFixture = [];
let tavilyStatus = 200;
let malformedLookup = false;
let providerRequests = [];
let websiteRedirect = "";
let websiteFixture = "";
let robotsFixture = "";
let publicRequests = [];
const credentials = { username: "test-organiser", password: "only-a-test-password-2026" };
const migrationNames = ["0001_planner.sql", "0002_experiences_and_auth.sql", "0003_venue_import.sql",
  "0004_event_city.sql", "0005_lookup_budgets.sql", "0006_invited_organisers.sql"];
async function migrate(database) {
  for (const name of migrationNames) {
    const migration = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    for (const statement of migration.split(";").map((sql) => sql.trim()).filter(Boolean)) await database.prepare(statement).run();
  }
}
before(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../worker/index.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
  });
  workerScript = bundle.outputFiles[0].text;
  mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-01",
    d1Databases: ["DB"], bindings: {
      LOCAL_DEV: "true", APP_ORIGIN: "http://localhost", AUTH_SECRET: "test-only-pepper-not-a-real-credential-123456789",
      TOMTOM_API_KEY: "test-only-tomtom-key", TAVILY_API_KEY: "test-only-tavily-key",
    },
    serviceBindings: {
      LOOKUP_API: async (request) => {
        const url = new URL(request.url);
        const input = await request.json();
        providerRequests.push({
          url: request.url, body: input,
          authorization: request.headers.get("authorization"), tomtomKey: request.headers.get("tomtom-api-key"),
          version: request.headers.get("tomtom-api-version"), attributes: request.headers.get("attributes"),
        });
        if (malformedLookup) return new Response("invalid json", { headers: { "Content-Type": "application/json" } });
        if (url.hostname === "api.tomtom.com") return Response.json({ results: tomtomFixture }, {
          status: tomtomStatus, headers: tomtomStatus === 429 ? { "Retry-After": "120" }
            : tomtomStatus === 302 ? { Location: "https://outside.example.org/should-not-be-followed" } : {},
        });
        if (url.hostname === "api.tavily.com") return Response.json({
          results: input.include_domains?.length ? tavilyDomainFixture : tavilyBroadFixture,
        }, { status: tavilyStatus, headers: tavilyStatus === 429 ? { "Retry-After": "120" } : {} });
        throw new Error("A provider request escaped the fixed vendor hosts.");
      },
      PUBLIC_WEB: async (request) => {
      publicRequests.push({ url: request.url, agent: request.headers.get("user-agent"), auth: request.headers.get("authorization") });
      const url = new URL(request.url);
      if (url.pathname === "/robots.txt") return new Response(robotsFixture, { headers: { "Content-Type": "text/plain" } });
      if (url.pathname === "/redirect" && websiteRedirect) return new Response(null, { status: 302, headers: { location: websiteRedirect } });
      if (url.hostname === "venue.example.org") return new Response(websiteFixture, { headers: { "Content-Type": "text/html" } });
      return new Response(null, { status: 404 });
    } },
  });
  const database = await mf.getD1Database("DB");
  await migrate(database);
  await client()("/auth/setup", "POST", credentials, 201);
  const mapsBundle = await build({ entryPoints: [fileURLToPath(new URL("../worker/maps.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  maps = await import(`data:text/javascript;base64,${Buffer.from(mapsBundle.outputFiles[0].text).toString("base64")}`);
  const importBundle = await build({ entryPoints: [fileURLToPath(new URL("../worker/import.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  imports = await import(`data:text/javascript;base64,${Buffer.from(importBundle.outputFiles[0].text).toString("base64")}`);
  const providerBundle = await build({ entryPoints: [fileURLToPath(new URL("../worker/providers.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  providers = await import(`data:text/javascript;base64,${Buffer.from(providerBundle.outputFiles[0].text).toString("base64")}`);
});
beforeEach(async () => {
  const database = await mf.getD1Database("DB");
  await database.batch([
    database.prepare("DELETE FROM request_limits"),
    database.prepare("DELETE FROM import_cache"),
    database.prepare("DELETE FROM import_locks"),
    database.prepare("DELETE FROM provider_usage"),
  ]);
  tomtomFixture = []; tomtomStatus = 200; tavilyDomainFixture = []; tavilyBroadFixture = []; tavilyStatus = 200;
  malformedLookup = false; providerRequests = [];
  websiteRedirect = ""; websiteFixture = ""; robotsFixture = ""; publicRequests = [];
});
after(async () => { await mf?.dispose(); });

function client(instance = mf) {
  const cookies = new Map();
  const cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const call = async (path, method = "GET", input, expected = 200) => {
    const response = await instance.dispatchFetch(`http://localhost/api${path}`, {
      method, headers: {
        ...(cookies.size ? { cookie: cookieHeader() } : {}),
        ...(method !== "GET" ? { origin: "http://localhost" } : {}),
        ...(input !== undefined ? { "Content-Type": input instanceof Blob ? input.type : "application/json" } : {}),
      },
      body: input === undefined ? undefined : input instanceof Blob ? input : JSON.stringify(input),
    });
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie()
      : (response.headers.get("set-cookie") ?? "").split(/,\s*(?=[^;,=\s]+=)/).filter(Boolean);
    for (const value of setCookies) {
      const [pair] = value.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      if (/\bMax-Age=0\b/i.test(value)) cookies.delete(name);
      else cookies.set(name, pair.slice(separator + 1));
    }
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  call.image = (path) => instance.dispatchFetch(`http://localhost${path}`, { headers: cookies.size ? { cookie: cookieHeader() } : {} });
  return call;
}
const eventData = {
  title: "Friday dinner", description: "Pick somewhere together.", date: "2026-11-06",
  occasion: "Dinner", theme: "sage", accent: "", coverUrl: "", status: "draft",
};
const locationData = {
  name: "Scarpetta — Rantzausgade", address: "Rantzausgade 7, Copenhagen",
  mapsUrl: "https://maps.app.goo.gl/hs3WexT6SSykQF4a6", menuUrl: "",
  description: "Italian neighbourhood restaurant.", note: "Check the vegetarian options.", imageUrls: [],
};
async function setup(admin) {
  if (!admin) {
    admin = client();
    await admin("/auth/login", "POST", credentials);
  }
  const event = await admin("/events", "POST", eventData, 201);
  const place = await admin(`/events/${event.id}/locations`, "POST", locationData, 201);
  const person = await admin(`/events/${event.id}/participants`, "POST", { name: "Alex" }, 201);
  await admin(`/events/${event.id}`, "PUT", { ...eventData, status: "open" });
  const guest = client();
  await guest("/invitations/redeem", "POST", { token: person.inviteToken });
  return { admin, event, place, person, guest };
}

async function ownerClient() {
  const owner = client();
  await owner("/auth/login", "POST", credentials);
  return owner;
}
function accountCredentials() {
  return { username: `account-${crypto.randomUUID().slice(0, 12)}`, password: "a-private-test-password-2026" };
}
async function invitedOrganiser(owner, account = accountCredentials()) {
  const invitation = await owner("/organiser-invitations", "POST", { name: account.username }, 201);
  const organiser = client();
  await organiser("/organiser-invitations/redeem", "POST", { ...account, token: invitation.token }, 201);
  const session = await organiser("/session");
  assert.equal(session.organiserRole, "organiser");
  assert.equal(session.name, account.username);
  return { organiser, account, id: session.organiserId, invitation };
}
async function expireAccountLink(token, instance = mf) {
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
  await (await instance.getD1Database("DB")).prepare("UPDATE account_invitations SET expires_at=? WHERE token_hash=?")
    .bind(Date.now() - 1, digest).run();
}
async function assertCannotManageEvent(caller, { event, place, person }) {
  const path = `/events/${event.id}`;
  await caller(path, "PUT", { ...eventData, status: "closed" }, 403);
  await caller(path, "DELETE", undefined, 403);
  await caller(`${path}/locations`, "POST", locationData, 403);
  await caller(`${path}/locations/${place.id}`, "PUT", locationData, 403);
  await caller(`${path}/locations/${place.id}`, "DELETE", undefined, 403);
  await caller(`${path}/participants`, "POST", { name: "Uninvited" }, 403);
  await caller(`${path}/participants/${person.id}`, "DELETE", undefined, 403);
  await caller(`${path}/participants/${person.id}/invitation`, "POST", undefined, 403);
  await caller(`${path}/participants/${person.id}/invitation`, "DELETE", undefined, 403);
}

test("only the owner can invite and manage organisers; an active account grants no owner privileges", async () => {
  const owner = await ownerClient();
  const { organiser, id } = await invitedOrganiser(owner);
  const { guest } = await setup(owner);
  const pending = await owner("/organiser-invitations", "POST", { name: "Private invite" }, 201);
  const ownerId = (await owner("/session")).organiserId;
  for (const caller of [client(), guest, organiser]) {
    await caller("/organisers", "GET", undefined, 403);
    await caller("/organiser-invitations", "POST", { name: "Not allowed" }, 403);
    await caller(`/organiser-invitations/${pending.id}`, "DELETE", undefined, 403);
    await caller(`/organisers/${id}`, "PUT", { active: false }, 403);
    await caller(`/organisers/${id}/reset`, "POST", undefined, 403);
    await caller(`/organisers/${ownerId}/reset`, "POST", undefined, 403);
  }
  await owner(`/organisers/${ownerId}`, "PUT", { active: false }, 403);
  await owner(`/organisers/${ownerId}/reset`, "POST", undefined, 403);
  const directory = await owner("/organisers");
  assert.equal(directory.organisers.find((item) => item.id === id).active, true);
  assert.equal(directory.organisers.filter((item) => item.role === "owner").length, 1);
  await owner(`/organiser-invitations/${pending.id}`, "DELETE");
});

test("organiser invitations are random seven-day one-use links whose raw tokens are never stored or listed", async () => {
  const owner = await ownerClient();
  const before = Date.now();
  const first = await owner("/organiser-invitations", "POST", { name: "First" }, 201);
  const second = await owner("/organiser-invitations", "POST", { name: "Second" }, 201);
  for (const issued of [first, second]) {
    assert.match(issued.token, /^[0-9a-f]{64}$/);
    assert.ok(issued.expiresAt >= before + 7 * 86400000);
    assert.ok(issued.expiresAt <= Date.now() + 7 * 86400000);
    const publicInfo = await client()(`/organiser-invitations/${issued.token}`);
    assert.deepEqual(publicInfo, { name: issued.name, kind: "organiser", expiresAt: issued.expiresAt });
    const stored = await (await mf.getD1Database("DB")).prepare("SELECT * FROM account_invitations WHERE id=?")
      .bind(issued.id).first();
    assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(stored.token_hash, issued.token);
    assert.equal(JSON.stringify(stored).includes(issued.token), false);
  }
  assert.notEqual(first.token, second.token);
  const directory = await owner("/organisers");
  for (const issued of [first, second]) {
    assert.ok(directory.invitations.some((item) => item.id === issued.id));
    assert.equal(JSON.stringify(directory).includes(issued.token), false);
    assert.equal(Object.hasOwn(directory.invitations.find((item) => item.id === issued.id), "token_hash"), false);
  }
  await owner(`/organiser-invitations/${first.id}`, "DELETE");
  await owner(`/organiser-invitations/${second.id}`, "DELETE");
});

test("invalid, expired, revoked and already-used invitations fail with the same generic link error", async () => {
  const owner = await ownerClient();
  const expired = await owner("/organiser-invitations", "POST", { name: "Expired" }, 201);
  await expireAccountLink(expired.token);
  const revoked = await owner("/organiser-invitations", "POST", { name: "Revoked" }, 201);
  await owner(`/organiser-invitations/${revoked.id}`, "DELETE");
  const used = await invitedOrganiser(owner);
  const errors = [];
  for (const token of ["invalid", "0".repeat(64), expired.token, revoked.token, used.invitation.token]) {
    errors.push((await client()(`/organiser-invitations/${token}`, "GET", undefined, 404)).error);
    if (token !== "invalid") {
      errors.push((await client()("/organiser-invitations/redeem", "POST", { ...accountCredentials(), token }, 404)).error);
    }
  }
  assert.equal(new Set(errors).size, 1);
  assert.match(errors[0], /invalid or has expired/i);
  const directory = await owner("/organisers");
  for (const invitation of [expired, revoked, used.invitation]) {
    assert.equal(directory.invitations.some((item) => item.id === invitation.id), false);
  }
});

test("duplicate usernames and privilege injection cannot consume an organiser invitation", async () => {
  const owner = await ownerClient();
  const invitation = await owner("/organiser-invitations", "POST", { name: "Retry invitation" }, 201);
  const account = accountCredentials();
  await client()("/organiser-invitations/redeem", "POST", { ...account, token: invitation.token, role: "owner" }, 400);
  await client()("/organiser-invitations/redeem", "POST", {
    ...account, username: credentials.username.toUpperCase(), token: invitation.token,
  }, 409);
  await client()(`/organiser-invitations/${invitation.token}`);
  const organiser = client();
  await organiser("/organiser-invitations/redeem", "POST", { ...account, token: invitation.token }, 201);
  assert.equal((await organiser("/session")).organiserRole, "organiser");
  await organiser("/organisers", "GET", undefined, 403);
});

test("concurrent claims create exactly one organiser account and one authenticated claimant", async () => {
  const owner = await ownerClient();
  const invitation = await owner("/organiser-invitations", "POST", { name: "Racing invitation" }, 201);
  const accounts = [accountCredentials(), accountCredentials()];
  const responses = await Promise.all(accounts.map((account) => mf.dispatchFetch("http://localhost/api/organiser-invitations/redeem", {
    method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ ...account, token: invitation.token }),
  })));
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => [404, 409].includes(response.status)).length, 1);
  assert.equal(responses.filter((response) => response.headers.has("set-cookie")).length, 1);
  const directory = await owner("/organisers");
  const created = directory.organisers.filter((item) => accounts.some((account) => account.username === item.username));
  assert.equal(created.length, 1);
  assert.equal(created[0].role, "organiser");
  for (const [index, response] of responses.entries()) {
    await response.arrayBuffer();
    await client()("/auth/login", "POST", accounts[index], response.status === 201 ? 200 : 401);
  }
});

test("a fresh production planner has no public signup or anonymous ownership claim; only a privately provisioned owner link works", async () => {
  const isolated = new Miniflare({
    modules: true, script: workerScript, compatibilityDate: "2026-07-01", d1Databases: ["DB"],
    bindings: { APP_ORIGIN: "http://localhost", AUTH_SECRET: "isolated-test-only-pepper-not-a-real-secret" },
  });
  try {
    const database = await isolated.getD1Database("DB");
    await migrate(database);
    const anonymous = client(isolated);
    assert.deepEqual(await anonymous("/session"), { role: null, setupRequired: false });
    await anonymous("/auth/setup", "POST", accountCredentials(), 403);
    await anonymous("/auth/register", "POST", accountCredentials(), 404);
    await anonymous("/auth/signup", "POST", accountCredentials(), 404);
    await anonymous("/organisers", "POST", { ...accountCredentials(), role: "owner" }, 404);
    await anonymous("/organiser-invitations", "POST", { name: "Owner", kind: "owner" }, 403);
    await anonymous("/organiser-invitations/redeem", "POST", { ...accountCredentials(), token: "0".repeat(64) }, 404);
    assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM organisers").first()).total, 0);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
    await database.prepare(`INSERT INTO account_invitations (id,kind,name,token_hash,created_at,expires_at)
      VALUES (?,'owner','Private owner',?,?,?)`)
      .bind(crypto.randomUUID(), digest, new Date().toISOString(), Date.now() + 7 * 86400000).run();
    assert.equal((await anonymous(`/organiser-invitations/${token}`)).kind, "owner");
    const account = accountCredentials();
    await anonymous("/organiser-invitations/redeem", "POST", { ...account, token }, 201);
    assert.equal((await anonymous("/session")).organiserRole, "owner");
    assert.equal((await anonymous("/organisers")).organisers.length, 1);
    await client(isolated)(`/organiser-invitations/${token}`, "GET", undefined, 404);
    await client(isolated)("/auth/setup", "POST", accountCredentials(), 403);
  } finally {
    await isolated.dispose();
  }
});

test("owners and organisers list and administer only their own events, locations, people and invitations", async () => {
  const owner = await ownerClient();
  const first = await invitedOrganiser(owner);
  const second = await invitedOrganiser(owner);
  const fixtures = [await setup(owner), await setup(first.organiser), await setup(second.organiser)];
  for (const own of fixtures) {
    const list = await own.admin("/events");
    assert.ok(list.some((event) => event.id === own.event.id));
    const session = await own.admin("/session");
    assert.ok(list.every((event) => event.organiserId === session.organiserId));
    await own.admin(`/events/${own.event.id}`, "PUT", { ...eventData, title: "My updated event", status: "open" });
    await own.admin(`/events/${own.event.id}/locations/${own.place.id}`, "PUT", { ...locationData, note: "My edit" });
    const rotated = await own.admin(`/events/${own.event.id}/participants/${own.person.id}/invitation`, "POST");
    assert.match(rotated.inviteToken, /^[0-9a-f]{64}$/);
    for (const other of fixtures.filter((item) => item !== own)) {
      assert.equal(list.some((event) => event.id === other.event.id), false);
      await own.admin(`/events/${other.event.id}`, "GET", undefined, 403);
      await assertCannotManageEvent(own.admin, other);
      await own.guest(`/events/${other.event.id}`, "GET", undefined, 403);
      await own.guest(`/events/${other.event.id}/ratings/${other.place.id}`, "PUT", { score: 5 }, 403);
    }
    const detail = await own.admin(`/events/${own.event.id}`);
    assert.equal(detail.event.title, "My updated event");
    assert.equal(detail.locations[0].note, "My edit");
    assert.equal(detail.participants[0].id, own.person.id);
  }
  for (const own of fixtures) {
    await own.admin(`/events/${own.event.id}/participants/${own.person.id}/invitation`, "DELETE");
    await own.admin(`/events/${own.event.id}/participants/${own.person.id}`, "DELETE");
    await own.admin(`/events/${own.event.id}/locations/${own.place.id}`, "DELETE");
    await own.admin(`/events/${own.event.id}`, "DELETE");
    await own.admin(`/events/${own.event.id}`, "GET", undefined, 404);
  }
});

test("staged and attached organiser photos cannot be read or borrowed by another organiser or the site owner", async () => {
  const owner = await ownerClient();
  const first = await invitedOrganiser(owner);
  const second = await invitedOrganiser(owner);
  const own = await setup(first.organiser);
  const outsiders = [await setup(owner), await setup(second.organiser)];
  const staged = await first.organiser("/media", "POST", new Blob([pixel], { type: "image/png" }), 201);
  const attached = await first.organiser("/media", "POST", new Blob([pixel], { type: "image/png" }), 201);
  await own.admin(`/events/${own.event.id}/locations/${own.place.id}`, "PUT", { ...locationData, imageUrls: [attached.url] });
  for (const image of [staged, attached]) {
    assert.equal((await own.admin.image(image.url)).status, 200);
    for (const outsider of outsiders) {
      assert.equal((await outsider.admin.image(image.url)).status, 404);
      assert.equal((await outsider.guest.image(image.url)).status, 404);
      await outsider.admin("/events", "POST", { ...eventData, coverUrl: image.url }, 400);
      await outsider.admin(`/events/${outsider.event.id}`, "PUT", { ...eventData, status: "open", coverUrl: image.url }, 400);
      await outsider.admin(`/events/${outsider.event.id}/locations`, "POST", { ...locationData, imageUrls: [image.url] }, 400);
      await outsider.admin(`/events/${outsider.event.id}/locations/${outsider.place.id}`, "PUT", {
        ...locationData, imageUrls: [image.url],
      }, 400);
    }
  }
  assert.equal((await own.guest.image(staged.url)).status, 404);
  const image = await own.guest.image(attached.url);
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), pixel);
});

test("joining and leaving a different organiser's event preserves the organiser workspace; logout clears both sessions", async () => {
  const owner = await ownerClient();
  const invited = await invitedOrganiser(owner);
  const mine = await setup(invited.organiser);
  const other = await setup(owner);
  const original = await invited.organiser("/session");
  await invited.organiser("/invitations/redeem", "POST", { token: other.person.inviteToken });
  assert.deepEqual(await invited.organiser("/session"), original);
  assert.deepEqual((await invited.organiser("/events")).map((event) => event.id), [mine.event.id]);
  const detail = await invited.organiser(`/events/${other.event.id}`);
  assert.equal(detail.viewer.role, "participant");
  assert.equal(detail.viewer.participantId, other.person.id);
  assert.deepEqual(detail.participants, []);
  await assertCannotManageEvent(invited.organiser, other);
  await invited.organiser(`/events/${other.event.id}/ratings/${other.place.id}`, "PUT", { score: 4 });
  assert.equal((await other.guest(`/events/${other.event.id}`)).myRatings[other.place.id], 4);
  await invited.organiser("/invitations/leave", "POST");
  assert.deepEqual(await invited.organiser("/session"), original);
  await invited.organiser(`/events/${mine.event.id}`);
  await invited.organiser(`/events/${other.event.id}`, "GET", undefined, 403);
  await invited.organiser("/invitations/redeem", "POST", { token: other.person.inviteToken });
  await invited.organiser("/auth/logout", "POST");
  assert.equal((await invited.organiser("/session")).role, null);
  await invited.organiser("/events", "GET", undefined, 403);
  await invited.organiser(`/events/${other.event.id}`, "GET", undefined, 403);
  const ownerSession = await owner("/session");
  await owner("/invitations/redeem", "POST", { token: mine.person.inviteToken });
  assert.deepEqual(await owner("/session"), ownerSession);
  assert.equal((await owner(`/events/${mine.event.id}`)).viewer.role, "participant");
  await assertCannotManageEvent(owner, mine);
  await owner("/invitations/leave", "POST");
  assert.deepEqual(await owner("/session"), ownerSession);
  await owner(`/events/${mine.event.id}`, "GET", undefined, 403);
});

test("suspension invalidates organiser sessions and pauses every event, guest, vote and photo without deleting saved data", async () => {
  const owner = await ownerClient();
  const invited = await invitedOrganiser(owner);
  const otherSession = client();
  await otherSession("/auth/login", "POST", invited.account);
  const fixtures = [await setup(invited.organiser), await setup(invited.organiser)];
  const pending = await invited.organiser("/media", "POST", new Blob([pixel], { type: "image/png" }), 201);
  const saved = await invited.organiser("/media", "POST", new Blob([pixel], { type: "image/png" }), 201);
  await invited.organiser(`/events/${fixtures[0].event.id}/locations/${fixtures[0].place.id}`, "PUT", {
    ...locationData, imageUrls: [saved.url],
  });
  for (const fixture of fixtures) await fixture.guest(`/events/${fixture.event.id}/ratings/${fixture.place.id}`, "PUT", { score: 5 });
  const ownerEvent = await setup(owner);
  await owner(`/organisers/${invited.id}`, "PUT", { active: false });
  for (const organiser of [invited.organiser, otherSession]) {
    assert.equal((await organiser("/session")).role, null);
    await organiser("/events", "GET", undefined, 403);
    await organiser("/media", "POST", new Blob([pixel], { type: "image/png" }), 403);
    assert.equal((await organiser.image(pending.url)).status, 403);
    assert.equal((await organiser.image(saved.url)).status, 403);
  }
  await client()("/auth/login", "POST", invited.account, 401);
  await owner(`/organisers/${invited.id}/reset`, "POST", undefined, 409);
  for (const fixture of fixtures) {
    assert.equal((await fixture.guest("/session")).role, null);
    await fixture.guest(`/events/${fixture.event.id}`, "GET", undefined, 404);
    await fixture.guest(`/events/${fixture.event.id}/ratings/${fixture.place.id}`, "PUT", { score: 1 }, 404);
    await client()("/invitations/redeem", "POST", { token: fixture.person.inviteToken }, 404);
    await owner(`/events/${fixture.event.id}`, "GET", undefined, 404);
  }
  assert.equal((await owner.image(pending.url)).status, 404);
  assert.equal((await owner.image(saved.url)).status, 404);
  assert.equal((await fixtures[0].guest.image(saved.url)).status, 403);
  await owner(`/events/${ownerEvent.event.id}`);
  await owner(`/organisers/${invited.id}`, "PUT", { active: true });
  assert.equal((await invited.organiser("/session")).role, null, "Reactivation must not resurrect account sessions");
  await invited.organiser("/auth/login", "POST", invited.account);
  assert.equal((await invited.organiser("/events")).length, 2);
  assert.equal((await invited.organiser.image(pending.url)).status, 200);
  assert.equal((await invited.organiser.image(saved.url)).status, 200);
  assert.equal((await fixtures[0].guest.image(saved.url)).status, 200);
  for (const fixture of fixtures) {
    const detail = await fixture.guest(`/events/${fixture.event.id}`);
    assert.equal(detail.myRatings[fixture.place.id], 5);
    assert.equal(detail.results[0].count, 1);
    await fixture.guest(`/events/${fixture.event.id}/ratings/${fixture.place.id}`, "PUT", { score: 4 });
    await owner(`/events/${fixture.event.id}`, "GET", undefined, 403);
  }
  await invited.organiser(`/events/${ownerEvent.event.id}`, "GET", undefined, 403);
});

test("password resets are target-specific thirty-minute one-use links, revoke older links and invalidate old sessions", async () => {
  const owner = await ownerClient();
  const target = await invitedOrganiser(owner);
  const unrelated = await invitedOrganiser(owner);
  const secondSession = client();
  await secondSession("/auth/login", "POST", target.account);
  const event = await setup(target.organiser);
  const before = Date.now();
  const older = await owner(`/organisers/${target.id}/reset`, "POST", undefined, 201);
  assert.ok(older.expiresAt >= before + 30 * 60000);
  assert.ok(older.expiresAt <= Date.now() + 30 * 60000);
  const reset = await owner(`/organisers/${target.id}/reset`, "POST", undefined, 201);
  assert.notEqual(reset.token, older.token);
  const invalidErrors = [
    await client()(`/password-resets/${older.token}`, "GET", undefined, 404),
    await client()(`/password-resets/${"0".repeat(64)}`, "GET", undefined, 404),
    await client()(`/password-resets/${target.invitation.token}`, "GET", undefined, 404),
  ];
  assert.equal(new Set(invalidErrors.map((value) => value.error)).size, 1);
  const info = await client()(`/password-resets/${reset.token}`);
  assert.deepEqual(info, { username: target.account.username, expiresAt: reset.expiresAt });
  await client()(`/organiser-invitations/${reset.token}`, "GET", undefined, 404);
  await client()("/organiser-invitations/redeem", "POST", { ...accountCredentials(), token: reset.token }, 404);
  await client()("/password-resets/redeem", "POST", { token: older.token, password: "replacement-test-password" }, 404);
  await unrelated.organiser("/password-resets/redeem", "POST", {
    token: reset.token, password: "replacement-test-password", organiserId: unrelated.id,
  }, 400);
  const fresh = client();
  await fresh("/password-resets/redeem", "POST", { token: reset.token, password: "replacement-test-password" });
  assert.equal((await fresh("/session")).organiserId, target.id);
  assert.equal((await unrelated.organiser("/session")).organiserId, unrelated.id);
  for (const oldSession of [target.organiser, secondSession]) {
    assert.equal((await oldSession("/session")).role, null);
    await oldSession("/events", "GET", undefined, 403);
  }
  await client()("/auth/login", "POST", target.account, 401);
  await client()("/auth/login", "POST", unrelated.account);
  await client()("/auth/login", "POST", { ...target.account, password: "replacement-test-password" });
  await fresh(`/events/${event.event.id}`);
  await owner(`/events/${event.event.id}`, "GET", undefined, 403);
  await client()(`/password-resets/${reset.token}`, "GET", undefined, 404);
  await client()("/password-resets/redeem", "POST", { token: reset.token, password: "another-test-password" }, 404);
  const directory = JSON.stringify(await owner("/organisers"));
  assert.equal(directory.includes(reset.token), false);
  const rows = await (await mf.getD1Database("DB")).prepare("SELECT * FROM account_invitations WHERE target_organiser_id=?")
    .bind(target.id).all();
  assert.equal(JSON.stringify(rows.results).includes(reset.token), false);
});

test("expired reset links cannot change a password or invalidate existing sessions", async () => {
  const owner = await ownerClient();
  const target = await invitedOrganiser(owner);
  const reset = await owner(`/organisers/${target.id}/reset`, "POST", undefined, 201);
  await expireAccountLink(reset.token);
  await client()(`/password-resets/${reset.token}`, "GET", undefined, 404);
  await client()("/password-resets/redeem", "POST", { token: reset.token, password: "replacement-test-password" }, 404);
  assert.equal((await target.organiser("/session")).organiserId, target.id);
  await client()("/auth/login", "POST", target.account);
  await client()("/auth/login", "POST", { ...target.account, password: "replacement-test-password" }, 401);
});

test("changing a password verifies the current password, revokes pending resets and all other account sessions", async () => {
  const owner = await ownerClient();
  const target = await invitedOrganiser(owner);
  const otherSession = client();
  await otherSession("/auth/login", "POST", target.account);
  const reset = await owner(`/organisers/${target.id}/reset`, "POST", undefined, 201);
  const newPassword = "changed-private-test-password";
  await target.organiser("/auth/password", "POST", { currentPassword: "wrong-private-test-password", newPassword }, 401);
  assert.equal((await otherSession("/session")).organiserId, target.id);
  await client()(`/password-resets/${reset.token}`);
  await target.organiser("/auth/password", "POST", { currentPassword: target.account.password, newPassword });
  assert.equal((await target.organiser("/session")).organiserId, target.id);
  assert.equal((await otherSession("/session")).role, null);
  await otherSession("/events", "GET", undefined, 403);
  await client()("/auth/login", "POST", target.account, 401);
  await client()("/auth/login", "POST", { ...target.account, password: newPassword });
  await client()(`/password-resets/${reset.token}`, "GET", undefined, 404);
  await client()("/password-resets/redeem", "POST", { token: reset.token, password: "replacement-test-password" }, 404);
  await target.organiser("/organisers", "GET", undefined, 403);
  assert.equal((await owner("/session")).organiserRole, "owner");
});

test("initial organiser setup is unavailable on a non-loopback host", async () => {
  const response = await mf.dispatchFetch("https://planner.example/api/auth/setup", {
    method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 403);
});

test("anonymous and cross-origin callers cannot create events or grant themselves admin", async () => {
  const anonymous = client();
  await anonymous("/events", "GET", undefined, 403);
  await anonymous("/events", "POST", eventData, 403);
  const response = await mf.dispatchFetch("http://localhost/api/auth/login", {
    method: "POST", headers: { origin: "https://unrelated.example" },
  });
  assert.equal(response.status, 403);
});

test("the configured frontend origin works through a local API proxy", async () => {
  const response = await mf.dispatchFetch("http://127.0.0.1:8787/api/auth/login", {
    method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
});

test("event settings, theme and location edits persist without affecting ratings", async () => {
  const { admin, event, place, guest } = await setup();
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 4 });
  await admin(`/events/${event.id}`, "PUT", {
    ...eventData, title: "A birthday dinner", theme: "rose", accent: "#ab4763", status: "open",
  });
  await admin(`/events/${event.id}/locations/${place.id}`, "PUT", { ...locationData, note: "Pescetarian menu." });
  const saved = await guest(`/events/${event.id}`);
  assert.equal(saved.event.title, "A birthday dinner");
  assert.equal(saved.event.theme, "rose");
  assert.equal(saved.event.accent, "#ab4763");
  assert.equal(saved.locations[0].note, "Pescetarian menu.");
  assert.equal(saved.myRatings[place.id], 4);
  assert.equal(saved.results[0].average, 4);
});

test("ratings survive reopening a personal link in a different session", async () => {
  const { event, place, person, guest } = await setup();
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 5 });
  const otherDevice = client();
  await otherDevice("/invitations/redeem", "POST", { token: person.inviteToken });
  assert.equal((await otherDevice(`/events/${event.id}`)).myRatings[place.id], 5);
  await otherDevice(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 3 });
  const detail = await guest(`/events/${event.id}`);
  assert.equal(detail.myRatings[place.id], 3);
  assert.equal(detail.results[0].count, 1, "Editing a rating must not add a duplicate");
});

test("live group averages exclude unrated participants and locations", async () => {
  const { admin, event, place, guest } = await setup();
  const secondPlace = await admin(`/events/${event.id}/locations`, "POST", {
    ...locationData, name: "Llama", mapsUrl: "https://www.google.com/maps/place/Llama/",
  }, 201);
  const secondPerson = await admin(`/events/${event.id}/participants`, "POST", { name: "Jamie" }, 201);
  await admin(`/events/${event.id}/participants`, "POST", { name: "Sam" }, 201);
  const jamie = client();
  await jamie("/invitations/redeem", "POST", { token: secondPerson.inviteToken });
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 5 });
  await jamie(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 3 });
  const detail = await guest(`/events/${event.id}`);
  assert.deepEqual(detail.results.find((r) => r.locationId === place.id), { locationId: place.id, average: 4, count: 2 });
  assert.deepEqual(detail.results.find((r) => r.locationId === secondPlace.id), { locationId: secondPlace.id, average: null, count: 0 });
  assert.equal(detail.participantCount, 3);
  assert.equal(detail.completedCount, 0);
  assert.deepEqual(detail.participants, [], "Guest responses must not expose the guest management list");
});

test("guests cannot administer events, impersonate another guest or access another event", async () => {
  const { event, place, guest } = await setup();
  const other = await setup();
  await guest(`/events/${event.id}`, "PUT", { ...eventData, status: "closed" }, 403);
  await guest(`/events/${event.id}/participants`, "POST", { name: "Someone" }, 403);
  await guest(`/events/${other.event.id}`, "GET", undefined, 403);
  await guest(`/events/${other.event.id}/ratings/${other.place.id}`, "PUT", { score: 5 }, 403);
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 5, participantId: other.person.id }, 400);
});

test("invitation rotation revokes old links and sessions but preserves saved votes", async () => {
  const { admin, event, place, person, guest } = await setup();
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 4 });
  const replacement = await admin(`/events/${event.id}/participants/${person.id}/invitation`, "POST");
  await guest(`/events/${event.id}`, "GET", undefined, 403);
  await client()("/invitations/redeem", "POST", { token: person.inviteToken }, 404);
  const restored = client();
  await restored("/invitations/redeem", "POST", { token: replacement.inviteToken });
  assert.equal((await restored(`/events/${event.id}`)).myRatings[place.id], 4);
  await admin(`/events/${event.id}/participants/${person.id}/invitation`, "DELETE");
  await restored(`/events/${event.id}`, "GET", undefined, 403);
  await client()("/invitations/redeem", "POST", { token: replacement.inviteToken }, 404);
  assert.equal((await admin(`/events/${event.id}`)).results[0].count, 1);
});

test("closing voting locks ratings but keeps results readable; reopening restores editing", async () => {
  const { admin, event, place, person, guest } = await setup();
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 5 });
  await admin(`/events/${event.id}`, "PUT", { ...eventData, status: "closed" });
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 1 }, 409);
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: null }, 409);
  assert.equal((await guest(`/events/${event.id}`)).results[0].average, 5);
  const returning = client();
  await returning("/invitations/redeem", "POST", { token: person.inviteToken });
  assert.equal((await returning(`/events/${event.id}`)).myRatings[place.id], 5);
  await admin(`/events/${event.id}`, "PUT", { ...eventData, status: "open" });
  await returning(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 2 });
});

test("drafts cannot be joined and cannot be opened without places and participants", async () => {
  const admin = client();
  await admin("/auth/login", "POST", credentials);
  const event = await admin("/events", "POST", eventData, 201);
  await admin(`/events/${event.id}`, "PUT", { ...eventData, status: "open" }, 400);
  const person = await admin(`/events/${event.id}/participants`, "POST", { name: "Alex" }, 201);
  await client()("/invitations/redeem", "POST", { token: person.inviteToken }, 404);
});

test("validation rejects invalid dates, URLs, duplicate people and out-of-range ratings", async () => {
  const { admin, event, place, guest } = await setup();
  await admin("/events", "POST", { ...eventData, date: "2026-02-31" }, 400);
  await admin(`/events/${event.id}/locations`, "POST", { ...locationData, mapsUrl: "https://unrelated.example/maps/" }, 400);
  await admin(`/events/${event.id}/locations`, "POST", { ...locationData, menuUrl: "javascript:alert(1)" }, 400);
  await admin(`/events/${event.id}/locations`, "POST", { ...locationData, imageUrls: ["http://images.example/photo.jpg"] }, 400);
  await admin(`/events/${event.id}/participants`, "POST", { name: "alex" }, 409);
  for (const score of [0, 6, 2.5, "5"]) await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score }, 400);
  await guest(`/events/${event.id}/ratings/unknown`, "PUT", { score: 3 }, 404);
});

test("clearing ratings and removing locations/participants keeps results consistent", async () => {
  const { admin, event, place, person, guest } = await setup();
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 3 });
  assert.equal((await guest(`/events/${event.id}`)).completedCount, 1);
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: null });
  assert.deepEqual((await guest(`/events/${event.id}`)).myRatings, {});
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 4 });
  await admin(`/events/${event.id}/locations/${place.id}`, "DELETE");
  assert.deepEqual((await guest(`/events/${event.id}`)).myRatings, {});
  await admin(`/events/${event.id}/participants/${person.id}`, "DELETE");
  await guest(`/events/${event.id}`, "GET", undefined, 403);
  await admin(`/events/${event.id}`, "DELETE");
  await admin(`/events/${event.id}`, "GET", undefined, 404);
});

test("organiser access requires a password, and neither account takeover nor the old shortcut works", async () => {
  const anonymous = client();
  await anonymous("/auth/local", "POST", undefined, 404);
  await anonymous("/auth/setup", "POST", credentials, 409);
  await anonymous("/auth/login", "POST", { ...credentials, password: "a-wrong-test-password" }, 401);
  await anonymous("/events", "GET", undefined, 403);
  await anonymous("/auth/login", "POST", credentials);
  await anonymous("/events");
  const stored = await (await mf.getD1Database("DB")).prepare("SELECT * FROM organisers WHERE role='owner'").first();
  assert.ok(stored);
  assert.ok(stored.salt.length >= 32);
  assert.ok(stored.iterations >= 100000);
  assert.equal(JSON.stringify(stored).includes(credentials.password), false);
  assert.equal(stored.verifier.length, 64);
  await anonymous("/auth/logout", "POST");
  await anonymous("/events", "GET", undefined, 403);
});

test("login attempts are limited and large request bodies are rejected", async () => {
  const anonymous = client();
  for (let i = 0; i < 10; i++) {
    await anonymous("/auth/login", "POST", { ...credentials, password: "wrong-test-password" }, 401);
  }
  await anonymous("/auth/login", "POST", credentials, 429);
  const oversized = await mf.dispatchFetch("http://localhost/api/invitations/redeem", {
    method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ token: "a".repeat(45000) }),
  });
  assert.equal(oversized.status, 413);
});

test("events require a date and preserve the complete mood configuration", async () => {
  const { admin, event, guest } = await setup();
  await admin("/events", "POST", { ...eventData, date: "" }, 400);
  await admin(`/events/${event.id}`, "PUT", {
    ...eventData, status: "open", mood: "romantic", greeting: "An evening for us", decorations: false,
  });
  const detail = await guest(`/events/${event.id}`);
  assert.equal(detail.event.mood, "romantic");
  assert.equal(detail.event.greeting, "An evening for us");
  assert.equal(detail.event.decorations, false);
});

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64");
test("uploaded photos are private, persist with events and cannot be borrowed by a different event", async () => {
  const { admin, event, place, guest } = await setup();
  const upload = await admin("/media", "POST", new Blob([pixel], { type: "image/png" }), 201);
  assert.equal((await admin.image(upload.url)).status, 200, "Organiser can preview a pending photo");
  assert.equal((await guest.image(upload.url)).status, 404, "Pending uploads aren't visible to guests");
  assert.equal((await client().image(upload.url)).status, 403);
  await admin(`/events/${event.id}/locations/${place.id}`, "PUT", { ...locationData, imageUrls: [upload.url] });
  const image = await guest.image(upload.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), pixel);
  const other = await setup();
  await other.admin(`/events/${other.event.id}`, "PUT", { ...eventData, status: "open", coverUrl: upload.url }, 400);
  assert.equal((await other.guest.image(upload.url)).status, 404);
  await admin(`/events/${event.id}/locations/${place.id}`, "PUT", locationData);
  assert.equal((await admin.image(upload.url)).status, 404, "Unreferenced saved photos are cleaned up");
});

test("uploads reject active content, invalid bytes, over-sized files and exhausted storage", async () => {
  const { admin, guest } = await setup();
  await guest("/media", "POST", new Blob([pixel], { type: "image/png" }), 403);
  await admin("/media", "POST", new Blob(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], { type: "image/svg+xml" }), 400);
  await admin("/media", "POST", new Blob(["not a photo"], { type: "image/png" }), 400);
  await admin("/media", "POST", new Blob([new Uint8Array(385 * 1024)], { type: "image/png" }), 413);
  const database = await mf.getD1Database("DB");
  const quotaId = crypto.randomUUID();
  await database.prepare("INSERT INTO media (id,event_id,mime,bytes,size,created_at) VALUES (?,NULL,'image/png',?,104857600,?)")
    .bind(quotaId, pixel.buffer.slice(pixel.byteOffset, pixel.byteOffset + pixel.byteLength), Date.now()).run();
  try { await admin("/media", "POST", new Blob([pixel], { type: "image/png" }), 507); }
  finally { await database.prepare("DELETE FROM media WHERE id=?").bind(quotaId).run(); }
});

test("Maps extraction prefills place names, embedded addresses and exact coordinates", async () => {
  const { admin, event } = await setup();
  const result = await admin("/maps/resolve", "POST", {
    url: "https://maps.google.com/?q=Scarpetta,+Rantzausgade+7,+2200+K%C3%B8benhavn",
  });
  assert.equal(result.name, "Scarpetta");
  assert.equal(result.address, "Rantzausgade 7, 2200 København");
  const coordinates = await admin("/maps/resolve", "POST", {
    url: "https://www.google.com/maps/place/Scarpetta/@55.68,12.55,17z/data=!3d55.6854542!4d12.5523098",
  });
  assert.equal(coordinates.latitude, 55.6854542);
  assert.equal(coordinates.longitude, 12.5523098);
  const location = await admin(`/events/${event.id}/locations`, "POST", {
    ...locationData, latitude: coordinates.latitude, longitude: coordinates.longitude, placeId: "a-place-id",
  }, 201);
  const saved = (await admin(`/events/${event.id}`)).locations.find((item) => item.id === location.id);
  assert.equal(saved.latitude, coordinates.latitude);
  assert.equal(saved.placeId, "a-place-id");
  await client()("/maps/resolve", "POST", { url: locationData.mapsUrl }, 403);
});

test("sharing-link resolution follows only permitted Maps redirects with bounded hops", async () => {
  let calls = 0;
  const found = await maps.resolveMapsLink("https://maps.app.goo.gl/test", async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "https://www.google.com/maps/place/Llama/" } });
  });
  assert.equal(found.name, "Llama");
  assert.equal(calls, 1, "Do not fetch or scrape the final Maps page");
  calls = 0;
  await assert.rejects(maps.resolveMapsLink("https://maps.app.goo.gl/test", async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  }), /outside Google Maps/);
  assert.equal(calls, 1, "Never follow an external or private-network redirect");
  calls = 0;
  await assert.rejects(maps.resolveMapsLink("https://maps.app.goo.gl/test", async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "https://maps.app.goo.gl/again" } });
  }), /too many times/);
  assert.equal(calls, 4);
  assert.equal(maps.parseMapsLink("https://maps.google.com/?q=55.67,12.57").name, "", "Don't invent a name from coordinates");
});

  test("TomTom venue search caches candidates and keeps credentials away from public websites", async () => {
    const { admin } = await setup();
    tomtomFixture = [{
      id: "harbour-kitchen", type: "poi", title: "Harbour Kitchen",
      position: { type: "Point", coordinates: [12.57, 55.67] },
      address: { street: "Harbour Street", houseNumber: "7", postalCode: "1200", municipality: "Copenhagen", country: "Denmark" },
      contacts: [{ websites: ["http://venue.example.org/"] }],
    }];
    const input = { mapsUrl: "https://www.google.com/maps/place/Harbour+Kitchen/", area: "Copenhagen" };
    const found = await admin("/places/search", "POST", input);
    assert.equal(found.candidates[0].name, "Harbour Kitchen");
    assert.equal(found.candidates[0].address, "Harbour Street 7, 1200 Copenhagen, Denmark");
    assert.equal(found.candidates[0].websiteUrl, "https://venue.example.org/");
    assert.equal(found.candidates[0].id, "harbour-kitchen");
    assert.equal(found.candidates[0].osmUrl, "");
    await admin("/places/search", "POST", input);
    assert.equal(providerRequests.length, 1, "Repeat searches must use the cache");
    assert.equal(publicRequests.length, 0, "Never send provider credentials to the venue reader");
    assert.equal(providerRequests[0].tomtomKey, "test-only-tomtom-key");
    assert.equal(providerRequests[0].authorization, null);
    assert.equal(providerRequests[0].version, "3");
    assert.equal(new URL(providerRequests[0].url).hostname, "api.tomtom.com");
    assert.equal(new URL(providerRequests[0].url).search, "");
    assert.match(providerRequests[0].body.query, /Copenhagen/);
    const db = await mf.getD1Database("DB");
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM provider_usage").first()).count, 1);
    await db.prepare("UPDATE import_locks SET next_at=?").bind(Date.now() + 10000).run();
    await admin("/places/search", "POST", { ...input, area: "Another city" }, 429);
    assert.equal(providerRequests.length, 1);
    await client()("/places/search", "POST", input, 403);
  });

  test("website import extracts structured venue data, menu links and photo suggestions without importing ratings", async () => {
    const { admin, event, place, guest } = await setup();
    websiteFixture = `<html><head><meta property="og:title" content="Harbour Kitchen">
      <meta property="og:image" content="/interior.png"><meta name="description" content="A relaxed kitchen by the water.">
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Restaurant", name: "Harbour Kitchen", description: "Seasonal fish and vegetables.",
        address: { streetAddress: "Harbour Street 7", postalCode: "1200", addressLocality: "Copenhagen", addressCountry: "Denmark" },
        image: ["https://venue.example.org/dish.png"], hasMenu: "/dinner",
        aggregateRating: { ratingValue: 5, reviewCount: 100 },
      })}</script></head><body><a href="/menu.pdf">Evening menu</a></body></html>`;
    const preview = await admin("/places/website", "POST", { url: "https://venue.example.org/", placeName: "Harbour Kitchen" });
    assert.equal(preview.name, "Harbour Kitchen");
    assert.equal(preview.description, "Seasonal fish and vegetables.");
    assert.equal(preview.address, "Harbour Street 7, 1200 Copenhagen, Denmark");
    assert.deepEqual(preview.images, ["https://venue.example.org/dish.png", "https://venue.example.org/interior.png"]);
    assert.equal(preview.menus[0].url, "https://venue.example.org/dinner");
    assert.equal("rating" in preview, false);
    const requests = publicRequests.length;
    await admin("/places/website", "POST", { url: "https://venue.example.org/", placeName: "Harbour Kitchen" });
    assert.equal(publicRequests.length, requests, "Website previews must be cached too");
    await admin(`/events/${event.id}/locations/${place.id}`, "PUT", {
      ...locationData, websiteUrl: preview.url, osmUrl: "https://www.openstreetmap.org/node/12345", description: preview.description,
    });
    const saved = (await guest(`/events/${event.id}`)).locations[0];
    assert.equal(saved.websiteUrl, preview.url);
    assert.equal(saved.osmUrl, "https://www.openstreetmap.org/node/12345");
    await guest("/places/website", "POST", { url: "https://venue.example.org/" }, 403);
  });

  test("website reading respects robots exclusions and rejects private targets", async () => {
    const { admin } = await setup();
    robotsFixture = "User-agent: *\nDisallow: /private";
    await admin("/places/website", "POST", { url: "https://venue.example.org/private" }, 422);
    assert.equal(publicRequests.filter((request) => !request.url.endsWith("/robots.txt")).length, 0);
    await admin("/places/website", "POST", { url: "https://127.0.0.1/" }, 400);
    await admin("/places/website", "POST", { url: "https://localhost/" }, 400);
    await admin("/places/website", "POST", { url: "https://service.internal/" }, 400);
    assert.equal(publicRequests.length, 1);
  });

test("website pages up to two megabytes import, but oversized pages are still rejected", async () => {
  const { admin } = await setup();
  const metadata = '<html><head><title>A larger restaurant page</title><meta name="description" content="Seasonal dining."></head></html>';
  websiteFixture = " ".repeat(2000000 - Buffer.byteLength(metadata)) + metadata;
  const preview = await admin("/places/website", "POST", { url: "https://venue.example.org/large" });
  assert.equal(preview.name, "A larger restaurant page");
  assert.equal(preview.description, "Seasonal dining.");
  websiteFixture += " ";
  await admin("/places/website", "POST", { url: "https://venue.example.org/too-large" }, 413);
});

test("local website reader errors retain their explanation instead of becoming an upstream status", async (t) => {
  const env = { LOCAL_DEV: "true", LOCAL_WEB_FETCH_ORIGIN: "http://127.0.0.1:8791", AUTH_SECRET: "test-only" };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: "This page or photo is too large to import." },
    { status: 502, headers: { "X-Website-Reader-Error": "1" } },
  ));
  await assert.rejects(imports.publicPage(env, "https://venue.example.org/", "html"),
    (error) => error.status === 502 && error.message === "This page or photo is too large to import.");
  fetch.mock.mockImplementation(async () => new Response("not json", {
    status: 502, headers: { "X-Website-Reader-Error": "1" },
  }));
  await assert.rejects(imports.publicPage(env, "https://venue.example.org/", "html"),
    (error) => error.status === 502 && /unreadable error/.test(error.message));
});

  test("the connection-time network guard rejects private/reserved addresses and unusual URLs", async () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "192.168.0.1", "172.16.0.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::"]) {
      assert.equal(isPublicAddress(address), false, address);
    }
    for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(address), true, address);
    for (const url of ["http://venue.example.org", "https://localhost", "https://127.0.0.1", "https://2130706433", "https://[::1]",
      "https://user:pass@venue.example.org", "https://venue.example.org:8443", "https://site.local/"]) assert.throws(() => publicUrl(url));
    const denied = await new Promise((resolve) => publicLookup("localhost", { all: true }, (error) => resolve(error)));
    assert.equal(denied.code, "PUBLIC_ONLY");
  });

test("provider backoff is honoured across later searches", async () => {
  const { admin } = await setup();
  tomtomStatus = 429;
  const input = { mapsUrl: "https://www.google.com/maps/place/Harbour+Kitchen/", area: "Copenhagen" };
  await admin("/places/search", "POST", input, 429);
  const lock = await (await mf.getD1Database("DB")).prepare("SELECT next_at FROM import_locks WHERE provider='tomtom'").first();
  assert.ok(lock.next_at > Date.now() + 110000);
  await admin("/places/search", "POST", { ...input, area: "Another city" }, 429);
  assert.equal(providerRequests.length, 1);
});

test("TomTom uses Maps coordinates to bias branch selection without guessing a city", async () => {
  const { admin } = await setup();
  await admin("/places/search", "POST", { mapsUrl: "https://www.google.com/maps/place/Harbour+Kitchen/@55.67,12.57,18z/" });
  const body = providerRequests[0].body;
  assert.deepEqual(body.origin.coordinates, [12.57, 55.67]);
  assert.deepEqual(body.preferences.geometry.coordinates, [12.57, 55.67]);
  assert.equal(body.query.trim(), "Harbour Kitchen");
});

test("website discovery searches the known domain first and never fetches or applies a result", async () => {
  const { admin, guest } = await setup();
  tavilyDomainFixture = [
    { title: "Wrong site", url: "https://venue.example.org.evil.com/", content: "A different place." },
    { title: "Harbour Kitchen", url: "https://venue.example.org/current", content: "Harbour Street 7, Copenhagen." },
    { title: "Private target", url: "https://127.0.0.1/", content: "Do not import." },
  ];
  const input = {
    name: "Harbour Kitchen", address: "Harbour Street 7, Copenhagen",
    websiteUrl: "https://www.venue.example.org/obsolete?token=private-invite",
  };
  const found = await admin("/places/websites", "POST", input);
  assert.equal(found.domain, "venue.example.org");
  assert.equal(found.broadened, false);
  assert.deepEqual(found.candidates.map((item) => item.url), ["https://venue.example.org/current"]);
  assert.equal(publicRequests.length, 0, "Website search is not website acceptance or metadata reading");
  const request = providerRequests[0];
  assert.deepEqual(request.body.include_domains, ["venue.example.org"]);
  assert.equal(request.body.search_depth, "basic");
  assert.equal(request.body.include_answer, false);
  assert.equal(request.body.include_raw_content, false);
  assert.equal(request.body.include_images, false);
  assert.equal(request.authorization, "Bearer test-only-tavily-key");
  assert.equal(request.tomtomKey, null);
  assert.ok(!JSON.stringify(request.body).includes("private-invite"));
  await admin("/places/websites", "POST", input);
  assert.equal(providerRequests.length, 1, "Repeated suggestions must use the cache");
  assert.equal((await (await mf.getD1Database("DB")).prepare("SELECT COUNT(*) AS count FROM provider_usage").first()).count, 1);
  await guest("/places/websites", "POST", input, 403);
  await client()("/places/websites", "POST", input, 403);
  assert.equal(providerRequests.length, 1);
});

test("empty domain results broaden at most once and both calls stay basic", async () => {
  const { admin } = await setup();
  tavilyBroadFixture = [{ title: "Harbour Kitchen", url: "https://new-venue.example.org/", content: "Check this branch." }];
  const input = { name: "Harbour Kitchen", websiteUrl: "https://old-venue.example.org/" };
  const found = await admin("/places/websites", "POST", input);
  assert.equal(found.domain, null);
  assert.equal(found.broadened, true);
  assert.equal(found.candidates[0].url, "https://new-venue.example.org/");
  assert.equal(providerRequests.length, 2);
  assert.deepEqual(providerRequests[0].body.include_domains, ["old-venue.example.org"]);
  assert.ok(!providerRequests[1].body.include_domains?.length);
  assert.ok(providerRequests.every((request) => request.body.search_depth === "basic"));
  await admin("/places/websites", "POST", input);
  assert.equal(providerRequests.length, 2);
  assert.equal((await (await mf.getD1Database("DB")).prepare("SELECT COUNT(*) AS count FROM provider_usage").first()).count, 2);
});

test("a wider website search is explicit and remains an unverified suggestion", async () => {
  const { admin } = await setup();
  tavilyDomainFixture = [{ title: "Old venue site", url: "https://venue.example.org/", content: "" }];
  tavilyBroadFixture = [{ title: "A venue with the same name", url: "https://elsewhere.example.org/", content: "Possibly a different city." }];
  const input = { name: "Harbour Kitchen", websiteUrl: "https://venue.example.org/" };
  const narrow = await admin("/places/websites", "POST", input);
  assert.equal(narrow.candidates.length, 1);
  assert.equal(providerRequests.length, 1, "Do not broaden automatically after nonempty domain results");
  await (await mf.getD1Database("DB")).prepare("UPDATE import_locks SET next_at=0,locked_until=0").run();
  const broad = await admin("/places/websites", "POST", { ...input, broader: true });
  assert.equal(broad.domain, null);
  assert.equal(broad.broadened, true);
  assert.equal(broad.candidates[0].url, "https://elsewhere.example.org/");
  assert.equal(publicRequests.length, 0);
});

test("website discovery rejects invalid names and private domain hints before contacting a provider", async () => {
  const { admin } = await setup();
  await admin("/places/websites", "POST", { name: "", websiteUrl: "https://venue.example.org/" }, 400);
  await admin("/places/websites", "POST", { name: "Harbour", websiteUrl: "https://127.0.0.1/" }, 400);
  await admin("/places/websites", "POST", { name: "Harbour", websiteUrl: "https://service.internal/" }, 400);
  await admin("/places/websites", "POST", { name: "Harbour", participantToken: "must-not-leak" }, 400);
  assert.equal(providerRequests.length, 0);
});

test("provider authentication, malformed data and redirects are explicit failures, not empty successes", async () => {
  const { admin } = await setup();
  const input = { mapsUrl: "https://www.google.com/maps/place/Harbour+Kitchen/", area: "Copenhagen" };
  tomtomStatus = 401;
  const failure = await admin("/places/search", "POST", input, 503);
  assert.ok(!JSON.stringify(failure).includes("test-only-tomtom-key"));
  assert.doesNotMatch(failure.error, /TomTom|Tavily|provider|credentials/i);
  const db = await mf.getD1Database("DB");
  await db.prepare("DELETE FROM import_locks").run();
  tomtomStatus = 200; malformedLookup = true;
  const malformed = await admin("/places/search", "POST", input, 502);
  assert.doesNotMatch(malformed.error, /TomTom|Tavily/);
  await db.prepare("DELETE FROM import_locks").run();
  malformedLookup = false; tomtomFixture = [{ bad: "response" }];
  const invalid = await admin("/places/search", "POST", input, 502);
  assert.doesNotMatch(invalid.error, /TomTom|Tavily/);
  await db.prepare("DELETE FROM import_locks").run();
  tomtomFixture = []; tomtomStatus = 302;
  await admin("/places/search", "POST", input, 502);
  assert.equal(providerRequests.length, 4);
  tavilyDomainFixture = [{ bad: "response" }];
  const websiteFailure = await admin("/places/websites", "POST", { name: "Harbour", websiteUrl: "https://venue.example.org/" }, 502);
  assert.doesNotMatch(websiteFailure.error, /TomTom|Tavily/);
  assert.equal(publicRequests.length, 0);
});

test("website provider throttling is surfaced without trying an extra paid-search path", async () => {
  const { admin } = await setup();
  tavilyStatus = 429;
  const input = { name: "Harbour Kitchen", websiteUrl: "https://venue.example.org/" };
  await admin("/places/websites", "POST", input, 429);
  await admin("/places/websites", "POST", input, 429);
  assert.equal(providerRequests.length, 1);
  const lock = await (await mf.getD1Database("DB")).prepare("SELECT next_at FROM import_locks WHERE provider='tavily'").first();
  assert.ok(lock.next_at > Date.now() + 110000);
});

async function fillUsage(provider, count, timestamp = Date.now()) {
  const db = await mf.getD1Database("DB");
  await db.prepare(`WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<?)
    INSERT INTO provider_usage(id,provider,requested_at) SELECT ?||value,?,? FROM n`)
    .bind(count, `${provider}-test-`, provider, timestamp).run();
}

test("the persistent rolling website-search budget blocks request 901 without contacting Tavily", async () => {
  const { admin } = await setup();
  await fillUsage("tavily", 900);
  const result = await admin("/places/websites", "POST", { name: "Harbour Kitchen" }, 429);
  assert.match(result.error, /budget|allowance|limit/i);
  assert.doesNotMatch(result.error, /TomTom|Tavily/);
  assert.equal(providerRequests.length, 0);
});

test("the TomTom budget is independent and blocks request 4501 before external work", async () => {
  const { admin } = await setup();
  await fillUsage("tomtom", 4500);
  const result = await admin("/places/search", "POST", { mapsUrl: "https://www.google.com/maps/place/Harbour+Kitchen/" }, 429);
  assert.doesNotMatch(result.error, /TomTom|Tavily/);
  assert.equal(providerRequests.length, 0);
});

test("cached website suggestions remain available when the rolling budget is exhausted", async () => {
  const { admin } = await setup();
  tavilyBroadFixture = [{ title: "Harbour Kitchen", url: "https://venue.example.org/", content: "Copenhagen." }];
  const input = { name: "Harbour Kitchen" };
  const first = await admin("/places/websites", "POST", input);
  await fillUsage("tavily", 899);
  const cached = await admin("/places/websites", "POST", input);
  assert.deepEqual(cached, first);
  assert.equal(providerRequests.length, 1);
});

test("expired rolling-budget reservations no longer block a basic lookup", async () => {
  const { admin } = await setup();
  await fillUsage("tavily", 900, Date.now() - 32 * 86400000);
  await admin("/places/websites", "POST", { name: "Harbour Kitchen" });
  assert.equal(providerRequests.length, 1);
  assert.equal((await (await mf.getD1Database("DB")).prepare("SELECT COUNT(*) AS count FROM provider_usage WHERE requested_at>?")
    .bind(Date.now() - 31 * 86400000).first()).count, 1);
});

test("concurrent website requests cannot spend the last budget slot twice", async () => {
  const db = await mf.getD1Database("DB");
  await fillUsage("tavily", 899);
  let calls = 0;
  const env = {
    DB: db, TAVILY_API_KEY: "test-only-tavily-key",
    LOOKUP_API: { fetch: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return Response.json({ results: [{ title: "Harbour", url: "https://venue.example.org/", content: "Public venue." }] });
    } },
  };
  const outcomes = await Promise.allSettled([
    providers.findWebsites(env, { name: "First venue", address: "", area: "", websiteUrl: "", broader: false }),
    providers.findWebsites(env, { name: "Second venue", address: "", area: "", websiteUrl: "", broader: false }),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM provider_usage WHERE provider='tavily'").first()).count, 900);
});

test("missing provider configuration fails explicitly without making a request", async () => {
  const db = await mf.getD1Database("DB");
  const map = { resolvedUrl: "https://www.google.com/maps/place/Harbour/", name: "Harbour", address: "", latitude: null, longitude: null, placeId: "" };
  await assert.rejects(providers.findVenues({ DB: db }, map, "Harbour", "Copenhagen"),
    (error) => error.status === 503 && !/TomTom|Tavily/.test(error.message));
  await assert.rejects(providers.findWebsites({ DB: db }, { name: "Harbour", address: "", area: "", websiteUrl: "", broader: false }),
    (error) => error.status === 503 && !/TomTom|Tavily/.test(error.message));
  assert.equal(providerRequests.length, 0);
});

test("both provider transports explicitly disable redirects and reject an external destination", async () => {
  const db = await mf.getD1Database("DB");
  const seen = [];
  const env = {
    DB: db, TOMTOM_API_KEY: "test-only-tomtom-key", TAVILY_API_KEY: "test-only-tavily-key",
    LOOKUP_API: { fetch: async (url, init) => {
      const target = new URL(url);
      assert.ok(["api.tomtom.com", "api.tavily.com"].includes(target.hostname));
      assert.equal(init.redirect, "manual");
      seen.push(target.hostname);
      return new Response(null, { status: 302, headers: { Location: "https://outside.example.org/should-not-be-followed" } });
    } },
  };
  const map = { resolvedUrl: "https://www.google.com/maps/place/Harbour/", name: "Harbour", address: "", latitude: null, longitude: null, placeId: "" };
  await assert.rejects(providers.findVenues(env, map, "Harbour", "Copenhagen"), (error) => error.status === 502);
  await assert.rejects(providers.findWebsites(env, { name: "Harbour", address: "", area: "", websiteUrl: "", broader: false }),
    (error) => error.status === 502);
  assert.deepEqual(seen, ["api.tomtom.com", "api.tavily.com"]);
  assert.equal(publicRequests.length, 0);
});

test("website redirects cannot target private-network URLs", async () => {
  const { admin } = await setup();
  websiteRedirect = "https://127.0.0.1/private";
  await admin("/places/website", "POST", { url: "https://venue.example.org/redirect" }, 400);
  assert.equal(publicRequests.some((request) => new URL(request.url).hostname === "127.0.0.1"), false);
});

test("event city persists in details and lists, can be edited, and does not affect saved ratings", async () => {
  const { admin, event, place, guest } = await setup();
  assert.equal(event.city, "", "Existing API clients can omit a default city");
  await guest(`/events/${event.id}/ratings/${place.id}`, "PUT", { score: 4 });
  await admin(`/events/${event.id}`, "PUT", { ...eventData, status: "open", city: " Copenhagen " });
  assert.equal((await guest(`/events/${event.id}`)).event.city, "Copenhagen");
  assert.equal((await admin("/events")).find((item) => item.id === event.id).city, "Copenhagen");
  await admin(`/events/${event.id}`, "PUT", { ...eventData, status: "open", city: "Aarhus" });
  const updated = await guest(`/events/${event.id}`);
  assert.equal(updated.event.city, "Aarhus");
  assert.equal(updated.myRatings[place.id], 4);
  await admin("/events", "POST", { ...eventData, city: "x".repeat(121) }, 400);
});
