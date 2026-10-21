import { useState } from "react";
import { emptyEvent, emptyLocation, eventSchema, locationSchema, moodIds, themeIds, type EventInput, type EventLocation, type LocationInput } from "../shared/model";
import { themes, themeStyle } from "./themes";
import { ErrorBox, Form, Icon, useTask } from "./ui";
import { PhotoUpload } from "./PhotoUpload";
import { MoodDetails, moods } from "./moods";
import { PlaceImport } from "./PlaceImport";

export function EventForm({ initial = emptyEvent, onSave, creating = false }: {
  initial?: EventInput; creating?: boolean; onSave: (data: EventInput) => Promise<void>;
}) {
  const [value, setValue] = useState<EventInput>({
    title: initial.title, description: initial.description, date: initial.date,
    occasion: initial.occasion, theme: initial.theme, accent: initial.accent,
    coverUrl: initial.coverUrl, status: initial.status,
    mood: initial.mood, greeting: initial.greeting, decorations: initial.decorations,
    city: initial.city ?? "",
  });
  const [uploading, setUploading] = useState(false);
  const [validation, setValidation] = useState("");
  const task = useTask();
  function update<K extends keyof EventInput>(key: K, field: EventInput[K]) {
    setValue((previous) => ({ ...previous, [key]: field }));
  }
  function submit() {
    const parsed = eventSchema.safeParse(value);
    if (!parsed.success) { setValidation(parsed.error.issues[0].message); return; }
    setValidation("");
    void task.run(() => onSave(parsed.data));
  }
  return <Form onSubmit={submit}>
    <fieldset disabled={task.busy || uploading}>
      <div className="form-section">
        <h3>The essentials</h3>
        <label>Event name<input required maxLength={120} autoFocus={creating} value={value.title}
          placeholder="Dinner with our favourite people" onChange={(e) => update("title", e.target.value)} /></label>
        <label>A little introduction<textarea aria-label="A little introduction" maxLength={2000} rows={3} value={value.description}
          placeholder="What's the occasion? Anything your guests should know?"
          onChange={(e) => update("description", e.target.value)} /></label>
        <label>City<input maxLength={120} value={value.city} placeholder="e.g. Copenhagen"
          onChange={(e) => update("city", e.target.value)} /></label>
        <p className="field-help">The default city for your location searches.</p>
        <div className="form-columns">
          <label>Date<input required type="date" value={value.date} onChange={(e) => update("date", e.target.value)} /></label>
          <label>Occasion<select aria-label="Occasion" value={value.occasion} onChange={(e) => update("occasion", eventSchema.shape.occasion.parse(e.target.value))}>
            {eventSchema.shape.occasion.options.map((occasion) => <option key={occasion}>{occasion}</option>)}
          </select></label>
        </div>
      </div>
      <div className="form-section">
        <h3>Set the mood</h3>
        <div className="mood-picker" role="group" aria-label="Event mood">
          {moodIds.map((id) => <button type="button" key={id} className={`mood-option ${value.mood === id ? "active" : ""}`}
            aria-pressed={value.mood === id} onClick={() => setValue((previous) => ({ ...previous, mood: id, theme: moods[id].theme, accent: "" }))}>
            <Icon name={moods[id].icon} size={23} /><strong>{moods[id].name}</strong><span>{moods[id].description}</span>
          </button>)}
        </div>
        <label>Personal greeting<input maxLength={160} value={value.greeting} placeholder={moods[value.mood].greeting || "Something you'd like to say"}
          onChange={(e) => update("greeting", e.target.value)} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={value.decorations} onChange={(e) => update("decorations", e.target.checked)} />Decorative touches</label>
        <div className={`mood-sample mood-${value.mood}`} style={themeStyle(value.theme, value.accent)}>
          <MoodDetails mood={value.mood} decorations={value.decorations} />
          <span>{value.greeting || moods[value.mood].greeting}</span><strong>{value.title || "Your invitation"}</strong>
        </div>
        <h3>Colours</h3>
        <div className="theme-picker" role="group" aria-label="Event theme">
          {themeIds.map((id) => <button type="button" key={id} className={`theme-option ${value.theme === id ? "active" : ""}`}
            style={themeStyle(id)} aria-pressed={value.theme === id} onClick={() => update("theme", id)}>
            <span className="theme-swatch"><i /><i /><i /></span>
            <strong>{themes[id].name}</strong><span>{themes[id].description}</span>
            {value.theme === id && <span className="theme-check"><Icon name="check" size={14} /></span>}
          </button>)}
        </div>
        <div className="accent-row">
          <label>Accent colour<input type="color" value={value.accent || themes[value.theme].accent} onChange={(e) => update("accent", e.target.value)} /></label>
          {value.accent && <button type="button" className="text-button" onClick={() => update("accent", "")}>Use theme default</button>}
        </div>
        <PhotoUpload label="Cover photo" values={value.coverUrl ? [value.coverUrl] : []}
          onChange={(urls) => update("coverUrl", urls[0] ?? "")} onBusyChange={setUploading} />
      </div>
      {(validation || task.error) && <ErrorBox>{validation || task.error}</ErrorBox>}
      <div className="form-actions"><button className="button primary" type="submit">
        {task.busy ? "Saving…" : creating ? "Create event" : "Save changes"}<Icon name={creating ? "arrow" : "check"} size={18} />
      </button></div>
    </fieldset>
  </Form>;
}

