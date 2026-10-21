import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await preview({
  root, configFile: false, base: "/", build: { outDir: "dist" },
  preview: { host: "127.0.0.1", port: 5176, strictPort: true },
});
let browser;
const origin = "http://127.0.0.1:5176";
const eventId = "demo-birthday";
const people = ["Alex", "Jamie", "Sam", "Taylor"];
const event = {
  id: eventId, organiserId: "demo-organiser", title: "A birthday worth celebrating",
  description: "Three lovely places, four favourite people. Let's find our evening.",
  city: "Copenhagen", date: "2026-11-06", occasion: "Birthday", theme: "rose",
  mood: "birthday", greeting: "Good company. A little celebration. All for you.",
  decorations: true, accent: "", coverUrl: "", status: "open",
  createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z",
};
const scores = [[5, 5, 4, 5], [4, 5, 4, 3], [3, 4, 3, 4]];
const locations = [
  { name: "The Little Garden", address: "12 Willow Lane, Copenhagen", description: "Soft light, leafy corners and a little room to linger.",
    note: "My pick for a long, unhurried evening." },
  { name: "A Table for Us", address: "8 Market Street, Copenhagen", description: "Warm colours, candlelit tables and conversation that keeps going.",
    note: "A cosy corner for the whole group." },
  { name: "The Corner Room", address: "24 Orchard Walk, Copenhagen", description: "A bright neighbourhood spot with windows onto the square.",
    note: "Somewhere new for all of us." },
].map((place, index) => ({
  ...place, id: `demo-place-${index}`, eventId, position: index,
  mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} Copenhagen`)}`,
  menuUrl: "https://example.org/demo-menu", websiteUrl: "", osmUrl: "",
  latitude: null, longitude: null, placeId: "",
  imageUrls: [`/api/media/demo-image-${index}`, `/api/media/demo-image-${(index + 1) % 3}`],
}));
const summaries = [
  { ...event, locationCount: 3, participantCount: 4, ratedParticipantCount: 4 },
  { ...event, id: "demo-friends", title: "Friday, with friends", occasion: "Dinner", mood: "friends",
    theme: "sage", date: "2026-11-13", description: "A catch-up worth putting in the calendar.",
    locationCount: 4, participantCount: 6, ratedParticipantCount: 3 },
  { ...event, id: "demo-romantic", title: "An evening just for us", occasion: "Dinner", mood: "romantic",
    theme: "sand", date: "2026-11-20", status: "draft", description: "A little surprise. A place we'll love.",
    locationCount: 2, participantCount: 2, ratedParticipantCount: 0 },
];

