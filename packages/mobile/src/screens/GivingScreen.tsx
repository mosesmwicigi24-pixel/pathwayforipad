// Give (new design, Contract Matrix M2 over B7; §1.10 C, §5.6). Money is
// online-only — the flow hard-blocks when offline rather than queuing financial
// intent. Big-number entry with presets, fund chips, payment method
// (Card / M-Pesa / Airtel — mobile money sends an STK push to the phone), and
// frequency (One-time / Weekly / Monthly — recurring is charged by the SERVER
// on schedule; you manage it here). Card data is tokenized client-side, never
// by us; active schedules list with cancel.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { assertOnlineForGiving, getConnectivity } from "../net/connectivity";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useGivingHistory, useMe, useSchedules } from "../api/hooks";
import { invalidateQueries } from "../api/query";
import type { GivingMethod, GivingRecord } from "../api/types";

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}
function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const FUNDS = ["tithe", "offering", "mission", "gift"] as const;
const PRESETS = [500, 1000, 2500, 5000];
const CURRENCY = "KES";
const METHODS: Array<{ key: GivingMethod; label: string }> = [
  { key: "card", label: "Card" },
  { key: "mpesa", label: "M-Pesa" },
  { key: "airtel", label: "Airtel" },
];
const FREQUENCIES = [
  { key: "once", label: "One-time" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
] as const;

export function GivingScreen(): ReactElement {
  const nav = useNavigation();
  const [fund, setFund] = useState<(typeof FUNDS)[number]>("tithe");
  const [amount, setAmount] = useState(0); // major units
  const [method, setMethod] = useState<GivingMethod>("card");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]["key"]>("once");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const { data: history } = useGivingHistory();
  const { data: schedules, refetch: refetchSchedules } = useSchedules();
  const { data: me } = useMe();

  const mobileMoney = method === "mpesa" || method === "airtel";
  const phonePlaceholder = me?.profile?.phone_number ?? "+2547…";

  async function give(): Promise<void> {
    if (amount <= 0) return;
    setStatus(frequency === "once" ? "Creating payment…" : "Setting up your schedule…");
    try {
      await assertOnlineForGiving(getConnectivity()); // §5.6: never queue money offline
      if (frequency === "once") {
        await NuruApi.giving({
          fund,
          amount_minor: amount * 100,
          currency: CURRENCY,
          method,
          ...(mobileMoney && phone.trim() ? { phone_number: phone.trim() } : {}),
          idempotency_key: uuidv4(),
        });
        setStatus(
          mobileMoney
            ? "STK push sent — confirm on your phone to complete."
            : "Payment started — confirm in the card sheet.",
        );
        invalidateQueries("giving");
      } else {
        await NuruApi.createSchedule({
          fund,
          amount_minor: amount * 100,
          currency: CURRENCY,
          frequency,
          method,
          idempotency_key: uuidv4(),
        });
        setStatus(`Done — ${frequency} giving of KSh ${amount.toLocaleString()} to ${fund} is active.`);
        void refetchSchedules();
      }
      setOffline(false);
    } catch {
      setOffline(true);
      setStatus(null);
    }
  }

  async function cancelSchedule(id: string): Promise<void> {
    try {
      await NuruApi.cancelSchedule(id);
      void refetchSchedules();
    } catch {
      // server said no (already cancelled) — refresh shows the truth
      void refetchSchedules();
    }
  }

  const active = (schedules ?? []).filter((s) => s.status === "active");

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Header */}
      <View style={st.header}>
        {nav.canGoBack() ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => nav.goBack()}
            style={({ pressed }) => [st.iconBtn, { marginBottom: spacing.md }, pressed && { transform: [{ scale: 0.95 }] }]}
          >
            <ArrowLeft size={20} color={palette.onNavy} />
          </Pressable>
        ) : null}
        <T variant="title" tone="onNavy">Give</T>
        <T variant="body" tone="onNavyDim">Sow into the Kingdom</T>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.screen, gap: spacing.base, paddingBottom: tabBarSpace }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
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

        {/* Payment method */}
        <View>
          <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>PAYMENT METHOD</T>
          <View style={st.segment}>
            {METHODS.map((m) => {
              const on = method === m.key;
              return (
                <Pressable key={m.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setMethod(m.key)} style={[st.segItem, on && { backgroundColor: palette.navy }]}>
                  <T variant="body" style={{ color: on ? palette.white : palette.ink600, fontWeight: on ? "600" : "400" }}>{m.label}</T>
                </Pressable>
              );
            })}
          </View>
          {mobileMoney ? (
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={`STK push to ${phonePlaceholder}`}
              placeholderTextColor={palette.ink400}
              keyboardType="phone-pad"
              accessibilityLabel="Mobile money phone number"
              style={st.phoneInput}
            />
          ) : null}
        </View>

        {/* Frequency */}
        <View>
          <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>FREQUENCY</T>
          <View style={st.segment}>
            {FREQUENCIES.map((f) => {
              const on = frequency === f.key;
              return (
                <Pressable key={f.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFrequency(f.key)} style={[st.segItem, on && { backgroundColor: palette.navy }]}>
                  <T variant="body" style={{ color: on ? palette.white : palette.ink600, fontWeight: on ? "600" : "400" }}>{f.label}</T>
                </Pressable>
              );
            })}
          </View>
          {frequency !== "once" ? (
            <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm, textAlign: "center" }}>
              The first {frequency} gift is charged on the next cycle — cancel anytime below.
            </T>
          ) : null}
        </View>

        {status ? <T variant="caption" tone="secondary" style={{ textAlign: "center" }}>{status}</T> : null}

        <View style={{ marginTop: spacing.sm }}>
          <PButton variant="gold" onPress={() => void give()} disabled={amount <= 0}>
            {frequency === "once"
              ? `Give KSh ${amount.toLocaleString()} · ${fund}`
              : `Give KSh ${amount.toLocaleString()} ${frequency} · ${fund}`}
          </PButton>
        </View>
        <T variant="micro" tone="tertiary" style={{ textAlign: "center" }}>
          {mobileMoney
            ? "You'll confirm each payment on your phone — we never hold your PIN."
            : "Card details are handled securely by Stripe — never stored by Nuru."}
        </T>

        {/* Active recurring schedules */}
        {active.length > 0 ? (
          <View style={{ marginTop: spacing.base }}>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>RECURRING GIVING</T>
            <View style={st.historyGroup}>
              {active.map((s, i) => (
                <View key={s.schedule_id} style={[st.historyRow, i < active.length - 1 && st.historyDivider]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="heading" style={{ fontSize: 15, textTransform: "capitalize" }}>
                      {`${s.fund} · ${s.frequency}`}
                    </T>
                    <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                      {`${money(s.amount_minor, s.currency)} · next ${when(s.next_run_at)} · ${s.method}`}
                    </T>
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => void cancelSchedule(s.schedule_id)}>
                    <T variant="caption" style={{ color: palette.error, fontWeight: "600" }}>Cancel</T>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}

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
  phoneInput: {
    marginTop: spacing.sm,
    backgroundColor: palette.white,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.base,
    height: 48,
    fontSize: 15,
    color: palette.ink,
  },
  offline: { flexDirection: "row", gap: spacing.md, backgroundColor: palette.navy, borderRadius: radii.control, padding: spacing.base },
  offlineIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(201,162,39,0.15)", alignItems: "center", justifyContent: "center" },
  historyGroup: { backgroundColor: palette.white, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.base, paddingVertical: 14 },
  historyDivider: { borderBottomWidth: 1, borderBottomColor: "rgba(10,37,64,0.06)" },
} as const;
