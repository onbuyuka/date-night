import { isMapsUrl, type MapDetails } from "../shared/model";
import { HttpError } from "./support";

export function parseMapsLink(value: string): MapDetails {
  if (!isMapsUrl(value)) throw new HttpError(400, "Paste a Google Maps link.");
  const url = new URL(value);
  const result: MapDetails = { resolvedUrl: value, name: "", address: "", latitude: null, longitude: null, placeId: "" };
  const place = url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
  if (place) {
    try { result.name = decodeURIComponent(place.replace(/\+/g, " ")); }
    catch (error) {
      if (!(error instanceof URIError)) throw error;
      throw new HttpError(400, "That Maps link contains an invalid place name.");
    }
  }
  const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
  if (!result.name && query && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(query) && !query.startsWith("place_id:")) {
    const parts = query.split(",").map((part) => part.trim());
    result.name = parts.shift() ?? "";
    result.address = parts.join(", ");
  }
  const coords = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    ?? query.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/)
    ?? url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (coords) {
    const lat = Number(coords[1]); const lng = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { result.latitude = lat; result.longitude = lng; }
  }
  result.placeId = url.searchParams.get("query_place_id") || url.searchParams.get("place_id")
    || (query.startsWith("place_id:") ? query.slice(9) : "");
  result.name = result.name.slice(0, 120);
  result.address = result.address.slice(0, 250);
  result.placeId = result.placeId.slice(0, 250);
  return result;
}
export async function resolveMapsLink(value: string, fetcher: typeof fetch = fetch): Promise<MapDetails> {
  let current = value;
  for (let hop = 0; hop < 4; hop++) {
    if (!isMapsUrl(current)) throw new HttpError(400, "The link redirects outside Google Maps. Please copy the place’s sharing link again.");
    const url = new URL(current);
    if (!["maps.app.goo.gl", "goo.gl"].includes(url.hostname)) return parseMapsLink(current);
    let response: Response;
    try { response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(4000) }); }
    catch (error) {
      console.error("Maps sharing-link resolution failed", error instanceof Error ? error.name : "network error");
      throw new HttpError(502, "We couldn’t open that sharing link. Try the full Google Maps link, or enter the place name below.");
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (response.status < 300 || response.status >= 400 || !location) {
      throw new HttpError(422, "This sharing link did not identify a place. Try its full Maps link or enter the name below.");
    }
    current = new URL(location, current).href;
  }
  throw new HttpError(422, "That sharing link redirects too many times. Try the full place link.");
}
