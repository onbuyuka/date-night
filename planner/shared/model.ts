import { z } from "zod";

export const themeIds = ["sage", "rose", "sand", "midnight"] as const;
export type ThemeId = (typeof themeIds)[number];
export type EventStatus = "draft" | "open" | "closed";
export const moodIds = ["romantic", "birthday", "friends", "minimal"] as const;
export type MoodId = (typeof moodIds)[number];

const optionalUrl = z.string().trim().max(2000).refine(
  (value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  },
  "Use a complete HTTPS link.",
);
const imageReference = z.union([
  optionalUrl,
  z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/),
]);

export function isMapsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.hostname === "maps.app.goo.gl") return url.pathname.length > 1;
    if (url.hostname === "goo.gl") return url.pathname.startsWith("/maps/");
    if (url.hostname === "maps.google.com") return true;
    return /^(www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(url.hostname)
      && url.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

const date = z.string().refine((value) => {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}, "Choose a date for your event.");

export const eventSchema = z.object({
  title: z.string().trim().min(1, "Give your event a name.").max(120),
  description: z.string().trim().max(2000),
  city: z.string().trim().max(120).default(""),
  date,
  occasion: z.enum(["Dinner", "Birthday", "Celebration", "Weekend", "Other"]),
  theme: z.enum(themeIds),
  mood: z.enum(moodIds).default("minimal"),
  greeting: z.string().trim().max(160).default(""),
  decorations: z.boolean().default(true),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid accent colour.").or(z.literal("")),
  coverUrl: imageReference,
  status: z.enum(["draft", "open", "closed"]),
}).strict();

export type EventInput = z.infer<typeof eventSchema>;
export interface PlannerEvent extends EventInput {
  id: string;
  organiserId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface EventSummary extends PlannerEvent {
  locationCount: number;
  participantCount: number;
  ratedParticipantCount: number;
}

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Add the place name and confirm its branch.").max(120),
  address: z.string().trim().max(250),
  mapsUrl: z.string().trim().max(4000).refine(isMapsUrl, "Paste a valid Google Maps place or sharing link."),
  menuUrl: optionalUrl,
  description: z.string().trim().max(1000),
  note: z.string().trim().max(1000),
  imageUrls: z.array(imageReference.refine((value) => value.length > 0, "Remove empty images.")).max(6),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  placeId: z.string().max(250).default(""),
  websiteUrl: optionalUrl.default(""),
  osmUrl: z.string().regex(/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/).or(z.literal("")).default(""),
}).strict();
export type LocationInput = z.infer<typeof locationSchema>;
export interface EventLocation extends LocationInput {
  id: string;
  eventId: string;
  position: number;
}
export interface Participant {
  id: string;
  eventId: string;
  name: string;
  invited: boolean;
  ratedCount: number;
}
export interface Result {
  locationId: string;
  average: number | null;
  count: number;
}
export interface Session {
  role: "admin" | "participant" | null;
  organiserId?: string;
  organiserRole?: OrganiserRole;
  eventId?: string;
  participantId?: string;
  name?: string;
  setupRequired: boolean;
}
export interface EventDetail {
  event: PlannerEvent;
  locations: EventLocation[];
  participants: Participant[];
  participantCount: number;
  completedCount: number;
  results: Result[];
  myRatings: Record<string, number>;
  viewer: { role: "admin" | "participant"; participantId: string | null; name: string };
}

export const participantSchema = z.object({
  name: z.string().trim().min(1, "Add a participant name.").max(80),
}).strict();
export const voteSchema = z.object({
  score: z.number().int().min(1).max(5).nullable(),
}).strict();
export const invitationSchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, numbers, dots, underscores or hyphens for your username."),
  password: z.string().min(12, "Use at least 12 characters for your password.").max(128),
}).strict();
export type OrganiserRole = "owner" | "organiser";
export interface OrganiserAccount {
  id: string;
  username: string;
  role: OrganiserRole;
  active: boolean;
  createdAt: string;
}
export interface OrganiserInvitation {
  id: string;
  name: string;
  expiresAt: number;
  createdAt: string;
}
export interface IssuedOrganiserInvitation extends OrganiserInvitation {
  token: string;
}
export interface OrganiserDirectory {
  organisers: OrganiserAccount[];
  invitations: OrganiserInvitation[];
}
export interface AccountInvitationInfo {
  name: string;
  kind: "owner" | "organiser";
  expiresAt: number;
}
export interface PasswordResetInfo {
  username: string;
  expiresAt: number;
}
export const organiserInvitationSchema = z.object({
  name: z.string().trim().min(1, "Add a name for this invitation.").max(80),
}).strict();
export const organiserAccessSchema = z.object({ active: z.boolean() }).strict();
export const organiserRegistrationSchema = credentialsSchema.extend({
  token: invitationSchema.shape.token,
}).strict();
export const passwordChangeSchema = z.object({
  currentPassword: credentialsSchema.shape.password,
  newPassword: credentialsSchema.shape.password,
}).strict();
export const passwordResetSchema = z.object({
  token: invitationSchema.shape.token,
  password: credentialsSchema.shape.password,
}).strict();
export const mapsSchema = z.object({ url: z.string().trim().max(4000).refine(isMapsUrl, "Paste a Google Maps link.") }).strict();
export interface MapDetails {
  resolvedUrl: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string;
}
export const venueSearchSchema = z.object({
  mapsUrl: z.string().trim().max(4000).refine(isMapsUrl, "Paste a Google Maps link."),
  name: z.string().trim().max(120).default(""),
  area: z.string().trim().max(250).default(""),
}).strict();
export const websiteImportSchema = z.object({
  url: optionalUrl.refine((value) => Boolean(value), "Add the venue’s website."),
  placeName: z.string().trim().max(120).default(""),
}).strict();
export const websiteSearchSchema = z.object({
  name: z.string().trim().min(1, "Enter the place name before looking for a website.").max(120),
  address: z.string().trim().max(250).default(""),
  area: z.string().trim().max(250).default(""),
  websiteUrl: optionalUrl.default(""),
  broader: z.boolean().default(false),
}).strict();
export type WebsiteSearchInput = z.infer<typeof websiteSearchSchema>;
export interface VenueCandidate {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  websiteUrl: string;
  osmUrl: string;
}
export interface VenueSearch {
  map: MapDetails;
  candidates: VenueCandidate[];
  notices: string[];
}
export interface WebsiteCandidate {
  title: string;
  url: string;
  snippet: string;
}
export interface WebsiteSearch {
  domain: string | null;
  candidates: WebsiteCandidate[];
  broadened: boolean;
  notices: string[];
}
export interface WebsitePreview {
  url: string;
  name: string;
  address: string;
  description: string;
  menus: { url: string; label: string }[];
  images: string[];
  notices: string[];
}

export const emptyEvent: EventInput = {
  title: "", description: "", city: "", date: "", occasion: "Dinner",
  theme: "sage", mood: "minimal", greeting: "", decorations: true, accent: "", coverUrl: "", status: "draft",
};
export const emptyLocation: LocationInput = {
  name: "", address: "", mapsUrl: "", menuUrl: "", description: "", note: "", imageUrls: [],
  latitude: null, longitude: null, placeId: "",
  websiteUrl: "", osmUrl: "",
};
