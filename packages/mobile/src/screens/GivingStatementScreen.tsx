// Giving statement (mobile "Give" make). A full, grouped-by-month history of the
// member's gifts with settled-only totals, a provider reference, the payment
// method, and a per-gift status chip. Read-only over GET /giving/history. Tapping
// a gift opens a detail sheet with every field plus the double-entry ledger trail
// (GET /giving/transactions/:id); the download action opens a server-rendered PDF
// of the statement (GET /giving/statement.pdf). All money is server-authoritative
// — we only render what the ledger reports.
import { useMemo, useState, type ReactElement } from "react";
import { Linking, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import {
  ArrowLeft, BookOpen, Calendar, CheckCircle2, CreditCard, Download, Gift, Globe,
  HandHeart, Hash, Percent, Receipt, Wallet, X, type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { T } from "../theme/components";
import { useGivingHistory, useGivingDetail } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { historyStatusChip, methodLabel } from "./givingHelpers";
import { groupByMonth, statementTotalMinor, shortRef } from "./givingStatement";
import { apiBaseUrl } from "../config";
import { getVault } from "../auth/vault";
import type { GivingRecord } from "../api/types";

const kshMinor = (m: number): string => `KSh ${(m / 100).toLocaleString()}`;
const dayFull = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFull = (iso: string): string => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

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
  const [selected, setSelected] = useState<GivingRecord | null>(null);

  async function downloadStatement(): Promise<void> {
    if (records.length === 0) return;
    // The PDF is rendered server-side and opened in the OS browser / viewer,
    // which can't attach a bearer header — pass the access token as a query param.
    const token = await getVault().getAccess();
    if (!token) return;
    const url = `${apiBaseUrl(Platform.OS)}/giving/statement.pdf?token=${encodeURIComponent(token)}`;
    try {
      await Linking.openURL(url);
    } catch {
      /* no handler for the URL */
    }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
            <ArrowLeft size={20} color={palette.onNavy} />
          </Pressable>
          <T variant="overline" tone="gold">GIVING STATEMENT</T>
          <Pressable accessibilityRole="button" accessibilityLabel="Download statement PDF" onPress={() => void downloadStatement()} disabled={records.length === 0} style={({ pressed }) => [st.iconBtn, records.length === 0 && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.95 }] }]}>
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
        {/* Only block the screen when we have nothing to show — a transient refetch
            error (e.g. a 429) shouldn't hide a statement that already loaded. */}
        {error && records.length === 0 ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

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
                <StatementRow key={r.transaction_id} r={r} divider={i < g.records.length - 1} onPress={() => setSelected(r)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {selected ? <DetailSheet record={selected} onClose={() => setSelected(null)} /> : null}
    </View>
  );
}