export function LocationForm({ initial = emptyLocation, eventCity = "", onSave }: {
  initial?: LocationInput | EventLocation; eventCity?: string; onSave: (data: LocationInput) => Promise<void>;
}) {
  const [value, setValue] = useState<LocationInput>({
    name: initial.name, address: initial.address, mapsUrl: initial.mapsUrl, menuUrl: initial.menuUrl,
    description: initial.description, note: initial.note, imageUrls: initial.imageUrls,
    latitude: initial.latitude, longitude: initial.longitude, placeId: initial.placeId,
    websiteUrl: initial.websiteUrl, osmUrl: initial.osmUrl,
  });
  const [uploading, setUploading] = useState(false);
  const [validation, setValidation] = useState("");
  const task = useTask();
  function update(key: "name" | "address" | "mapsUrl" | "menuUrl" | "description" | "note", field: string) {
    setValue((previous) => ({ ...previous, [key]: field }));
  }
  function submit() {
    const parsed = locationSchema.safeParse(value);
    if (!parsed.success) { setValidation(parsed.error.issues[0].message); return; }
    setValidation("");
    void task.run(() => onSave(parsed.data));
  }
  return <Form onSubmit={submit}>
    <fieldset disabled={task.busy || uploading}>
      <PlaceImport value={value} eventCity={eventCity} onChange={(changes) => setValue((previous) => ({ ...previous, ...changes }))} onBusyChange={setUploading} />
      <div className="manual-details-heading"><span>Place details</span><small>Edit or complete anything below.</small></div>
      <label>Place name<input required maxLength={120} value={value.name} placeholder="The name, including the branch"
        onChange={(e) => update("name", e.target.value)} /></label>
      <label>Address<input value={value.address} maxLength={250}
        placeholder="Street, neighbourhood, city" onChange={(e) => update("address", e.target.value)} /></label>
      <label>About the place<textarea aria-label="About the place" rows={2} maxLength={1000}
        value={value.description} placeholder="What's it like?" onChange={(e) => update("description", e.target.value)} /></label>
      <label>Our notes<textarea aria-label="Our notes" rows={2} maxLength={1000}
        value={value.note} placeholder="Dietary options, budget, something to keep in mind…"
        onChange={(e) => update("note", e.target.value)} /></label>
      <label>Menu link<input type="url" value={value.menuUrl}
        placeholder="https://…" onChange={(e) => update("menuUrl", e.target.value)} /></label>
      <PhotoUpload label="Place photos" multiple values={value.imageUrls} onBusyChange={setUploading}
        onChange={(urls) => setValue((previous) => ({ ...previous, imageUrls: urls }))} />
      {(validation || task.error) && <ErrorBox>{validation || task.error}</ErrorBox>}
      <div className="form-actions"><button className="button primary" type="submit">
        {task.busy ? "Saving…" : "Save location"}<Icon name="check" size={18} />
      </button></div>
    </fieldset>
  </Form>;
}
