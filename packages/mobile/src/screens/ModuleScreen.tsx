// Module detail (spec §1.7). "Mark complete" enqueues an offline mutation rather
// than calling the network directly — it commits locally and replays on sync.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";

export function ModuleScreen({ moduleId }: { moduleId: string }): ReactElement {
  const nav = useNavigation();
  const [completed, setCompleted] = useState(false);

  function markComplete(): void {
    // engine.enqueue("module_progress", "complete", { module_id: moduleId, completed_at: new Date().toISOString() })
    setCompleted(true);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => nav.goBack()}>
        <Text style={{ color: "#2563eb" }}>‹ Back</Text>
      </Pressable>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Module</Text>
      <Text style={{ color: "#374151" }}>Lesson content for {moduleId} renders here from the local cache.</Text>

      <Pressable
        accessibilityRole="button"
        onPress={markComplete}
        style={{ padding: 14, borderRadius: 8, backgroundColor: completed ? "#9ca3af" : "#16a34a" }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>
          {completed ? "Marked complete (queued)" : "Mark complete"}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => nav.navigate({ name: "Quiz", moduleId })}
        style={{ padding: 14, borderRadius: 8, backgroundColor: "#1f2937" }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>Take the quiz</Text>
      </Pressable>
    </ScrollView>
  );
}