function StatementRow({ r, divider, onPress }: { r: GivingRecord; divider: boolean; onPress: () => void }): ReactElement {
  const v = fundVisual(r.fund);
  const chip = historyStatusChip(r.status);
  const ref = shortRef(r.provider_ref);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${cap(r.fund)} ${kshMinor(r.amount_minor)} — view details`}
      onPress={onPress}
      style={({ pressed }) => [st.row, divider && st.divider, pressed && { backgroundColor: "rgba(10,37,64,0.03)" }]}
    >
      <View style={[st.fundIcon, { backgroundColor: v.tint }]}><v.Icon size={18} color={v.fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="heading" style={{ fontSize: 15 }}>{cap(r.fund)}</T>
        <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{dayFull(r.created_at)}{r.method ? ` · ${methodLabel(r.method)}` : ""}</T>
        {ref ? <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>Ref {ref}</T> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <T serif style={{ fontSize: 16, color: palette.ink }}>{kshMinor(r.amount_minor)}</T>
        <View style={[st.statusChip, { backgroundColor: chip.bg }]}>
          <T variant="micro" style={{ color: chip.fg, fontWeight: "700", fontSize: 9 }}>{chip.label.toUpperCase()}</T>
        </View>
      </View>
    </Pressable>
  );
}

// ---- Transaction detail: every field the callback returns + the ledger trail ----

function accountLabel(account: string): string {
  const [kind, name] = account.split(":");
  return name ? `${cap(kind ?? "")} · ${cap(name)}` : cap(account);
}

function DetailSheet({ record, onClose }: { record: GivingRecord; onClose: () => void }): ReactElement {
  // Seed the sheet from the row we already have, then enrich with the full
  // callback (ledger trail, schedule id, settled timestamp) when it arrives.
  const { data: detail, isLoading, error } = useGivingDetail(record.transaction_id);
  const v = fundVisual(record.fund);
  const chip = historyStatusChip(detail?.status ?? record.status);
  const ledger = detail?.ledger ?? [];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.grabber} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.base }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1, minWidth: 0 }}>
            <View style={[st.fundIcon, { width: 40, height: 40, borderRadius: 20, backgroundColor: v.tint }]}><v.Icon size={18} color={v.fg} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T serif style={{ fontSize: 20, color: palette.navy }}>{cap(record.fund)}</T>
              <T variant="micro" tone="tertiary">Gift detail</T>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={st.sheetClose}><X size={16} color={palette.navy} /></Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
          <View style={st.amountCard}>
            <T serif tone="onNavy" style={{ fontSize: 34 }}>{kshMinor(record.amount_minor)}</T>
            <View style={[st.statusChip, { backgroundColor: chip.bg, marginTop: 8 }]}>
              <T variant="micro" style={{ color: chip.fg, fontWeight: "700", fontSize: 10 }}>{chip.label.toUpperCase()}</T>
            </View>
          </View>

          <View style={{ marginTop: spacing.lg }}>
            <DetailRow Icon={HandHeart} label="Fund" value={cap(record.fund)} />
            <DetailRow Icon={CreditCard} label="Method" value={methodLabel(detail?.method ?? record.method)} />
            <DetailRow Icon={Calendar} label="Given" value={dateTimeFull(record.created_at)} />
            {detail?.settled_at ? <DetailRow Icon={CheckCircle2} label="Settled" value={dateTimeFull(detail.settled_at)} /> : null}
            <DetailRow Icon={Wallet} label="Currency" value={(detail?.currency ?? record.currency).toUpperCase()} />
            {(detail?.provider_ref ?? record.provider_ref) ? (
              <DetailRow Icon={Hash} label="Reference" value={detail?.provider_ref ?? record.provider_ref ?? ""} mono />
            ) : null}
            {detail?.schedule_id ? <DetailRow Icon={Receipt} label="Recurring" value="Part of a giving schedule" /> : null}
            <DetailRow Icon={Hash} label="Transaction ID" value={record.transaction_id} mono />
          </View>

          {error && ledger.length === 0 ? (
            <T variant="micro" tone="tertiary" style={{ marginTop: spacing.base }}>{errorMessage(error)}</T>
          ) : null}

          {isLoading && ledger.length === 0 ? (
            <T variant="micro" tone="tertiary" style={{ marginTop: spacing.base }}>Loading full detail…</T>
          ) : null}

          {ledger.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <T variant="overline" tone="gold" style={{ marginBottom: spacing.sm }}>LEDGER</T>
              <View style={st.group}>
                {ledger.map((l, i) => (
                  <View key={`${l.account}-${l.side}-${i}`} style={[st.ledgerRow, i < ledger.length - 1 && st.divider]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="body" style={{ fontSize: 14 }}>{accountLabel(l.account)}</T>
                      <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{cap(l.side)}</T>
                    </View>
                    <T serif style={{ fontSize: 15, color: l.side === "credit" ? palette.successText : palette.ink }}>
                      {l.side === "credit" ? "+" : "−"}{kshMinor(l.amount_minor)}
                    </T>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function DetailRow({ Icon, label, value, mono }: { Icon: LucideIcon; label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <View style={st.detailRow}>
      <View style={st.detailIcon}><Icon size={15} color={palette.ink600} /></View>
      <T variant="caption" tone="tertiary" style={{ width: 100 }}>{label}</T>
      <T variant="body" style={[{ flex: 1, textAlign: "right", fontSize: 13 }, mono ? { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" } : null]}>{value}</T>
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
  statusChip: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  // ---- detail sheet ----
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,37,64,0.45)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%", backgroundColor: palette.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: spacing.base },
  sheetClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.mutedBg, alignItems: "center", justifyContent: "center" },
  amountCard: { backgroundColor: palette.navy, borderRadius: 18, paddingVertical: spacing.lg, alignItems: "center", overflow: "hidden" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: "rgba(10,37,64,0.05)" },
  detailIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: palette.mutedBg, alignItems: "center", justifyContent: "center" },
  ledgerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.base },
} as const;
