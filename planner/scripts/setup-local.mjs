import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../.dev.vars", import.meta.url);
let contents = "";
try { contents = await readFile(path, "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (!/^AUTH_SECRET=.+$/m.test(contents)) {
  await writeFile(path, `${contents.trimEnd()}\nAUTH_SECRET=${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  console.log("Local authentication key created. It is ignored by Git.");
} else {
  console.log("Local authentication key is ready.");
}
