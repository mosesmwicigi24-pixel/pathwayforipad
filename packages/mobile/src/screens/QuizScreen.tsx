// Quiz (spec §3.7). Questions come from the cached bank; the attempt is queued
// offline and scored server-side — the client never decides pass/fail (§1.3).
import { useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";

export function QuizScreen({ moduleId }: { moduleId: string }): ReactElement {
  const nav = useNavigation();
  const [submitted, setSubmitted] = useState(false);

  function submit(): void {
    // engine.enqueue("quiz_attempts", "submit", { module_id: moduleId, answers })
    setSubmitted(true);
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => nav.goBack()}>
        <Text style={{ color: "#2563eb" }}>‹ Back</Text>
      </Pressable>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Quiz · module {moduleId}</Text>
      <Text style={{ color: "#374151" }}>Questions render here from the cached question bank.</Text>
      <Pressable
        accessibilityRole="button"
        onPress={submit}
        disabled={submitted}
        style={{ padding: 14, borderRadius: 8, backgroundColor: submitted ? "#9ca3af" : "#2563eb" }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>
          {submitted ? "Submitted — awaiting result on sync" : "Submit quiz"}
        </Text>
      </Pressable>
    </View>
  );
}
