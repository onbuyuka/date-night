import type { CSSProperties } from "react";
import type { ThemeId } from "../shared/model";

export const themes: Record<ThemeId, {
  name: string; description: string; accent: string; background: string;
  surface: string; text: string; muted: string; border: string; soft: string; serif: boolean;
}> = {
  sage: {
    name: "Garden", description: "A little room to breathe", accent: "#305c4e",
    background: "#f4f6f1", surface: "#ffffff", text: "#202e28",
    muted: "#69736b", border: "#dfe5dc", soft: "#e6edde", serif: false,
  },
  rose: {
    name: "Rosé", description: "For something worth celebrating", accent: "#9c4059",
    background: "#fcf3f3", surface: "#fffdfc", text: "#45272e",
    muted: "#8b6a71", border: "#efdbdf", soft: "#f7e4e8", serif: true,
  },
  sand: {
    name: "Sunday", description: "Warm, easy, unhurried", accent: "#915c32",
    background: "#f8f4eb", surface: "#fffefb", text: "#3d3329",
    muted: "#85776a", border: "#e9dfce", soft: "#efe7d5", serif: true,
  },
  midnight: {
    name: "After hours", description: "A plan for when the sun goes down", accent: "#b7cfa1",
    background: "#1c2522", surface: "#26332d", text: "#f0f3e9",
    muted: "#adb9af", border: "#405044", soft: "#34453a", serif: false,
  },
};

function contrast(hex: string): string {
  const rgb = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? "#17231c" : "#ffffff";
}

export function themeStyle(id: ThemeId, override = ""): CSSProperties {
  const theme = themes[id];
  const accent = override || theme.accent;
  return {
    "--accent": accent, "--on-accent": contrast(accent),
    "--background": theme.background, "--surface": theme.surface,
    "--text": theme.text, "--muted": theme.muted, "--border": theme.border, "--soft": theme.soft,
    "--heading-font": theme.serif ? "Georgia, 'Times New Roman', serif" : "inherit",
  } as CSSProperties;
}

export function formatDate(value: string): string {
  return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${value}T12:00:00`)) : "Date to be decided";
}
