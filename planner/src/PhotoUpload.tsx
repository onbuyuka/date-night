import { useRef, useState } from "react";
import { api, message } from "./api";
import { ErrorBox, Icon } from "./ui";
import { preparePhoto } from "./photos";

export function PhotoUpload({ label, values, onChange, multiple = false, onBusyChange }: {
  label: string; values: string[]; onChange: (values: string[]) => void; multiple?: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maximum = multiple ? 6 : 1;
  async function upload(files: File[]) {
    if (!files.length) return;
    if (multiple && values.length + files.length > maximum) { setError("Choose up to six photos for this place."); return; }
    setBusy(true); onBusyChange(true); setError("");
    const next = multiple ? [...values] : [];
    try {
      for (const file of files.slice(0, maximum)) {
        const blob = await preparePhoto(file);
        const result = await api<{ url: string }>("/media", "POST", blob);
        next.push(result.url);
      }
      onChange(next);
    } catch (error) {
      if (next.length && multiple) onChange(next);
      setError(message(error));
    } finally { setBusy(false); onBusyChange(false); if (input.current) input.current.value = ""; }
  }
  return <div className="photo-upload">
    <div className="field-label">{label}</div>
    <div className={`upload-previews ${multiple ? "" : "cover-preview"}`}>
      {values.map((src, i) => <div className="upload-preview" key={`${src}-${i}`}>
        <img src={src} alt={`${label} ${i + 1}`} />
        {multiple && <span className="upload-position">{i === 0 ? "Cover" : i + 1}</span>}
        <button type="button" className="icon-button" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} disabled={busy}
          onClick={() => onChange(values.filter((_, index) => index !== i))}><Icon name="close" size={15} /></button>
      </div>)}
    </div>
    <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple}
      aria-label={`Upload ${label.toLowerCase()}`} disabled={busy} onChange={(e) => void upload(Array.from(e.target.files ?? []))} />
    <button type="button" className={`upload-zone ${values.length ? "compact" : ""}`} disabled={busy || (multiple && values.length >= maximum)}
      onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (!busy) void upload(Array.from(e.dataTransfer.files)); }}>
      <Icon name="plus" size={22} /><strong>{busy ? "Preparing your photo…" : values.length ? multiple ? "Add more photos" : "Change photo" : multiple ? "Add photos" : "Add a cover photo"}</strong>
      {!values.length && <span>Choose from your device or drop a photo here</span>}
    </button>
    <p className="field-help">{multiple ? "Up to six photos. The first one is the cover." : "A photo makes the invitation feel a little more personal."}</p>
    {error && <ErrorBox>{error}</ErrorBox>}
  </div>;
}
