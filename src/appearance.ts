export const accentColors = [
  "#7ee787", "#79c0ff", "#a5d6ff", "#d2a8ff", "#ffa7c4", "#ffa198", "#f2cc60"
] as const;

export type AccentColor = (typeof accentColors)[number];
export type ProjectAccentColors = Record<string, AccentColor>;

export function normalizeAccentColor(value: unknown, fallback: string): string {
  return accentColors.includes(value as AccentColor) ? value as AccentColor : fallback;
}

export function projectAccentColor(overrides: ProjectAccentColors, repositoryId: string | undefined, globalAccent: string): string {
  return normalizeAccentColor(repositoryId ? overrides?.[repositoryId] : undefined, globalAccent);
}
