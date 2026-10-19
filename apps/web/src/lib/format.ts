/** Small formatting helpers shared by the UI. */

export function relativeTime(ts: number): string {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 45) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.round(secs / 3600)}h ago`;
  if (secs < 604_800) return `${Math.round(secs / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function greeting(name?: string): string {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export const SUGGESTIONS = [
  "A landing page for a coffee subscription",
  "A pricing page with three tiers",
  "A personal portfolio site",
  "A dashboard with charts and a sidebar",
] as const;

export const MOBILE_SUGGESTIONS = [
  "A habit tracker with streaks and reminders",
  "A recipe box with a shopping list",
  "A workout log with rest timers",
  "A travel journal with photos and places",
] as const;
