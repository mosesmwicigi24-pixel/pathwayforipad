// Community (new design, Contract Matrix M1 shell → M2 content). Your cohort's
// shared space: structured cell-scoped discussions (threads + comments,
// leader-moderated) — the recorded decision instead of free-form chat. The
// backend (B8) is live; the threaded UI ships in M2, so this screen sets the
// frame and explains what's coming without dead controls.
import { type ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { MessageSquareText, ShieldCheck, Users } from "lucide-react-native";
import { palette, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";

const POINTS = [
  {
    Icon: MessageSquareText,
    title: "Cohort discussions",
    body: "Threaded conversations for your cell group — start a topic, comment, and grow together between meetings.",
  },
  {
    Icon: ShieldCheck,
    title: "Shepherded, not policed",
    body: "Your cell leader can pin what matters and keep the space safe. Nothing leaves your cohort.",
  },
  {
    Icon: Users,
    title: "Only your cell",
    body: "Discussions are visible to your cell group alone — a small room, not a public feed.",
  },
] as const;

export function CommunityScreen(): ReactElement {
  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -60, top: -60 }} />
          <T variant="micro" tone="gold" style={st.kicker}>YOUR COHORT</T>
          <T variant="display" tone="onNavy" style={{ marginTop: spacing.sm, fontSize: 34 }}>Community</T>
          <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.md, maxWidth: 330 }}>
            Walk the pathway together — discussions with your cell group are almost here.
          </T>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg, gap: spacing.md }}>
          {POINTS.map(({ Icon, title, body }) => (
            <View key={title} style={st.card}>
              <View style={st.iconWrap}>
                <Icon size={20} color={palette.gold} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="heading">{title}</T>
                <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>{body}</T>
              </View>
            </View>
          ))}
          <T variant="micro" tone="tertiary" style={{ textAlign: "center", marginTop: spacing.sm }}>
            Launching in the next update.
          </T>
        </View>
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.xl, overflow: "hidden" },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: palette.navy,
    alignItems: "center",
    justifyContent: "center",
  },
} as const;
