import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

/**
 * The root navigator. A native stack with system headers: screens added under
 * src/app/ become routes here, and their headers follow the platform.
 */
export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerLargeTitle: true,
          headerTransparent: false,
          headerShadowVisible: false,
        }}
      />
    </>
  );
}
