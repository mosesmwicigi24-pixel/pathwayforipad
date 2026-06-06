// Giving (spec §1.10 C, §5.6; Figma "GiveTab"). Money is online-only — the flow
// hard-blocks when offline rather than queuing financial intent. Big-number entry
// with presets + a segmented fund selector. Card data is tokenized by Stripe
// Elements (later), never by us.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { assertOnlineForGiving, getConnectivity } from "../net/connectivity";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useGivingHistory } from "../api/hooks";
import { invalidateQueries } from "../api/query";
import type { GivingRecord } from "../api/types";

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}
function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const FUNDS = ["tithe", "offering", "general", "media"] as const;
const PRESETS = [500, 1000, 2500, 5000];
const CURRENCY = "KES";

export function GivingScreen(): ReactElement {
  const nav = useNavigation();
  const [fund, setFund] = useState<(typeof FUNDS)[number]>("tithe");
  const [amount, setAmount] = useState(0); // major units
  const [status, setStatus] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const { data: history } = useGivingHistory();

  async function give(): Promise<void> {
    if (amount <= 0) return;
    setStatus("Creating payment…");
    try {
      await assertOnlineForGiving(getConnectivity()); // §5.6: never queue money offline
      await NuruApi.giving({ fund, amount_minor: amount * 100, currency: CURRENCY, idempotency_key: uuidv4() });
      setOffline(false);
      setStatus("Payment started — confirm in the card sheet.");
      invalidateQueries("giving");
    } catch {
      setOffline(true);
      setStatus(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Header */}
      <View style={st.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => nav.goBack()}
          style={({ pressed }) => [st.iconBtn, { marginBottom: spacing.md }, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="title" tone="onNavy">Give</T>
        <T variant="body" tone="onNavyDim">Sow into the Kingdom</T>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.screen, gap: spacing.base, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {/* Offline info card (kind, never red-shaming) */}
        {offline ? (
          <View style={st.offline}>
            <View style={st.offlineIcon}><T style={{ color: palette.gold }}>⚡</T></View>
            <View style={{ flex: 1 }}>
              <T variant="heading" tone="onNavy">Giving needs a connection</T>
              <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.xs }}>
                You're offline. Your Pathway progress keeps saving locally — giving resumes when you reconnect.
              </T>
            </View>
          </View>
        ) : null}

        {/* Amount display */}
        <View style={[st.card, { alignItems: "center", paddingVertical: spacing.lg }]}>
          <T variant="overline" tone="tertiary">AMOUNT ({CURRENCY})</T>
          <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: spacing.md }}>
            <T style={st.currency}>KSh </T>
            <T style={st.bigNum}>{amount.toLocaleString()}</T>
          </View>
          <View style={st.presets}>
            {PRESETS.map((v) => {
              const on = amount === v;
              return (
                <Pressable key={v} accessibilityRole="button" onPress={() => setAmount(v)} style={[st.preset, { backgroundColor: on ? palette.navy : "rgba(10,37,64,0.06)" }]}>
                  <T variant="body" style={{ color: on ? palette.white : "#374151", fontWeight: "500" }}>{v.toLocaleString()}</T>
                </Pressable>
              );
            })}
            <Pressable accessibilityRole="button" onPress={() => setAmount(0)} style={[st.preset, { backgroundColor: "rgba(10,37,64,0.06)" }]}>
              <T variant="body" style={{ color: "#374151", fontWeight: "500" }}>Clear</T>
            </Pressable>
          </View>
        </View>

        {/* Fund segmented selector */}
        <View style={st.segment}>
          {FUNDS.map((f) => {
            const on = fund === f;
            return (
              <Pressable key={f} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFund(f)} style={[st.segItem, on && { backgroundColor: palette.navy }]}>
                <T variant="body" style={{ color: on ? palette.white : palette.ink600, fontWeight: on ? "600" : "400", textTransform: "capitalize" }}>{f}</T>
              </Pressable>
            );
          })}
        </View>

        {status ? <T variant="caption" tone="secondary" style={{ textAlign: "center" }}>{status}</T> : null}

        <View style={{ marginTop: spacing.sm }}>
          <PButton variant="gold" onPress={() => void give()} disabled={amount <= 0}>
            {`Give KSh ${amount.toLocaleString()} · ${fund}`}
          </PButton>
        </View>
        <T variant="micro" tone="tertiary" style={{ textAlign: "center" }}>
          Card details are handled securely by Stripe — never stored by Nuru.
        </T>

        {/* Giving history (real ledger from the server) */}
        {history && history.length > 0 ? (
          <View style={{ marginTop: spacing.base }}>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>RECENT GIVING</T>
            <View style={st.historyGroup}>
              {history.slice(0, 8).map((g: GivingRecord, i) => (
                <View key={g.transaction_id} style={[st.historyRow, i < Math.min(history.length, 8) - 1 && st.historyDivider]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="heading" style={{ fontSize: 15, textTransform: "capitalize" }}>{g.fund}</T>
                    <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>{`${when(g.created_at)} · ${g.status}`}</T>
                  </View>
                  <T variant="heading" style={{ fontSize: 15 }}>{money(g.amount_minor, g.currency)}</T>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = {
  header: { backgroundColor: palette.navy, paddingTop: 54, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  currency: { fontSize: 28, fontWeight: "300", color: palette.ink400, marginTop: 10, lineHeight: 32 },
  bigNum: { fontSize: 56, fontWeight: "700", letterSpacing: -2, color: palette.ink, lineHeight: 60 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg, justifyContent: "center" },
  preset: { height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  segment: { flexDirection: "row", gap: 4, backgroundColor: palette.white, borderRadius: radii.control, padding: 5, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  segItem: { flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  offline: { flexDirection: "row", gap: spacing.md, backgroundColor: palette.navy, borderRadius: radii.control, padding: spacing.base },
  offlineIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(201,162,39,0.15)", alignItems: "center", justifyContent: "center" },
  historyGroup: { backgroundColor: palette.white, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.base, paddingVertical: 14 },
  historyDivider: { borderBottomWidth: 1, borderBottomColor: "rgba(10,37,64,0.06)" },
} as const;