try {
  browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
  const artPage = await browser.newPage();
  const illustrations = [];
  for (let variant = 0; variant < 3; variant++) {
    const data = await artPage.evaluate((variant) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000; canvas.height = 640;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create demo venue artwork.");
      const palettes = [
        { wall: "#dddcc9", floor: "#bd9e80", seat: "#507364", shade: "#d3af79" },
        { wall: "#ead4ca", floor: "#b78972", seat: "#965c61", shade: "#c49b5c" },
        { wall: "#e5dac8", floor: "#b5a58b", seat: "#7b8c7a", shade: "#d2b78b" },
      ];
      const colours = palettes[variant];
      ctx.fillStyle = colours.wall; ctx.fillRect(0, 0, 1000, 640);
      ctx.fillStyle = colours.floor; ctx.beginPath(); ctx.moveTo(0, 455); ctx.lineTo(1000, 455);
      ctx.lineTo(1000, 640); ctx.lineTo(0, 640); ctx.fill();
      ctx.strokeStyle = "#ffffff22"; ctx.lineWidth = 2;
      for (let x = -700; x < 1700; x += 180) {
        ctx.beginPath(); ctx.moveTo(500 + (x - 500) * .15, 455); ctx.lineTo(x, 640); ctx.stroke();
      }
      ctx.fillStyle = "#8f9e91"; ctx.fillRect(55, 55, 350, 345);
      const light = ctx.createLinearGradient(70, 75, 390, 390);
      light.addColorStop(0, "#ecf0dc"); light.addColorStop(1, "#acbdab");
      ctx.fillStyle = light; ctx.fillRect(70, 70, 320, 315);
      ctx.strokeStyle = "#f7f1e4"; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(230, 70); ctx.lineTo(230, 385);
      ctx.moveTo(70, 230); ctx.lineTo(390, 230); ctx.stroke();
      ctx.fillStyle = colours.seat; ctx.beginPath(); ctx.roundRect(475, 340, 465, 120, 18); ctx.fill();
      ctx.fillStyle = "#26352b"; ctx.fillRect(492, 455, 16, 70); ctx.fillRect(904, 455, 16, 70);
      for (const [x, y, scale] of [[365, 460, 1], [750, 495, .85]]) {
        ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
        ctx.fillStyle = "#604f42"; ctx.fillRect(-6, 0, 12, 105);
        ctx.beginPath(); ctx.ellipse(0, 104, 50, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f1e6d2"; ctx.beginPath(); ctx.ellipse(0, 0, 130, 30, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e8d4b5"; ctx.fillRect(-8, -44, 16, 39);
        ctx.fillStyle = "#fff7cd"; ctx.beginPath(); ctx.ellipse(0, -48, 4, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = "#665945"; ctx.lineWidth = 4;
      for (const x of [565, 835]) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 140); ctx.stroke();
        ctx.fillStyle = colours.shade; ctx.beginPath(); ctx.ellipse(x, 155, 65, 28, 0, Math.PI, 0);
        ctx.lineTo(x + 65, 175); ctx.lineTo(x - 65, 175); ctx.fill();
      }
      ctx.fillStyle = "#d4b39b"; ctx.beginPath(); ctx.moveTo(70, 470); ctx.lineTo(135, 470);
      ctx.lineTo(124, 565); ctx.lineTo(81, 565); ctx.fill();
      ctx.strokeStyle = "#52644b"; ctx.lineWidth = 6;
      for (let i = 0; i < 7; i++) {
        const x = 40 + i * 21; const y = 240 + (i % 3) * 32;
        ctx.beginPath(); ctx.moveTo(102, 480); ctx.quadraticCurveTo(102, y + 100, x, y); ctx.stroke();
        ctx.fillStyle = i % 2 ? "#71836a" : "#4e7059";
        ctx.beginPath(); ctx.ellipse(x, y, 22, 48, (i - 3) * .16, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#6d7662"; ctx.fillRect(560, 210, 115, 85);
      ctx.fillStyle = "#f7ead6"; ctx.fillRect(568, 218, 99, 69);
      ctx.fillStyle = colours.seat; ctx.beginPath(); ctx.arc(618, 256, 23, 0, Math.PI * 2); ctx.fill();
      return canvas.toDataURL("image/png").split(",")[1];
    }, variant);
    illustrations.push(Buffer.from(data, "base64"));
  }
  await artPage.close();
  const errors = [];
  async function demoPage(guest = false, mobile = false) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1120 },
      deviceScaleFactor: 1, reducedMotion: "reduce", isMobile: mobile, hasTouch: mobile,
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) throw new Error(`Unexpected external screenshot request: ${url.hostname}`);
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      const media = url.pathname.match(/^\/api\/media\/demo-image-(\d)$/);
      if (media) { await route.fulfill({ status: 200, contentType: "image/png", body: illustrations[Number(media[1])] }); return; }
      if (url.pathname === "/api/session") {
        await route.fulfill({ json: guest
          ? { role: "participant", eventId, participantId: "demo-alex", name: "Alex", setupRequired: false }
          : { role: "admin", organiserId: "demo-organiser", organiserRole: "owner", name: "Demo organiser", setupRequired: false } });
        return;
      }
      if (url.pathname === "/api/events") { await route.fulfill({ json: summaries }); return; }
      const voting = url.pathname.match(/^\/api\/events\/demo-birthday\/ratings\/demo-place-(\d)$/);
      if (voting && route.request().method() === "PUT") {
        scores[Number(voting[1])][0] = route.request().postDataJSON().score;
        await route.fulfill({ json: { ok: true } }); return;
      }
      if (url.pathname === `/api/events/${eventId}`) {
        await route.fulfill({ json: {
          event, locations, participantCount: 4, completedCount: 4,
          participants: guest ? [] : people.map((name, i) => ({ id: `demo-person-${i}`, eventId, name, invited: true, ratedCount: 3 })),
          results: scores.map((votes, index) => ({
            locationId: locations[index].id, average: votes.reduce((sum, value) => sum + value, 0) / votes.length, count: votes.length,
          })),
          myRatings: guest ? Object.fromEntries(locations.map((place, i) => [place.id, scores[i][0]])) : {},
          viewer: { role: guest ? "participant" : "admin", participantId: guest ? "demo-alex" : null, name: guest ? "Alex" : "Demo organiser" },
        } }); return;
      }
      throw new Error(`Unhandled screenshot API route: ${url.pathname}`);
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  async function save(page, filename) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Screenshot must not scroll horizontally.");
    await page.screenshot({ path: resolveImage(filename), animations: "disabled" });
  }
  function resolveImage(filename) { return fileURLToPath(new URL(filename, new URL("../../docs/screenshots/", import.meta.url))); }
  const desktop = await demoPage(true);
  await desktop.setViewportSize({ width: 1440, height: 1380 });
  await desktop.goto(`${origin}/#/event/${eventId}`);
  await desktop.getByRole("heading", { name: event.title, exact: true }).waitFor();
  await save(desktop, "event-desktop.png");

  const mobile = await demoPage(true, true);
  await mobile.goto(`${origin}/#/event/${eventId}`);
  const first = mobile.locator(".place-card").first();
  await first.scrollIntoViewIfNeeded();
  await first.getByRole("button", { name: /The Little Garden: 5 out of 5/ }).click();
  await first.getByRole("button", { name: "The Little Garden: 5 out of 5", exact: true }).click();
  await first.getByText("Saved", { exact: true }).waitFor();
  await first.evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 76, behavior: "instant" }));
  await save(mobile, "voting-mobile.png");
  await mobile.getByRole("button", { name: "Ranking", exact: true }).click();
  await mobile.locator(".ranking-summary").evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 76, behavior: "instant" }));
  await save(mobile, "ranking-mobile.png");

  const organiser = await demoPage();
  await organiser.setViewportSize({ width: 1440, height: 1200 });
  await organiser.goto(origin);
  await organiser.getByRole("heading", { name: "Bring people together.", exact: true }).waitFor();
  await save(organiser, "workspace-desktop.png");
  await organiser.setViewportSize({ width: 1440, height: 1700 });
  await organiser.goto(`${origin}/#/event/${eventId}`);
  await organiser.getByRole("button", { name: "Settings", exact: true }).click();
  const moodSettings = organiser.locator(".settings-layout .form-section").nth(1);
  await moodSettings.evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 100, behavior: "instant" }));
  await moodSettings.screenshot({ path: resolveImage("customise-desktop.png"), animations: "disabled" });
  assert.deepEqual(errors, [], "Screenshots must not contain application errors.");
  console.log("Captured five product screenshots using fictional, in-memory data only.");
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
