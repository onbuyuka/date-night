import type { MoodId, ThemeId } from "../shared/model";
import { Icon, type IconName } from "./ui";

export const moods: Record<MoodId, { name: string; description: string; greeting: string; theme: ThemeId; icon: IconName }> = {
  romantic: { name: "Just us", description: "A personal invitation, soft details and a little romance.", greeting: "An evening just for us", theme: "rose", icon: "heart" },
  birthday: { name: "Birthday", description: "A birthday greeting, playful details and a little celebration.", greeting: "An evening to celebrate you", theme: "rose", icon: "cake" },
  friends: { name: "Good company", description: "An easy-going plan for your favourite people.", greeting: "Good plans. Better company.", theme: "sage", icon: "users" },
  minimal: { name: "Keep it simple", description: "Straight to the plan. Quiet, clear and understated.", greeting: "", theme: "sand", icon: "pin" },
};

export function MoodDetails({ mood, decorations }: { mood: MoodId; decorations: boolean }) {
  if (!decorations || mood === "minimal") return null;
  const icon = moods[mood].icon;
  return <div className={`mood-decoration mood-decoration-${mood}`} aria-hidden="true">
    {[0, 1, 2, 3, 4].map((index) => <span key={index}><Icon name={index % 2 ? "spark" : icon} size={index === 2 ? 40 : 22} /></span>)}
  </div>;
}
