import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "wrangler.production.jsonc");
const secretPath = resolve(root, ".production.secrets.local");
const config = JSON.parse(await readFile(configPath, "utf8"));
const authPath = resolve(process.env.APPDATA || "", "xdg.config", ".wrangler", "config", "default.toml");
const auth = await readFile(authPath, "utf8");
const access = auth.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!access) throw new Error("Sign in to the deployment CLI before continuing.");
const privateValues = [access];
const redact = (value) => privateValues.reduce((text, secret) => text.split(secret).join("[redacted]"), String(value));
const account = config.account_id;
const database = config.d1_databases[0];
if (config.name !== "date-night" || config.vars.LOCAL_DEV !== "false"
  || config.vars.APP_ORIGIN !== "https://date-night.onbuyuka.workers.dev"
  || database.database_name !== "date-night-production") throw new Error("Production target does not match the approved installation.");

async function readVariables(path, allowMissing = false) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (allowMissing && error.code === "ENOENT") return {};
    throw error;
  }
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => /^[A-Z_]+\s*=/.test(line)).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(["'])(.*)\1$/, "$2")];
  }));
}
async function cloud(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    const messages = data.errors?.map((error) => `${error.code}: ${error.message}`).join("; ") || "request failed";
    throw new Error(redact(`Hosting request failed (HTTP ${response.status}): ${messages}`));
  }
  return data.result;
}
function cli(args) {
  const result = spawnSync(process.execPath, [resolve(root, "node_modules", "wrangler", "bin", "wrangler.js"), ...args], {
    cwd: root, encoding: "utf8", timeout: 180000,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false" },
  });
  if (result.stdout) console.log(redact(result.stdout));
  if (result.status !== 0) throw new Error(redact(result.stderr || result.error?.message || "Deployment command failed."));
}
async function query(sql, params = []) {
  const results = await cloud(`d1/database/${database.database_id}/query`, {
    method: "POST", body: JSON.stringify({ sql, params }),
  });
  const result = results[0];
  if (!result?.success) throw new Error("Production database operation failed.");
  return result;
}
async function prepare() {
  const dev = await readVariables(resolve(root, ".dev.vars"));
  const reader = await readVariables(resolve(root, ".reader.vars.local"));
  const previous = await readVariables(secretPath, true);
  const secrets = {
    AUTH_SECRET: previous.AUTH_SECRET || randomBytes(32).toString("hex"),
    WEB_READER_SECRET: reader.WEB_READER_SECRET,
    TOMTOM_API_KEY: dev.TOMTOM_API_KEY,
    TAVILY_API_KEY: dev.TAVILY_API_KEY,
  };
  if (Object.values(secrets).some((value) => !value || value.length < 20)) throw new Error("A production service credential is missing.");
  if (secrets.AUTH_SECRET === dev.AUTH_SECRET) throw new Error("Production must not reuse the local authentication secret.");
  privateValues.push(...Object.values(secrets));
  const check = await fetch(`${config.vars.WEB_READER_ORIGIN}/fetch`, {
    method: "POST", headers: { Authorization: secrets.WEB_READER_SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://cofoco.dk/robots.txt", mode: "text" }),
    redirect: "manual", signal: AbortSignal.timeout(95000),
  });
  if (!check.ok) { await check.body?.cancel(); throw new Error(`Reader connection failed (HTTP ${check.status}).`); }
  await check.body?.cancel();
  await writeFile(secretPath, `${Object.entries(secrets).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });
  const databases = await cloud("d1/database?per_page=100");
  let match = databases.find((item) => item.name === database.database_name);
  if (!match) match = await cloud("d1/database", { method: "POST", body: JSON.stringify({ name: database.database_name, primary_location_hint: "weur" }) });
  if (!match.uuid) throw new Error("The new production database did not return an identifier.");
  database.database_id = match.uuid;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  cli(["d1", "migrations", "apply", database.database_name, "--remote", "--config", configPath]);
  const counts = await query("SELECT (SELECT COUNT(*) FROM organisers) AS accounts,(SELECT COUNT(*) FROM events) AS events");
  console.log(JSON.stringify({ productionDatabaseReady: true, existingRecords: counts.results[0], localDataCopied: false, privateSecretFile: ".production.secrets.local" }));
}
async function deploy() {
  const secrets = await readVariables(secretPath);
  const keys = ["AUTH_SECRET", "WEB_READER_SECRET", "TOMTOM_API_KEY", "TAVILY_API_KEY"];
  if (keys.some((key) => !secrets[key])) throw new Error("Prepare production credentials first.");
  privateValues.push(...Object.values(secrets));
  const { readdir } = await import("node:fs/promises");
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else {
        const content = await readFile(path, "utf8");
        if (privateValues.some((value) => content.includes(value))) throw new Error("A private credential was found in the browser output.");
      }
    }
  }
  await scan(resolve(root, "dist"));
  cli(["deploy", "--config", configPath, "--secrets-file", secretPath]);
  console.log(JSON.stringify({ appUrl: config.vars.APP_ORIGIN, secretsUploadedPrivately: true }));
}
async function privateOwnerLink(reset) {
  const accounts = await query("SELECT id,username FROM organisers WHERE role='owner'");
  const owner = accounts.results[0];
  if (reset && !owner) throw new Error("The owner has not activated an account yet.");
  if (!reset && owner) throw new Error("An owner already exists. Use owner-reset only if account recovery is needed.");
  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  const kind = reset ? "reset" : "owner";
  const now = Date.now();
  await query("UPDATE account_invitations SET revoked_at=? WHERE kind=? AND used_at IS NULL AND revoked_at IS NULL AND (target_organiser_id=? OR kind='owner')",
    [now, kind, owner?.id ?? null]);
  const inserted = await query(`INSERT INTO account_invitations
    (id,kind,name,token_hash,target_organiser_id,created_by,created_at,expires_at)
    VALUES (?,?,?,?,?,NULL,?,?)`,
  [randomUUID(), kind, reset ? owner.username : "Your planner", hash, owner?.id ?? null,
    new Date(now).toISOString(), now + (reset ? 1800000 : 86400000)]);
  if (inserted.meta.changes !== 1) throw new Error("A private owner link could not be created.");
  const link = `${config.vars.APP_ORIGIN}/#/${reset ? "reset" : "join"}/${raw}`;
  const filename = reset ? ".owner-reset.local.html" : ".owner-invitation.local.html";
  await writeFile(resolve(root, filename), `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Private owner ${reset ? "recovery" : "invitation"}</title><h1>Your private owner link</h1><p>This link is single-use. Do not share it.</p><a href="${link}">Open the planner to ${reset ? "reset your password" : "create your owner account"}</a>`, { mode: 0o600 });
  console.log(JSON.stringify({ privateOwnerLinkFile: filename, expiresInHours: reset ? 0.5 : 24, linkPrinted: false }));
}

try {
  switch (process.argv[2]) {
    case "prepare": await prepare(); break;
    case "deploy": await deploy(); break;
    case "owner-link": await privateOwnerLink(false); break;
    case "owner-reset": await privateOwnerLink(true); break;
    default: throw new Error("Choose prepare, deploy, owner-link, or owner-reset.");
  }
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : "Production operation failed."));
  process.exitCode = 1;
}
