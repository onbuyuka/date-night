import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const secret = "e2e-only-authentication-secret-not-a-real-key";
function chunk(name, data) {
  const type = Buffer.from(name);
  const payload = Buffer.concat([type, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 2;
const pixels = Buffer.alloc(16 * 49, 200);
for (let row = 0; row < 16; row++) pixels[row * 49] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
function venueHtml(name = "Harbour Kitchen") {
  return `<html><head><meta property="og:image" content="/kitchen.png">
<script type="application/ld+json">${JSON.stringify({
  "@type": "Restaurant", name, description: "Fresh fish, seasonal vegetables, and a relaxed room.",
  address: { streetAddress: "Harbour Street 7", postalCode: "1200", addressLocality: "Copenhagen", addressCountry: "Denmark" },
  hasMenu: "/dinner",
})}</script></head><body><a href="/dinner">Dinner menu</a></body></html>`;
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") { response.writeHead(200).end("ready"); return; }
  const tomtom = request.url === "/maps/orbis/places/discover";
  const tavily = request.url === "/search";
  const allowed = tomtom ? request.headers["tomtom-api-key"] === "e2e-only-tomtom-key"
    : tavily ? request.headers.authorization === "Bearer e2e-only-tavily-key"
    : request.url === "/fetch" && request.headers.authorization === secret;
  if (request.method !== "POST" || !allowed) { response.writeHead(403).end(); return; }
  try {
    let body = "";
    for await (const chunk of request) { body += chunk.toString(); if (body.length > 6000) throw new Error("request too large"); }
    const input = JSON.parse(body);
    if (tomtom) {
      const recovery = (input.query || "").includes("Recovery");
      const found = recovery || (input.query || "").includes("Harbour");
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        results: found ? [{
          id: recovery ? "recovery-kitchen" : "harbour-kitchen", type: "poi",
          title: recovery ? "Recovery Kitchen" : "Harbour Kitchen",
          position: { type: "Point", coordinates: [12.57, 55.67] },
          address: { street: "Harbour Street", houseNumber: "7", postalCode: "1200", municipality: "Copenhagen", country: "Denmark" },
          contacts: [{ websites: [recovery ? "https://venue.example.org/obsolete" : "https://venue.example.org/"] }],
        }] : [],
      }));
      return;
    }
    if (tavily) {
      if (input.search_depth !== "basic" || input.include_answer || input.include_images || input.include_raw_content) {
        throw new Error("Only the agreed basic search is allowed.");
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        results: [
          { title: "A different venue abroad", url: "https://outside.example.org/", content: "Not the selected branch." },
          { title: "Recovery Kitchen - official venue", url: "https://venue.example.org/recovered",
            content: "Harbour Street 7, Copenhagen. Review this venue before importing." },
        ],
      }));
      return;
    }
    const { url: value } = input;
    const url = new URL(value);
    if (url.hostname === "venue.example.org" && url.pathname === "/kitchen.png") {
      response.writeHead(200, { "Content-Type": "image/png" }).end(png);
    } else if (url.hostname === "venue.example.org" && url.pathname === "/obsolete") {
      response.writeHead(404).end();
    } else if (url.hostname === "venue.example.org" && url.pathname !== "/robots.txt") {
      response.writeHead(200, { "Content-Type": "text/html" }).end(venueHtml(url.pathname === "/recovered" ? "Recovery Kitchen" : "Harbour Kitchen"));
    } else response.writeHead(404).end();
  } catch (error) {
    console.error("Invalid test fixture request:", error instanceof Error ? error.message : "request error");
    response.writeHead(400).end("Invalid fixture request.");
  }
}).listen(8793, "127.0.0.1", () => console.log("Test-only website fixtures ready on 8793"));
