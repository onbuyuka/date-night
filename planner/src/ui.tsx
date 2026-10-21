import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { message } from "./api";

const paths = {
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  cake: "M5 21v-9h14v9M3 21h18M12 9V5M8 9V7m8 2V7M5 16c2 2 3-2 5 0s3-2 5 0 3-2 4 0M12 2v1",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  pin: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  copy: "M9 9h12v12H9ZM15 9V3H3v12h6",
  link: "m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  edit: "m15 4 5 5M3 21l5-1L21 7a2 2 0 0 0-4-4L4 16Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z",
  trophy: "M8 3h8v6a4 4 0 0 1-8 0ZM8 5H3v3a5 5 0 0 0 5 5m8-8h5v3a5 5 0 0 1-5 5m-4 0v7m-5 1h10",
  logout: "M9 4H3v16h6m5-13 5 5-5 5M7 12h12",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}
export function Brand() {
  return <span className="brand"><span className="brand-mark"><Icon name="spark" /></span>date night{import.meta.env.DEV && <span className="local-badge">LOCAL</span>}</span>;
}
export function ErrorBox({ children }: { children: ReactNode }) {
  return <div role="alert" className="error-box">{children}</div>;
}
export function Loading({ text = "Getting everything ready…" }: { text?: string }) {
  return <div className="loading" role="status"><span className="spinner" />{text}</div>;
}
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); return true; }
    catch (error) { setError(message(error)); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, run, clearError: () => setError("") };
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <div className="modal-shade" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={title} className="modal"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key !== "Tab") return;
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ) ?? [])].filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </section>
  </div>;
}
export function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }}>{children}</form>;
}
export function Gallery({ name, urls }: { name: string; urls: string[] }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  if (!urls.length) return <div className="place-placeholder"><Icon name="pin" size={38} /><span>{name}</span></div>;
  return <div className="gallery">
    <div className="gallery-track" tabIndex={0} aria-label={`Photos of ${name}. Scroll horizontally to browse.`}
      onScroll={(event) => {
        const track = event.currentTarget;
        if (track.clientWidth) setIndex(Math.round(track.scrollLeft / track.clientWidth));
      }}>
      {urls.map((src, i) => <div className="gallery-slide" key={`${src}-${i}`}>
        {failed.includes(src) ? <div className="image-error"><Icon name="eye" /><span>Image unavailable</span></div>
          : <img src={src} alt={`${name}, photo ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" draggable={false}
            onError={() => setFailed((previous) => [...previous, src])} />}
      </div>)}
    </div>
    {urls.length > 1 && <>
      <span className="photo-count">{index + 1} / {urls.length}</span>
      <div className="gallery-dots">{urls.map((_, i) => <button key={i} className={index === i ? "selected" : ""}
        aria-label={`Show photo ${i + 1}`} aria-pressed={index === i}
        onClick={(event) => {
          const track = event.currentTarget.closest(".gallery")?.querySelector(".gallery-track");
          if (track) track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
        }}><span /></button>)}</div>
    </>}
  </div>;
}
