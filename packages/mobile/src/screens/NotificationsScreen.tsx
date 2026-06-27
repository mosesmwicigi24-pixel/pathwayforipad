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
import { palette, spacing } from "../theme/tokens";
import { T, EmptyState, ErrorState } from "../theme/components";
import { useNotifications } from "../api/hooks";
import { invalidateQueries, errorMessage } from "../api/query";
import { SkeletonList } from "../components/Skeleton";
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

const TITLES: Record<string, string> = {
  reengage: "We miss you",
  level_completed: "Level complete!",
  badge_awarded: "New badge earned",
  certificate_issued: "Certificate ready",
  giving_receipt: "Giving receipt",
  event_reminder_24h: "Event tomorrow",
  event_reminder_1h: "Event starting soon",
  reflection_approved: "Reflection approved",
  reflection_returned: "Reflection returned",
  reflection_deferred: "Reflection received",
};

function titleFor(n: NotificationRow): string {
  const payload = n.payload ?? {};
  if (typeof payload.title === "string" && payload.title) return payload.title;
  if (TITLES[n.template]) return TITLES[n.template]!;
  // Template fallbacks, humanized.
  return n.template.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A descriptive line for the notification — the real "detail". Uses the payload's
 *  own body/feedback when present, otherwise a sensible per-type default. */
function bodyFor(n: NotificationRow): string | null {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  if (typeof p.body === "string" && p.body) return p.body;
  if (typeof p.feedback === "string" && p.feedback) return p.feedback;
  const t = n.template;
  if (t.startsWith("reflection_approved")) return "Your discipler approved your reflection — well done.";
  if (t.startsWith("reflection_returned")) return "Your discipler returned your reflection for another look.";
  if (t.startsWith("reflection")) return "Your discipler has reviewed your reflection.";
  if (t.startsWith("level_completed")) return typeof p.level_number === "number" ? `You've completed Level ${p.level_number}. Keep pressing on!` : "You've completed a level. Keep pressing on!";
  if (t.startsWith("badge")) return typeof p.name === "string" ? `You earned the "${p.name}" badge.` : "You earned a new badge — well done!";
  if (t.startsWith("certificate")) return "Your certificate is ready to view and share.";
  if (t.startsWith("event_reminder_24h")) return "Your event is coming up tomorrow.";
  if (t.startsWith("event_reminder_1h")) return "Your event starts in about an hour.";
  if (t.startsWith("event")) return "You have an upcoming gathering.";
  if (t.startsWith("giving")) return "Thank you for giving — your receipt is ready.";
  if (t === "reengage") return "We've missed you — pick up your journey where you left off.";
  return null;
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
  const { data, isLoading, error, refetch } = useNotifications();
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
    // Deep-link routing (D-M9): prefer the SPECIFIC item when the payload carries
    // its id, else fall back to the sensible section.
    const p = (n.payload ?? {}) as Record<string, unknown>;
    const announcementId = typeof p.announcement_id === "string" ? p.announcement_id : null;
    const moduleId = typeof p.module_id === "string" ? p.module_id : null;
    if (n.template.startsWith("announcement")) {
      if (announcementId) nav.navigate("AnnouncementDetail", { announcementId, ...(typeof p.title === "string" ? { title: p.title } : {}) });
      else nav.navigate("Tabs", { screen: "Events" });
    } else if (n.template.startsWith("reflection")) {
      if (moduleId) nav.navigate("Module", { moduleId });
      else nav.navigate("Tabs", { screen: "Pathway" });
    } else if (n.template.startsWith("event")) {
      nav.navigate("Calendar");
    } else if (
      n.template.startsWith("level") ||
      n.template.startsWith("certificate") ||
      n.template.startsWith("badge")
    ) {
      nav.navigate("Tabs", { screen: "Profile" }); // achievements live on Profile
    } else if (n.template.startsWith("giving")) {
      nav.navigate("Tabs", { screen: "Give" });
    } else if (n.template === "reengage") {
      nav.navigate("Tabs", { screen: "Pathway" }); // pick the journey back up
    }
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
          <View style={{ paddingTop: spacing.md }}>
            <SkeletonList count={5} />
          </View>
        ) : error ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : (data?.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Sparkles size={24} color={palette.gold} />}
            title="You're all caught up"
            message="New encouragement, reflections, and event reminders will land here."
          />
        ) : (
          (data?.data ?? []).map((n) => {
            const meta = metaFor(n.template);
            const unreadRow = !n.read_at && n.status === "sent";
            const body = bodyFor(n);
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
} as const;
