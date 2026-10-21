import { preparePhoto } from "./photos";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new ApiError("The planner returned an unreadable response. Please try again.", response.status);
    throw error;
  }
}
function responseMessage(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : fallback;
}

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": body instanceof Blob ? body.type : "application/json" },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError("Cannot reach the planner. Check your connection and try again.", 0);
    throw error;
  }
  const result = await responseJson(response);
  if (!response.ok) {
    throw new ApiError(responseMessage(result, "The request failed. Please try again."), response.status);
  }
  return result as T;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function navigate(path: string, replace = false): void {
  if (replace) {
    history.replaceState(null, "", `#${path}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = path;
  }
  window.scrollTo(0, 0);
}

export function eventLink(id: string): string {
  return `${window.location.origin}${window.location.pathname}#/event/${id}`;
}
export function invitationLink(value: string): string {
  return `${window.location.origin}${window.location.pathname}#/invite/${value}`;
}
export function organiserInvitationLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/join/${token}`;
}
export function passwordResetLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/reset/${token}`;
}
export async function importPhoto(url: string): Promise<string> {
  const response = await fetch(`/api/places/photo?url=${encodeURIComponent(url)}`, { credentials: "same-origin" });
  if (!response.ok) {
    const result = await responseJson(response);
    throw new ApiError(responseMessage(result, "This photo could not be imported."), response.status);
  }
  const blob = await response.blob();
  const compressed = await preparePhoto(new File([blob], "venue-photo", { type: blob.type }));
  return (await api<{ url: string }>("/media", "POST", compressed)).url;
}
