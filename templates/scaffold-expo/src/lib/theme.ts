import { useColorScheme } from "react-native";

/**
 * Semantic colours in the spirit of the platform's system palette, so every
 * screen reads correctly in light and dark without per-screen colour choices.
 */
export type Theme = {
  background: string;
  surface: string;
  label: string;
  secondaryLabel: string;
  separator: string;
  accent: string;
};

const LIGHT: Theme = {
  background: "#F2F2F7",
  surface: "#FFFFFF",
  label: "#000000",
  secondaryLabel: "#3C3C4399",
  separator: "#3C3C434A",
  accent: "#007AFF",
};

const DARK: Theme = {
  background: "#000000",
  surface: "#1C1C1E",
  label: "#FFFFFF",
  secondaryLabel: "#EBEBF599",
  separator: "#54545899",
  accent: "#0A84FF",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? DARK : LIGHT;
}
