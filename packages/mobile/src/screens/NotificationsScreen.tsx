// Notification center (Design spec D1 §13). White top bar with "Mark all
// read", typed rows (icon tile by template family), gold unread dots, and
// deep-link routing per D-M9. Read-state is display-only server state.
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import {
  Award,
  BadgeCheck,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  MessageSquareText,
  Megaphone,
  Settings,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { palette, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { useNotifications } from "../api/hooks";
import { invalidateQueries } from "../api/query";
import { Loading } from "../components/states";
import type { NotificationRow } from "../api/types";

interface TypeMeta {
  Icon: LucideIcon;
  bg: string;
  fg: string;
}

function metaFor(template: string): TypeMeta {
  if (template.startsWith("reflection")) return { Icon: MessageSquareText, bg: "#FEF3C7", fg: "#92400E" };
  if (template.startsWith("level")) return { Icon: TrendingUp, bg: palette.successBg, fg: palette.successText };
  if (template.startsWith("certificate")) return { Icon: Award, bg: "#FFF8DD", fg: palette.goldLo };
  if (template.startsWith("badge")) return { Icon: BadgeCheck, bg: "#E0E7FF", fg: "#4338CA" };
  if (template.startsWith("event")) return { Icon: CalendarDays, bg: palette.tintBlue, fg: palette.navy };
  if (template.startsWith("announcement")) return { Icon: Megaphone, bg: palette.tintBlue, fg: palette.navy };
  return { Icon: Settings, bg: palette.mutedBg, fg: palette.ink600 };
}

function titleFor(n: NotificationRow): string {
  const payload = n.payload ?? {};
  if (typeof payload.title === "string" && payload.title) return payload.title;
  // Template fallbacks, humanized.
  return n.template.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function ago(iso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  const days = Math.floor(min / (24 * 60));
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NotificationsScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, isLoading, refetch } = useNotifications();
  const unread = data?.unread ?? 0;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const markAll = useCallback(async () => {
    await NuruApi.markNotificationsRead().catch(() => undefined);
    invalidateQueries("notifications");
    void refetch();
  }, [refetch]);

  function open(n: NotificationRow): void {
    if (!n.read_at) {
      void NuruApi.markNotificationsRead([n.notification_id])
        .then(() => {
          invalidateQueries("notifications");
          void refetch();
        })
        .catch(() => undefined);
    }
    // Deep-link routing (D-M9 / Chat make's routeTarget): every notification
    // family lands somewhere sensible.
    if (n.template.startsWith("announcement")) nav.navigate("Tabs", { screen: "Community" });
    else if (n.template.startsWith("event")) nav.navigate("Calendar");
    else if (n.template.startsWith("reflection")) nav.navigate("Tabs", { screen: "Pathway" });
    else if (
      n.template.startsWith("level") ||
      n.template.startsWith("certificate") ||
      n.template.startsWith("badge")
    )
      nav.navigate("Tabs", { screen: "Profile" }); // achievements live on Profile
  }

  return (
    <View style={st.screen}>
      {/* White top bar */}
      <View style={st.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.backBtn}>
          <ChevronLeft size={20} color={palette.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <T variant="heading">Notifications</T>
          <T variant="micro" tone="tertiary">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </T>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void markAll()}
          disabled={unread === 0}
          style={[st.markAll, unread === 0 && { opacity: 0.4 }]}
        >
          <CheckCheck size={14} color={palette.gold} />
          <T variant="micro" style={{ color: palette.gold, fontWeight: "600" }}>Mark all read</T>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {isLoading ? (
          <View style={{ paddingTop: spacing.xl }}>
            <Loading label="Loading…" />
          </View>
        ) : (data?.data ?? []).length === 0 ? (
          <View style={st.empty}>
            <View style={st.emptyTile}>
              <Sparkles size={22} color={palette.gold} />
            </View>
            <T variant="heading" style={{ marginTop: spacing.md }}>You're all caught up</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center", maxWidth: 260 }}>
              New encouragement, reflections, and event reminders will land here.
            </T>
          </View>
        ) : (
          (data?.data ?? []).map((n) => {
            const meta = metaFor(n.template);
            const unreadRow = !n.read_at && n.status === "sent";
            const body = typeof n.payload?.body === "string" ? (n.payload.body as string) : null;
            return (
              <Pressable
                key={n.notification_id}
                onPress={() => open(n)}
                style={({ pressed }) => [st.row, unreadRow && { backgroundColor: palette.white }, pressed && { opacity: 0.85 }]}
              >
                <View style={[st.typeTile, { backgroundColor: meta.bg }]}>
                  <meta.Icon size={18} color={meta.fg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
                    <T variant="heading" style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>{titleFor(n)}</T>
                    <T variant="micro" tone="tertiary">{ago(n.sent_at ?? n.scheduled_for)}</T>
                  </View>
                  {body ? (
                    <T variant="caption" tone="secondary" style={{ marginTop: 2 }} numberOfLines={2}>{body}</T>
                  ) : null}
                </View>
                {unreadRow ? <View style={st.unreadDot} /> : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: "#F6F4EE" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.white,
    paddingTop: 54,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.mutedBg, alignItems: "center", justifyContent: "center" },
  markAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.navy,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  typeTile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold, marginTop: 6 },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: spacing.lg },
  emptyTile: { width: 56, height: 56, borderRadius: 18, backgroundColor: palette.white, alignItems: "center", justifyContent: "center", ...shadow.card },
} as const;
