import { useRef, useState } from "react";
import type { LocationInput, MapDetails, VenueCandidate, VenueSearch, WebsitePreview, WebsiteSearch, WebsiteSearchInput } from "../shared/model";
import { api, ApiError, importPhoto } from "./api";
import { ErrorBox, Icon, useTask } from "./ui";

export function PlaceImport({ value, eventCity = "", onChange, onBusyChange }: {
  value: LocationInput; eventCity?: string; onChange: (value: Partial<LocationInput>) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [area, setArea] = useState<string | null>(null);
  const [search, setSearch] = useState<VenueSearch | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<VenueCandidate | null>(null);
  const [suggestions, setSuggestions] = useState<WebsiteSearch | null>(null);
  const [websiteQuery, setWebsiteQuery] = useState<WebsiteSearchInput | null>(null);
  const [preview, setPreview] = useState<WebsitePreview | null>(null);
  const [notice, setNotice] = useState("");
  const [useName, setUseName] = useState(false);
  const [useAddress, setUseAddress] = useState(false);
  const [useDescription, setUseDescription] = useState(false);
  const [menu, setMenu] = useState("");
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [photoPermission, setPhotoPermission] = useState(false);
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const requestBusy = useRef(false);
  const websiteIdentity = useRef({ name: value.name, address: value.address, mapsUrl: value.mapsUrl });
  const searchTask = useTask();
  const suggestionTask = useTask();
  const websiteTask = useTask();
  const applyTask = useTask();
  const busy = working || searchTask.busy || suggestionTask.busy || websiteTask.busy || applyTask.busy;
  const hasSelection = Boolean(preview && ((useName && preview.name) || (useAddress && preview.address)
    || (useDescription && preview.description) || menu || selectedPhotos.length));

  async function withBusy(work: () => Promise<void>) {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setWorking(true);
    onBusyChange(true);
    try { await work(); }
    finally {
      requestBusy.current = false;
      setWorking(false);
      onBusyChange(false);
    }
  }
  function resetPreview() {
    setPreview(null); setUseName(false); setUseAddress(false); setUseDescription(false); setMenu("");
    setSelectedPhotos([]); setPhotoPermission(false); setFailedPhotos([]);
    applyTask.clearError();
  }
  function resetDiscovery(resetPlace = true) {
    if (resetPlace) { setSearch(null); setSelectedPlace(null); }
    setSuggestions(null); setWebsiteQuery(null); setNotice("");
    resetPreview();
    searchTask.clearError(); websiteTask.clearError(); suggestionTask.clearError();
  }
  function websiteInput(name = value.name, address = value.address, websiteUrl = value.websiteUrl): WebsiteSearchInput {
    return { name, address, websiteUrl, area: area ?? eventCity.trim(), broader: false };
  }
  async function loadSuggestions(input: WebsiteSearchInput) {
    setSuggestions(null); setWebsiteQuery(input); setNotice("");
    resetPreview();
    await suggestionTask.run(async () => {
      setSuggestions(await api<WebsiteSearch>("/places/websites", "POST", input));
    });
  }
  async function readWebsite(url = value.websiteUrl, context = websiteInput(), recover = true) {
    setNotice(""); resetPreview();
    if (recover) {
      setSuggestions(null); setWebsiteQuery(null); suggestionTask.clearError();
    }
    let recoverable = false;
    const succeeded = await websiteTask.run(async () => {
      let result: WebsitePreview;
      try { result = await api<WebsitePreview>("/places/website", "POST", { url, placeName: context.name }); }
      catch (error) {
        recoverable = error instanceof ApiError && [422, 502, 504].includes(error.status);
        throw error;
      }
      setPreview(result); setUseName(!context.name); setUseAddress(!context.address);
      setUseDescription(!value.description); setMenu(result.menus.length === 1 && !value.menuUrl ? result.menus[0].url : "");
      websiteIdentity.current = { name: context.name, address: context.address, mapsUrl: value.mapsUrl };
      onChange({ websiteUrl: result.url });
    });
    if (!succeeded && recover && recoverable && context.name.trim()) await loadSuggestions({ ...context, websiteUrl: url });
  }
  async function findWebsite(broader = false) {
    await withBusy(async () => {
      if (broader && (!websiteQuery || websiteQuery.broader || !suggestions?.domain || suggestions.broadened)) return;
      await loadSuggestions(broader && websiteQuery ? { ...websiteQuery, broader: true } : websiteInput());
    });
  }
  async function find() {
    await withBusy(async () => {
      resetDiscovery();
      await searchTask.run(async () => {
        const map = await api<MapDetails>("/maps/resolve", "POST", { url: value.mapsUrl });
        onChange({ name: value.name || map.name, address: value.address || map.address,
          latitude: map.latitude, longitude: map.longitude, placeId: map.placeId });
        if (!value.name && !map.name) throw new Error("This link only contains a map position. Enter a place name below, then search again.");
        setSearch(await api<VenueSearch>("/places/search", "POST", {
          mapsUrl: map.resolvedUrl, name: value.name || map.name,
          area: area ?? (map.address || (map.latitude !== null && map.longitude !== null ? "" : eventCity.trim() || value.address)),
        }));
      });
    });
  }
  async function choose(candidate: VenueCandidate) {
    await withBusy(async () => {
      const previous = websiteIdentity.current;
      const sameIdentity = previous.mapsUrl === value.mapsUrl
        && normalized(previous.name) === normalized(candidate.name) && normalized(previous.address) === normalized(candidate.address);
      const site = candidate.websiteUrl || (sameIdentity ? value.websiteUrl : "");
      const context = websiteInput(candidate.name, candidate.address, site);
      resetDiscovery();
      setSelectedPlace(candidate);
      onChange({ name: candidate.name, address: candidate.address, latitude: candidate.latitude, longitude: candidate.longitude,
        osmUrl: candidate.osmUrl, websiteUrl: site });
      if (candidate.websiteUrl) await readWebsite(site, context);
      else await loadSuggestions(context);
    });
  }
  async function apply() {
    if (!preview) return;
    if (selectedPhotos.length && !photoPermission) return;
    if (value.imageUrls.length + selectedPhotos.length > 6) return;
    await withBusy(async () => {
      await applyTask.run(async () => {
        const photos: string[] = [];
        for (const url of selectedPhotos) photos.push(await importPhoto(url));
        const changes: Partial<LocationInput> = { websiteUrl: preview.url };
        if (useName && preview.name) changes.name = preview.name;
        if (useAddress && preview.address) changes.address = preview.address;
        if (useDescription && preview.description) changes.description = preview.description;
        if (menu) changes.menuUrl = menu;
        if (photos.length) changes.imageUrls = [...value.imageUrls, ...photos];
        onChange(changes);
        resetPreview(); setNotice("Selected details added. You can edit them below before saving.");
      });
    });
  }

  return <div className="place-import" aria-busy={busy}>
    <label>Google Maps link<input autoFocus required type="url" disabled={busy} value={value.mapsUrl} placeholder="Paste a Google Maps link"
      onChange={(event) => {
        onChange({ mapsUrl: event.target.value, latitude: null, longitude: null, placeId: "" });
        resetDiscovery();
      }} /></label>
    <div className="import-search-row">
      <span className="import-area-summary" title="Precise locations in Maps links take priority.">
        {area !== null ? <>Search area: <strong>{area || "Anywhere"}</strong></>
          : eventCity ? <>Event city: <strong>{eventCity}</strong></> : "Using the location in your Maps link"}
      </span>
      <button className="button" type="button" disabled={busy || !value.mapsUrl} onClick={() => void find()}>
        <Icon name="pin" size={16} />{searchTask.busy ? "Finding places…" : "Find place"}</button>
    </div>
    <details className="search-area-override">
      <summary>Change search area</summary>
      <label>Search area<input disabled={busy} value={area ?? eventCity} placeholder="City or neighbourhood" maxLength={250} onChange={(event) => setArea(event.target.value)} /></label>
      {area !== null && <button type="button" className="text-button" disabled={busy} onClick={() => setArea(null)}>Use event default</button>}
    </details>
    {searchTask.error && <ErrorBox>{searchTask.error}</ErrorBox>}
    {search && <section className="import-candidates" aria-label="Matching places">
      <div className="import-heading"><strong>{search.candidates.length ? "Choose the right place" : "No matching places"}</strong>
        <span>Check the branch and address.</span></div>
      {search.candidates.map((candidate) => <div className="venue-candidate" key={candidate.id}>
        <div><strong>{candidate.name}</strong><p>{candidate.address}</p>
          {candidate.websiteUrl && <span>{websiteDomain(candidate.websiteUrl)}</span>}</div>
        <button className="button small" type="button" disabled={busy} onClick={() => void choose(candidate)}>Use this place<Icon name="check" size={14} /></button>
      </div>)}
      {search.notices.map((text) => <p className="field-help" key={text}>{text}</p>)}
    </section>}
    {selectedPlace && <p className="selected-place-summary">Selected place: <strong>{selectedPlace.name}</strong>
      <span>{selectedPlace.address}</span></p>}
    <label>Venue website<input type="url" disabled={busy} value={value.websiteUrl} placeholder="https://…"
      onChange={(event) => {
        websiteIdentity.current = { name: value.name, address: value.address, mapsUrl: value.mapsUrl };
        onChange({ websiteUrl: event.target.value }); resetDiscovery(false);
      }} /></label>
    <div className="maps-action website-actions">
      <button type="button" className="button small" disabled={busy || !value.websiteUrl.trim()} onClick={() => void withBusy(() => readWebsite())}>
        <Icon name="link" size={15} />{websiteTask.busy ? "Reading website…" : "Read website"}</button>
      <button type="button" className="button small" disabled={busy || !value.name.trim()} onClick={() => void findWebsite()}>
        <Icon name="spark" size={15} />{suggestionTask.busy ? "Finding websites…" : "Find website"}</button>
    </div>
    {websiteTask.error && <ErrorBox>{websiteTask.error}</ErrorBox>}
    {websiteQuery && <section className="import-candidates website-suggestions" aria-label="Website suggestions">
      <div className="import-heading"><strong>Website suggestions</strong>
        {suggestions?.domain && <span>{suggestions.broadened ? "Search expanded beyond" : "Search limited to"} <strong>{suggestions.domain}</strong></span>}</div>
      <p className="field-help">Results are suggestions. Check the name, address and official site before reading.</p>
      <p className="website-search-context"><strong>{websiteQuery.name}</strong>{websiteQuery.address && <> · {websiteQuery.address}</>}
        {websiteQuery.area && <> · {websiteQuery.area}</>}</p>
      {suggestionTask.busy && <p className="field-help" role="status">Looking for website suggestions…</p>}
      {suggestionTask.error && <ErrorBox>{suggestionTask.error}</ErrorBox>}
      {suggestions?.candidates.map((candidate) => <div className="venue-candidate" key={candidate.url}>
        <div><strong>{candidate.title}</strong><p className="website-suggestion-snippet">{candidate.snippet}</p>
          <span>{websiteDomain(candidate.url)}</span></div>
        <button type="button" className="button small" disabled={busy}
          onClick={() => void withBusy(() => readWebsite(candidate.url, websiteQuery, false))}>Read this website<Icon name="arrow" size={14} /></button>
      </div>)}
      {suggestions && !suggestions.candidates.length && <p className="field-help">No website suggestions found.</p>}
      {suggestions?.notices.map((text) => <p className="inline-note" key={text}>{text}</p>)}
      {suggestions?.domain && !suggestions.broadened && !websiteQuery.broader && <button type="button" className="button small" disabled={busy}
        onClick={() => void findWebsite(true)}>Search more widely</button>}
      <p className="field-help">You can always enter a website or place details manually. Reading a suggestion only opens a preview; choose details separately, then save.</p>
    </section>}
    {notice && <p className="map-notice" role="status">{notice}</p>}
    {preview && <section className="website-preview" aria-label="Website import preview">
      <div className="import-heading"><strong>Choose what to use</strong>
        <a href={preview.url} target="_blank" rel="noopener noreferrer">{websiteDomain(preview.url)}<Icon name="arrow" size={13} /></a></div>
      {preview.name && <label className="import-field"><input type="checkbox" disabled={busy} checked={useName} onChange={(event) => setUseName(event.target.checked)} />
        <span><strong>Name</strong>{preview.name}</span></label>}
      {preview.address && <label className="import-field"><input type="checkbox" disabled={busy} checked={useAddress} onChange={(event) => setUseAddress(event.target.checked)} />
        <span><strong>Address</strong>{preview.address}</span></label>}
      {preview.description && <label className="import-field"><input type="checkbox" disabled={busy} checked={useDescription} onChange={(event) => setUseDescription(event.target.checked)} />
        <span><strong>Description</strong>{preview.description}</span></label>}
      {preview.menus.length > 0 && <label>Suggested menu<select aria-label="Suggested menu" disabled={busy} value={menu} onChange={(event) => setMenu(event.target.value)}>
        <option value="">Keep the current menu</option>{preview.menus.map((item) => <option value={item.url} key={item.url}>{item.label}</option>)}</select></label>}
      {preview.images.length > 0 && <>
        <div className="field-label">Photo suggestions</div><p className="field-help">Choose photos of this exact location. Nothing is selected automatically.</p>
        <div className="suggested-photos">{preview.images.map((url, index) => <label key={url} className={`suggested-photo ${selectedPhotos.includes(url) ? "selected" : ""}`}>
          {failedPhotos.includes(url) ? <span className="image-error">Photo unavailable</span>
            : <img src={`/api/places/photo?url=${encodeURIComponent(url)}`} alt={`Suggested venue photo ${index + 1}`} referrerPolicy="no-referrer"
              onError={() => { setFailedPhotos((previous) => [...previous, url]); setSelectedPhotos((previous) => previous.filter((photo) => photo !== url)); }} />}
          <span><input type="checkbox" aria-label={`Use suggested photo ${index + 1}`} disabled={busy || failedPhotos.includes(url)}
            checked={selectedPhotos.includes(url)} onChange={(event) => setSelectedPhotos((previous) => event.target.checked ? [...previous, url] : previous.filter((photo) => photo !== url))} />Photo {index + 1}</span>
        </label>)}</div>
      </>}
      {selectedPhotos.length > 0 && <label className="checkbox-label"><input type="checkbox" disabled={busy} checked={photoPermission}
        onChange={(event) => setPhotoPermission(event.target.checked)} />I have permission to use these photos.</label>}
      {value.imageUrls.length + selectedPhotos.length > 6 && <ErrorBox>A location can have up to six photos. Remove a photo below or select fewer suggestions.</ErrorBox>}
      {preview.notices.map((text) => <p className="inline-note" key={text}>{text}</p>)}
      {applyTask.error && <ErrorBox>{applyTask.error}</ErrorBox>}
      <button type="button" className="button primary full-width" disabled={busy || !hasSelection || (selectedPhotos.length > 0 && !photoPermission) || value.imageUrls.length + selectedPhotos.length > 6}
        onClick={() => void apply()}>{applyTask.busy ? "Adding selected details…" : "Use selected details"}<Icon name="check" size={16} /></button>
    </section>}
  </div>;
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function websiteDomain(url: string) {
  try { return new URL(url).hostname; }
  catch { return url; }
}
