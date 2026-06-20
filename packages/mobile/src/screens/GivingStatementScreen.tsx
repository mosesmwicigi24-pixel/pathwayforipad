// Giving statement (mobile "Give" make). A full, grouped-by-month history of the
// member's gifts with settled-only totals, a provider reference, the payment
// method, and a per-gift status chip. Read-only over GET /giving/history; the
// download action shares a plain-text statement (no new native dependency). All
// money is server-authoritative — we only render what the ledger reports.
import { useMemo, type ReactElement } from "react";
import { Pressable, ScrollView, Share, View } from "react-native";
import { ArrowLeft, BookOpen, Download, Gift, Globe, HandHeart, Percent, type LucideIcon } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { useGivingHistory } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { historyStatusChip, methodLabel } from "./givingHelpers";
import { groupByMonth, statementTotalMinor, shortRef } from "./givingStatement";
import type { GivingRecord } from "../api/types";

const kshMinor = (m: number): string => `KSh ${(m / 100).toLocaleString()}`;
const dayFull = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

type FundVisual = { Icon: LucideIcon; tint: string; fg: string };
const FUND_VISUALS: Record<string, FundVisual> = {
  tithe: { Icon: Percent, tint: palette.goldTint, fg: palette.goldLo },
  offering: { Icon: HandHeart, tint: "#FEE2E2", fg: "#B91C1C" },
  gift: { Icon: Gift, tint: "#F3E8FF", fg: "#7E22CE" },
  mission: { Icon: Globe, tint: "#E0F2FE", fg: "#0369A1" },
  discipleship: { Icon: BookOpen, tint: palette.successBg, fg: palette.successText },
};
function fundVisual(fund: string): FundVisual {
  return FUND_VISUALS[fund.toLowerCase()] ?? { Icon: HandHeart, tint: palette.mutedBg, fg: palette.ink600 };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function GivingStatementScreen(): ReactElement {
  const nav = useNavigation();
  const { data: history, isLoading, error, refetch } = useGivingHistory();
  const records = history ?? [];
  const groups = useMemo(() => groupByMonth(records), [records]);
  const total = statementTotalMinor(records);

  async function downloadStatement(): Promise<void> {
    if (records.length === 0) return;
    const lines = [
      "NURU PATHWAY — GIVING STATEMENT",
      `Total given: ${kshMinor(total)}`,
      `${records.length} gift${records.length === 1 ? "" : "s"}`,
      "",
    ];
    for (const g of groups) {
      lines.push(`${g.label}  —  ${kshMinor(g.totalMinor)}`);
      for (const r of g.records) {
        const ref = shortRef(r.provider_ref);
        lines.push(`  ${cap(r.fund)}  ${kshMinor(r.amount_minor)}  ·  ${dayFull(r.created_at)}  ·  ${methodLabel(r.method)}  ·  ${cap(r.status)}${ref ? `  ·  Ref ${ref}` : ""}`);
      }
      lines.push("");
    }
    try {
      await Share.share({ message: lines.join("\n"), title: "Giving statement" });
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Glow size={200} color="rgba(201,162,39,0.12)" style={{ right: -50, top: -40 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
            <ArrowLeft size={20} color={palette.onNavy} />
          </Pressable>
          <T variant="overline" tone="gold">GIVING STATEMENT</T>
          <Pressable accessibilityRole="button" accessibilityLabel="Download statement" onPress={() => void downloadStatement()} disabled={records.length === 0} style={({ pressed }) => [st.iconBtn, records.length === 0 && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.95 }] }]}>
            <Download size={18} color={palette.onNavy} />
          </Pressable>
        </View>
        <T variant="caption" tone="onNavyDim" style={{ marginTop: spacing.lg }}>Total given</T>
        <T serif tone="onNavy" style={{ fontSize: 38, marginTop: 2 }}>{kshMinor(total)}</T>
        <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }}>
          {records.length} {records.length === 1 ? "gift" : "gifts"} · most recent first
        </T>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: tabBarSpace + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && records.length === 0 ? <Loading label="Loading your statement…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {!isLoading && !error && records.length === 0 ? (
          <View style={st.empty}>
            <T variant="heading">No giving yet</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center" }}>Your gifts will appear here once you give.</T>
          </View>
        ) : null}

        {groups.map((g) => (
          <View key={g.key} style={{ marginBottom: spacing.lg }}>
            <View style={st.monthHead}>
              <T variant="overline" tone="gold">{g.label}</T>
              <T variant="caption" tone="tertiary">{kshMinor(g.totalMinor)}</T>
            </View>
            <View style={st.group}>
              {g.records.map((r, i) => (
                <StatementRow key={r.transaction_id} r={r} divider={i < g.records.length - 1} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function StatementRow({ r, divider }: { r: GivingRecord; divider: boolean }): ReactElement {
  const v = fundVisual(r.fund);
  const chip = historyStatusChip(r.status);
  const ref = shortRef(r.provider_ref);
  return (
    <View style={[st.row, divider && st.divider]}>
      <View style={[st.fundIcon, { backgroundColor: v.tint }]}><v.Icon size={18} color={v.fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="heading" style={{ fontSize: 15 }}>{cap(r.fund)}</T>
        <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{dayFull(r.created_at)} · {methodLabel(r.method)}</T>
        {ref ? <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>Ref {ref}</T> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <T serif style={{ fontSize: 16, color: palette.ink }}>{kshMinor(r.amount_minor)}</T>
        <View style={[st.statusChip, { backgroundColor: chip.bg }]}>
          <T variant="micro" style={{ color: chip.fg, fontWeight: "700", fontSize: 9 }}>{chip.label.toUpperCase()}</T>
        </View>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  header: { backgroundColor: palette.navy, paddingTop: 54, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg, overflow: "hidden", borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  monthHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  group: { backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.base },
  divider: { borderBottomWidth: 1, borderBottomColor: "rgba(10,37,64,0.06)" },
  fundIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  statusChip: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
} as const;
