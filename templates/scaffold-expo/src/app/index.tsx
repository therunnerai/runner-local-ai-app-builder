import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

/** The first screen. Replace it with the app the brief describes. */
export default function HomeScreen() {
  const theme = useTheme();
  return (
    <>
      <Stack.Screen options={{ title: "New App" }} />
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.title, { color: theme.label }]}>Describe the app you want</Text>
          <Text style={[styles.body, { color: theme.secondaryLabel }]}>
            This screen is the starting point. The agent replaces it with your first real
            screens and keeps the app building on iOS, Android and the web.
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  card: { borderRadius: 16, padding: 20, gap: 8 },
  title: { fontSize: 22, fontWeight: "600", letterSpacing: -0.3 },
  body: { fontSize: 17, lineHeight: 24 },
});
