// Space preview (new design, mobile "Chat" make). A public space is readable
// before joining (server allows congregation members to peek, §5.4); this shows
// the topic + a glimpse of recent messages, then a Join CTA that adds the member
// and drops them straight into the thread.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, Hash } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { palette, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useChatConversation } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

export function SpacePreviewScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "SpacePreview">>();
  const { conversationId } = route.params;
  const { data: convo, isLoading, error, refetch } = useChatConversation(conversationId);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function join(): Promise<void> {
    setJoining(true);
    setJoinError(null);
    try {
      await NuruApi.joinSpace(conversationId);
      const title = convo?.title ?? route.params.title;
      nav.replace("ChatThread", { conversationId, ...(title ? { title } : {}) });
    } catch (e) {
      setJoinError(errorMessage(e));
      setJoining(false);
    }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <View style={st.spaceIcon}><Hash size={26} color={palette.gold} /></View>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: spacing.md }}>{convo?.title ?? route.params.title ?? "Space"}</T>
        {convo?.topic ? <T variant="caption" style={{ color: "rgba(255,255,255,0.75)", marginTop: 4 }}>{convo.topic}</T> : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {isLoading ? <Loading label="Loading space…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {!isLoading && !error ? (
          <>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>A GLIMPSE</T>
            {(convo?.messages ?? []).slice(-6).map((m) => (
              <View key={m.message_id} style={st.peek}>
                <T variant="micro" tone="tertiary">{m.author_name}</T>
                <T variant="body" style={{ color: palette.ink, marginTop: 2 }} numberOfLines={2}>{m.body}</T>
              </View>
            ))}
            {(convo?.messages ?? []).length === 0 ? (
              <View style={st.peek}>
                <T variant="caption" tone="secondary">This space is quiet for now — be an early voice.</T>
              </View>
            ) : null}

            {joinError ? <T variant="caption" style={{ color: palette.error, marginTop: spacing.sm }}>{joinError}</T> : null}
            <View style={{ marginTop: spacing.lg }}>
              <PButton variant="gold" onPress={() => void join()} disabled={joining}>
                {joining ? "Joining…" : "Join space"}
              </PButton>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.xl, overflow: "hidden" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  spaceIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: "rgba(201,162,39,0.16)", alignItems: "center", justifyContent: "center" },
  peek: { backgroundColor: palette.white, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.sm, ...shadow.card },
} as const;
