// Give (rebuilt to the "Nuru Pathway app design" make — AgqYlBEN2Sy2tA6vjBaUxE).
// Faithful: year-given pill, repeat-last, five funds (Tithe/Offering/Gift/Mission/
// Discipleship), big-number amount + keypad, frequency (one-time/weekly/monthly)
// with a recurring summary, six payment methods with per-method detail sheets,
// cover-the-fee, recent giving, scripture strip, sticky CTA, STK/success/failed
// ceremony. Money stays server-authoritative + online-only (§5.6) — we create a
// real intent (or schedule) and watch the ledger; we NEVER fake a gift. Methods
// without a live provider (Equity/PayPal/wallet) are shown but flagged "soon".
import { useCallback, useRef, useState, type ReactElement } from "react";
import { Alert, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  ArrowLeft, BadgeCheck, BookOpen, CalendarClock, Check, ChevronDown, ChevronRight, ChevronUp, CreditCard, Delete, Gift, Globe,
  GripVertical, HandHeart, Landmark, Loader, Lock, Percent, Quote, Repeat, RotateCcw, ShieldCheck, Smartphone,
  Wallet, X, type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { assertOnlineForGiving, getConnectivity } from "../net/connectivity";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, PButton, T } from "../theme/components";
import { useGivingHistory, useMe, useSchedules } from "../api/hooks";
import { invalidateQueries } from "../api/query";
import { freqLabel, historyStatusChip, methodLabel } from "./givingHelpers";
import type { GivingMethod, GivingRecord, GivingSchedule } from "../api/types";

const CURRENCY = "KES";
const ksh = (n: number): string => `KSh ${n.toLocaleString()}`;
const kshMinor = (m: number): string => `KSh ${(m / 100).toLocaleString()}`;
const when = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const whenFull = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const thisYear = (iso: string): boolean => iso.slice(0, 4) === new Date().toISOString().slice(0, 4);
const SETTLED = new Set(["succeeded", "settled", "completed"]);

function feeFor(a: number): number {
  if (a <= 100) return 0;
  if (a <= 500) return 7;
  if (a <= 1000) return 13;
  if (a <= 1500) return 23;
  if (a <= 2500) return 33;
  if (a <= 3500) return 53;
  if (a <= 5000) return 57;
  return Math.round(a * 0.012);
}

type FundDef = { code: string; label: string; tagline: string; Icon: LucideIcon; tint: string; fg: string };
const FUNDS: FundDef[] = [
  { code: "tithe", label: "Tithe", tagline: "A faithful portion", Icon: Percent, tint: palette.goldTint, fg: palette.goldLo },
  { code: "offering", label: "Offering", tagline: "Freewill worship", Icon: HandHeart, tint: "#FEE2E2", fg: "#B91C1C" },
  { code: "gift", label: "Gift", tagline: "A special gift", Icon: Gift, tint: "#F3E8FF", fg: "#7E22CE" },
  { code: "mission", label: "Mission", tagline: "Beyond our walls", Icon: Globe, tint: "#E0F2FE", fg: "#0369A1" },
  { code: "discipleship", label: "Discipleship", tagline: "Growing the Pathway", Icon: BookOpen, tint: palette.successBg, fg: palette.successText },
];
const DEFAULT_FUND = FUNDS[0]!;
const PRESETS = [200, 500, 1000, 2500, 5000];

type UIMethod = "mpesa" | "airtel" | "equity" | "card" | "wallet" | "paypal";
type MethodDef = { key: UIMethod; label: string; sub: string; badge: string; badgeBg: string };
const METHODS: MethodDef[] = [
  { key: "mpesa", label: "M-Pesa", sub: "STK push to your phone", badge: "M-PESA", badgeBg: "#16A34A" },
  { key: "airtel", label: "Airtel Money", sub: "Mobile money", badge: "AIRTEL", badgeBg: "#E2231A" },
  { key: "equity", label: "Equity Bank", sub: "Bank account", badge: "EQ", badgeBg: "#A6093D" },
  { key: "card", label: "Card", sub: "Visa · Mastercard", badge: "CARD", badgeBg: "#6366F1" },
  { key: "wallet", label: "Apple / Google Pay", sub: "Device wallet", badge: "PAY", badgeBg: "#6366F1" },
  { key: "paypal", label: "PayPal", sub: "PayPal balance / linked", badge: "PP", badgeBg: "#0070BA" },
];
// Only these have a live backend provider; the rest are shown but flagged "soon".
const PROVIDER: Record<UIMethod, GivingMethod | null> = { mpesa: "mpesa", airtel: "airtel", card: "card", paypal: "paypal", equity: null, wallet: null };

type Freq = "once" | "weekly" | "monthly";
type Phase = "stk" | "success" | "failed";
type Ceremony = { phase: Phase; amount: number; fund: string; method: UIMethod; ref: string; note?: string; scheduled?: boolean };

export function GivingScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: history, isLoading: historyLoading } = useGivingHistory();
  const { data: schedules, refetch: refetchSchedules } = useSchedules();
  const { data: me } = useMe();

  const [fundCode, setFundCode] = useState("tithe");
  const [amount, setAmount] = useState(1000);
  const [method, setMethod] = useState<UIMethod>("mpesa");
  const [methodOrder, setMethodOrder] = useState<UIMethod[]>(METHODS.map((m) => m.key));
  const [freq, setFreq] = useState<Freq>("once");
  const [coverFee, setCoverFee] = useState(false);
  const [sheet, setSheet] = useState<"none" | "keypad" | "details">("none");
  const [scheduleDetail, setScheduleDetail] = useState<GivingSchedule | null>(null);
  const [historyDetail, setHistoryDetail] = useState<GivingRecord | null>(null);
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const pollRef = useRef(false);

  const fund = FUNDS.find((f) => f.code === fundCode) ?? DEFAULT_FUND;
  const fee = coverFee ? feeFor(amount) : 0;
  const total = amount + fee;
  const recurring = freq !== "once";
  const cadence = freq === "weekly" ? "week" : "month";
  const phoneHint = me?.profile?.phone_number ?? null;

  const lastGift = (history ?? []).find((g) => SETTLED.has(g.status)) ?? (history ?? [])[0] ?? null;
  const yearTotal = (history ?? []).filter((g) => SETTLED.has(g.status) && thisYear(g.created_at)).reduce((s, g) => s + g.amount_minor, 0);
  const active = (schedules ?? []).filter((s) => s.status === "active");

  const watchSettlement = useCallback(async (txnId: string, base: Omit<Ceremony, "phase">): Promise<void> => {
    pollRef.current = true;
    for (let i = 0; i < 10 && pollRef.current; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      if (!pollRef.current) return;
      let rows: GivingRecord[] = [];
      try { rows = await NuruApi.givingHistory(); } catch { continue; }
      const row = rows.find((g) => g.transaction_id === txnId);
      if (!row) continue;
      if (SETTLED.has(row.status)) { invalidateQueries("giving"); setCeremony({ ...base, phase: "success" }); return; }
      if (row.status === "failed" || row.status === "cancelled") { setCeremony({ ...base, phase: "failed" }); return; }
    }
    if (pollRef.current) {
      invalidateQueries("giving");
      setCeremony({ ...base, phase: "stk", note: "Still waiting on confirmation. Your gift will appear on your statement once it settles." });
    }
  }, []);

  async function give(): Promise<void> {
    if (amount <= 0) return;
    const providerMethod = PROVIDER[method];
    if (!providerMethod) {
      setCeremony({ phase: "failed", amount: total, fund: fund.label, method, ref: "", note: "soon" });
      return;
    }
    try {
      await assertOnlineForGiving(getConnectivity());
    } catch {
      setCeremony({ phase: "failed", amount: total, fund: fund.label, method, ref: "", note: "offline" });
      return;
    }
    // PayPal: one-time USD order → member approves on PayPal → we capture (§5.6).
    if (providerMethod === "paypal") {
      let order: { transaction_id: string; provider_ref?: string; approve_url?: string };
      try {
        order = await NuruApi.giving({ fund: fund.code, amount_minor: total * 100, currency: "USD", method: "paypal", idempotency_key: uuidv4() });
      } catch {
        setCeremony({ phase: "failed", amount: total, fund: fund.label, method, ref: "" });
        return;
      }
      if (order.approve_url) void Linking.openURL(order.approve_url).catch(() => undefined);
      setCeremony({ phase: "stk", amount: total, fund: fund.label, method: "paypal", ref: order.provider_ref ?? "", note: "paypal" });
      return;
    }

    const base = { amount: total, fund: fund.label, method, ref: "" };
    if (recurring) {
      try {
        await NuruApi.createSchedule({ fund: fund.code, amount_minor: total * 100, currency: CURRENCY, frequency: freq, method: providerMethod, idempotency_key: uuidv4() });
      } catch {
        setCeremony({ ...base, phase: "failed" });
        return;
      }
      void refetchSchedules();
      setCeremony({ ...base, phase: "success", scheduled: true });
      return;
    }
    let res: { transaction_id: string; provider_ref?: string };
    try {
      res = await NuruApi.giving({
        fund: fund.code, amount_minor: total * 100, currency: CURRENCY, method: providerMethod,
        ...(providerMethod !== "card" && phoneHint ? { phone_number: phoneHint } : {}),
        idempotency_key: uuidv4(),
      });
    } catch {
      setCeremony({ ...base, phase: "failed" });
      return;
    }
    const withRef = { ...base, ref: res.provider_ref ?? res.transaction_id };
    setCeremony({ ...withRef, phase: "stk" });
    void watchSettlement(res.transaction_id, withRef);
  }

  async function confirmPayPal(orderId: string): Promise<void> {
    if (!orderId) return;
    setCeremony((c) => (c ? { ...c, note: "paypal-capturing" } : c));
    try {
      const r = await NuruApi.capturePayPalGift(orderId);
      if (r.status === "succeeded") {
        invalidateQueries("giving");
        setCeremony((c) => (c ? { ...c, phase: "success" } : c));
      } else if (r.status === "failed") {
        setCeremony((c) => (c ? { ...c, phase: "failed" } : c));
      } else {
        setCeremony((c) => (c ? { ...c, note: "paypal" } : c)); // still pending
      }
    } catch {
      setCeremony((c) => (c ? { ...c, phase: "failed" } : c));
    }
  }

  function repeatLast(): void {
    if (!lastGift) return;
    const f = FUNDS.find((x) => x.code === lastGift.fund);
    if (f) setFundCode(f.code);
    setAmount(Math.round(lastGift.amount_minor / 100));
    setFreq("once");
  }
  function moveMethod(key: UIMethod, dir: -1 | 1): void {
    setMethodOrder((cur) => {
      const i = cur.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      const a = next[i]!;
      next[i] = next[j]!;
      next[j] = a;
      return next;
    });
  }
  function dismiss(): void { pollRef.current = false; setCeremony(null); }

  // Cancel a recurring schedule. Money requires connectivity (§5.6) — a plain online
  // POST, then invalidate the schedules query so the rail refreshes. No pause: the
  // backend only cancels.
  async function cancelSchedule(s: GivingSchedule): Promise<void> {
    try {
      await NuruApi.cancelSchedule(s.schedule_id);
      invalidateQueries("schedules");
      void refetchSchedules();
      setScheduleDetail(null);
    } catch {
      Alert.alert("Couldn't cancel", "Please check your connection and try again.");
    }
  }
  function confirmCancel(s: GivingSchedule): void {
    Alert.alert(
      "Cancel recurring gift?",
      `Your ${freqLabel(s.frequency).toLowerCase()} gift of ${kshMinor(s.amount_minor)} to ${s.fund} will stop. You can set up a new one anytime.`,
      [
        { text: "Keep giving", style: "cancel" },
        { text: "Cancel gift", style: "destructive", onPress: () => void cancelSchedule(s) },
      ],
    );
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Glow size={200} color="rgba(201,162,39,0.12)" style={{ right: -50, top: -40 }} />
        {nav.canGoBack() ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
            <ArrowLeft size={20} color={palette.onNavy} />
          </Pressable>
        ) : null}
        <T variant="micro" tone="gold" style={st.kicker}>GIVE</T>
        <T serif tone="onNavy" style={{ fontSize: 26, marginTop: 4 }}>Sow into the Kingdom</T>
        <T variant="caption" tone="onNavyDim" style={{ marginTop: 2 }}>Generosity is worship — a quiet, joyful act.</T>
        {yearTotal > 0 ? (
          <View style={st.yearPill}>
            <BadgeCheck size={13} color={palette.gold} />
            <T variant="micro" tone="gold" style={{ fontWeight: "700" }}>{`${kshMinor(yearTotal)} given this year`}</T>
          </View>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.screen, gap: spacing.base, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {lastGift ? (
          <View style={st.repeatCard}>
            <View style={st.repeatIcon}><RotateCcw size={18} color={palette.goldLo} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading" style={{ fontSize: 15 }}>Repeat last gift</T>
              <T variant="micro" tone="tertiary" style={{ marginTop: 2, textTransform: "capitalize" }}>{`${kshMinor(lastGift.amount_minor)} · ${lastGift.fund} · via ${methodLabel(lastGift.method)}`}</T>
            </View>
            <Pressable accessibilityRole="button" onPress={repeatLast} style={({ pressed }) => [st.repeatBtn, pressed && { opacity: 0.85 }]}>
              <T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>Give again</T>
            </Pressable>
          </View>
        ) : null}

        {/* Funds */}
        <View>
          <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>CHOOSE A FUND</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.base }}>
            {FUNDS.map((f) => {
              const on = f.code === fundCode;
              return (
                <Pressable key={f.code} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFundCode(f.code)} style={[st.fundCard, on && st.fundCardOn]}>
                  <View style={[st.fundIcon, { backgroundColor: f.tint }]}><f.Icon size={18} color={f.fg} /></View>
                  <T variant="heading" style={{ fontSize: 14, marginTop: spacing.sm }}>{f.label}</T>
                  <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{f.tagline}</T>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Amount */}
        <Pressable accessibilityRole="button" accessibilityLabel="Edit amount" onPress={() => setSheet("keypad")} style={st.amountCard}>
          <T variant="overline" tone="tertiary">AMOUNT</T>
          <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: spacing.sm }}>
            <T serif style={st.currency}>KSh </T>
            <T serif style={st.bigNum}>{amount.toLocaleString()}</T>
          </View>
          <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{`${fund.label} · ${freq === "once" ? "one-time" : freq}`}</T>
          <View style={st.presets}>
            {PRESETS.map((v) => {
              const on = amount === v;
              return (
                <Pressable key={v} accessibilityRole="button" onPress={() => setAmount(v)} style={[st.preset, on ? { backgroundColor: palette.navy } : { backgroundColor: palette.surface }]}>
                  <T variant="caption" style={{ color: on ? palette.white : palette.ink600, fontWeight: "600" }}>{v.toLocaleString()}</T>
                </Pressable>
              );
            })}
            <Pressable accessibilityRole="button" onPress={() => setSheet("keypad")} style={[st.preset, st.presetCustom]}>
              <T variant="caption" style={{ color: palette.goldLo, fontWeight: "700" }}>Custom</T>
            </Pressable>
          </View>
        </Pressable>

        {/* Frequency (functional) */}
        <View style={st.freqRow}>
          {([{ key: "once", label: "One-time" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }] as { key: Freq; label: string }[]).map((f) => {
            const on = freq === f.key;
            return (
              <Pressable key={f.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFreq(f.key)} style={[st.freqItem, on && st.freqItemOn]}>
                <T variant="caption" style={{ color: on ? palette.navy : palette.ink600, fontWeight: on ? "700" : "400" }}>{f.label}</T>
              </Pressable>
            );
          })}
        </View>

        {recurring ? (
          <View style={st.recurCard}>
            <View style={st.repeatIcon}><Repeat size={16} color={palette.goldLo} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading" style={{ fontSize: 14 }}>{`${ksh(total)} every ${cadence}`}</T>
              <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>First gift today, then automatically. Cancel anytime.</T>
            </View>
          </View>
        ) : null}

        {/* Choose how to pay — inline, selectable, reorderable list (Figma) */}
        <View>
          <View style={st.payHead}>
            <T variant="overline" tone="secondary">CHOOSE HOW TO PAY</T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <GripVertical size={12} color={palette.ink300} />
              <T variant="micro" tone="tertiary">Drag to reorder</T>
            </View>
          </View>
          {methodOrder.map((key, i) => {
            const m = METHODS.find((x) => x.key === key)!;
            const on = m.key === method;
            const sub = (m.key === "mpesa" || m.key === "airtel") && on && phoneHint ? phoneHint : m.sub;
            const soon = !PROVIDER[m.key];
            return (
              <View key={m.key} style={[st.methodCard, on && st.methodCardOn]}>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { setMethod(m.key); setSheet("details"); }} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <BrandGlyph k={m.key} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="heading" style={{ fontSize: 14 }}>{`Pay with ${m.label}`}</T>
                    <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{sub}</T>
                  </View>
                  {soon ? <View style={st.soonChip}><T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", fontSize: 9 }}>SOON</T></View> : on ? <View style={st.checkDisc}><Check size={12} color={palette.white} /></View> : null}
                </Pressable>
                <View style={st.moveCol}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move ${m.label} up`} disabled={i === 0} onPress={() => moveMethod(m.key, -1)} hitSlop={6} style={i === 0 && { opacity: 0.25 }}>
                    <ChevronUp size={16} color={palette.ink400} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move ${m.label} down`} disabled={i === methodOrder.length - 1} onPress={() => moveMethod(m.key, 1)} hitSlop={6} style={i === methodOrder.length - 1 && { opacity: 0.25 }}>
                    <ChevronDown size={16} color={palette.ink400} />
                  </Pressable>
                </View>
                <GripVertical size={16} color={palette.ink300} />
              </View>
            );
          })}
        </View>

        {/* Cover the fee */}
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: coverFee }} onPress={() => setCoverFee((v) => !v)} style={st.feeRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="heading" style={{ fontSize: 14 }}>Cover the transaction fee</T>
            <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{fee > 0 ? `Adds ${ksh(fee)} — 100% reaches the fund` : "100% of your gift reaches the fund"}</T>
          </View>
          <View style={[st.switch, coverFee && { backgroundColor: palette.gold }]}>
            <View style={[st.knob, coverFee && { transform: [{ translateX: 18 }] }]} />
          </View>
        </Pressable>

        {/* Active schedules — side-by-side summary cards (tap for detail + cancel) */}
        {active.length > 0 ? (
          <View>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>ACTIVE SCHEDULES</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {active.map((s) => (
                <Pressable
                  key={s.schedule_id}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.fund} ${freqLabel(s.frequency)}, ${kshMinor(s.amount_minor)}`}
                  onPress={() => setScheduleDetail(s)}
                  style={({ pressed }) => [st.scheduleCard, pressed && { backgroundColor: palette.surface }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Repeat size={14} color={palette.goldLo} />
                    <T variant="micro" tone="gold" style={{ fontWeight: "700", letterSpacing: 0.8 }}>{s.frequency === "weekly" ? "WEEKLY" : "MONTHLY"}</T>
                  </View>
                  <T serif style={{ fontSize: 22, color: palette.ink, marginTop: spacing.sm }}>{kshMinor(s.amount_minor)}</T>
                  <T variant="caption" tone="secondary" style={{ marginTop: 2, textTransform: "capitalize" }}>{s.fund}</T>
                  <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm }}>{`Next ${when(s.next_run_at)}`}</T>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Recent giving — quick peek; full ledger lives in the statement */}
        <View>
          <View style={st.payHead}>
            <T variant="overline" tone="secondary">RECENT GIVING</T>
            <Pressable accessibilityRole="button" accessibilityLabel="View statement" onPress={() => nav.navigate("GivingStatement")} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <T variant="caption" tone="gold" style={{ fontWeight: "700" }}>View statement</T>
                <ChevronRight size={14} color={palette.goldLo} />
              </View>
            </Pressable>
          </View>
          {historyLoading && (!history || history.length === 0) ? (
            <View style={st.group}><View style={st.emptyRow}><T variant="caption" tone="tertiary">Loading…</T></View></View>
          ) : !history || history.length === 0 ? (
            <View style={st.group}>
              <View style={st.emptyRow}>
                <View style={st.emptyIcon}><HandHeart size={18} color={palette.ink400} /></View>
                <T variant="caption" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center" }}>No giving yet</T>
                <T variant="micro" tone="tertiary" style={{ marginTop: 2, textAlign: "center" }}>Your gifts will appear here once you give.</T>
              </View>
            </View>
          ) : (
            <View style={st.group}>
              {history.slice(0, 3).map((g, i, arr) => (
                <Pressable
                  key={g.transaction_id}
                  accessibilityRole="button"
                  accessibilityLabel={`${g.fund} ${kshMinor(g.amount_minor)}`}
                  onPress={() => setHistoryDetail(g)}
                  style={({ pressed }) => [st.histRow, i < arr.length - 1 && st.divider, pressed && { backgroundColor: palette.surface }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="heading" style={{ fontSize: 14, textTransform: "capitalize" }}>{g.fund}</T>
                    <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{`${when(g.created_at)} · ${methodLabel(g.method)}`}</T>
                  </View>
                  <T serif style={{ fontSize: 15, color: palette.ink }}>{kshMinor(g.amount_minor)}</T>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Scripture strip */}
        <View style={st.verse}>
          <Quote size={16} color={palette.goldLo} />
          <T serif style={{ fontSize: 15, lineHeight: 23, color: palette.ink, fontStyle: "italic", marginTop: spacing.sm }}>
            “Each of you should give what you have decided in your heart to give.”
          </T>
          <T variant="micro" tone="gold" style={{ marginTop: spacing.sm, fontWeight: "700" }}>2 Corinthians 9:7</T>
        </View>

        <View style={st.trust}>
          <ShieldCheck size={14} color={palette.ink400} />
          <T variant="micro" tone="tertiary">Secure · M-Pesa &amp; card · Receipt sent instantly</T>
        </View>
      </ScrollView>

      <View style={st.ctaBar}>
        <PButton variant="gold" onPress={() => void give()} disabled={amount <= 0}>
          {recurring ? `Schedule ${ksh(total)} / ${cadence}` : `Give ${ksh(total)}  →`}
        </PButton>
      </View>

      {sheet === "keypad" ? (
        <KeypadSheet fundLabel={fund.label} initial={amount} onClose={() => setSheet("none")} onSubmit={(v) => { setAmount(v); setSheet("none"); }} />
      ) : null}
      {sheet === "details" ? (
        <PaymentDetailsSheet method={method} phoneHint={phoneHint} onClose={() => setSheet("none")} onGive={() => { setSheet("none"); void give(); }} />
      ) : null}
      {scheduleDetail ? (
        <ScheduleDetailSheet schedule={scheduleDetail} onClose={() => setScheduleDetail(null)} onCancel={() => confirmCancel(scheduleDetail)} />
      ) : null}
      {historyDetail ? (
        <HistoryDetailSheet record={historyDetail} onClose={() => setHistoryDetail(null)} />
      ) : null}
      {ceremony ? <CeremonyOverlay c={ceremony} onDismiss={dismiss} onRetry={() => { setCeremony(null); void give(); }} onConfirmPayPal={(id) => void confirmPayPal(id)} /> : null}
    </View>
  );
}

/* ---------- keypad ---------- */
function KeypadSheet({ fundLabel, initial, onClose, onSubmit }: { fundLabel: string; initial: number; onClose: () => void; onSubmit: (v: number) => void }): ReactElement {
  const [text, setText] = useState(initial > 0 ? String(initial) : "");
  const value = Number(text || "0");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"];
  function press(k: string): void {
    if (k === "del") setText((t) => t.slice(0, -1));
    else setText((t) => (t.length < 7 ? (t === "0" ? k : t + k) : t));
  }
  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={st.sheet}>
        <View style={st.grab} />
        <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>{`CUSTOM AMOUNT · ${fundLabel.toUpperCase()}`}</T>
        <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: spacing.sm }}>
          <T serif style={{ fontSize: 24, color: palette.ink400, marginTop: 8 }}>KSh </T>
          <T serif style={{ fontSize: 40, fontWeight: "700", color: palette.ink, letterSpacing: -1 }}>{value.toLocaleString()}</T>
        </View>
        <View style={st.keypad}>
          {keys.map((k) => (
            <Pressable key={k} accessibilityRole="button" onPress={() => press(k)} style={({ pressed }) => [st.key, pressed && { backgroundColor: palette.surface }]}>
              {k === "del" ? <Delete size={20} color={palette.ink} /> : <T serif style={{ fontSize: 22, color: palette.ink }}>{k}</T>}
            </Pressable>
          ))}
        </View>
        <PButton variant="gold" onPress={() => onSubmit(value)} disabled={value <= 0}>{`Give ${ksh(value)}`}</PButton>
      </View>
    </View>
  );
}

/* ---------- brand glyph (circular, per method) ---------- */
function BrandGlyph({ k }: { k: UIMethod }): ReactElement {
  if (k === "equity") return <View style={[st.glyph, { backgroundColor: "#A6093D" }]}><Landmark size={18} color={palette.white} /></View>;
  if (k === "card") return <View style={[st.glyph, { backgroundColor: "#EEF0FF" }]}><CreditCard size={18} color="#6366F1" /></View>;
  if (k === "wallet") return <View style={[st.glyph, { backgroundColor: "#EEF0FF" }]}><Wallet size={18} color="#6366F1" /></View>;
  if (k === "paypal") return <View style={[st.glyph, { backgroundColor: "#E6F0FF" }]}><T variant="micro" style={{ color: "#0070BA", fontWeight: "800", fontSize: 11 }}>PP</T></View>;
  const m = METHODS.find((x) => x.key === k)!;
  return <View style={[st.glyph, { backgroundColor: m.badgeBg }]}><T variant="micro" style={{ color: palette.white, fontWeight: "800", fontSize: 8 }}>{m.badge}</T></View>;
}

/* ---------- per-method details ---------- */
function PaymentDetailsSheet({ method, phoneHint, onClose, onGive }: { method: UIMethod; phoneHint: string | null; onClose: () => void; onGive: () => void }): ReactElement {
  const [phone, setPhone] = useState(phoneHint ?? "");
  const [card, setCard] = useState("");
  const [paypal, setPaypal] = useState("");
  const [account, setAccount] = useState("");
  const [wallet, setWallet] = useState("Apple Pay");
  const soon = !PROVIDER[method];
  const title =
    method === "mpesa" ? "M-Pesa number" : method === "airtel" ? "Airtel Money number" :
    method === "equity" ? "Equity Bank account" : method === "card" ? "Card details" :
    method === "wallet" ? "Wallet" : "PayPal account";

  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={st.sheet}>
        <View style={st.grab} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>{title.toUpperCase()}</T>
          <Pressable onPress={onClose}><X size={18} color={palette.navy} /></Pressable>
        </View>

        {soon ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <View style={st.soonDisc}><Lock size={22} color={palette.goldLo} /></View>
            <T variant="heading" style={{ marginTop: spacing.md, textAlign: "center" }}>Coming soon</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center", maxWidth: 280 }}>
              {METHODS.find((m) => m.key === method)?.label} isn’t live yet. For now, give with M-Pesa, Airtel Money or Card.
            </T>
          </View>
        ) : method === "mpesa" || method === "airtel" ? (
          <>
            <T variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>We’ll send the payment prompt to this number.</T>
            <View style={st.inputRow}><Smartphone size={18} color={palette.goldLo} /><TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="07XX XXX XXX" placeholderTextColor={palette.ink400} style={st.inputFlex} /></View>
          </>
        ) : method === "card" ? (
          <>
            <T variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>Card is processed securely via Stripe.</T>
            <View style={st.inputRow}><CreditCard size={18} color={palette.ink400} /><TextInput value={card} onChangeText={setCard} keyboardType="number-pad" placeholder="Card number" placeholderTextColor={palette.ink400} style={st.inputFlex} /></View>
          </>
        ) : method === "paypal" ? (
          <View style={st.inputRow}><T variant="micro" style={{ color: "#0070BA", fontWeight: "800" }}>PP</T><TextInput value={paypal} onChangeText={setPaypal} keyboardType="email-address" placeholder="name@email.com" placeholderTextColor={palette.ink400} style={st.inputFlex} /></View>
        ) : method === "equity" ? (
          <View style={st.inputRow}><Landmark size={18} color="#A6093D" /><TextInput value={account} onChangeText={setAccount} keyboardType="number-pad" placeholder="Account number" placeholderTextColor={palette.ink400} style={st.inputFlex} /></View>
        ) : (
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {["Apple Pay", "Google Pay"].map((w) => (
              <Pressable key={w} onPress={() => setWallet(w)} style={[st.methodOpt, wallet === w && st.methodOptOn]}>
                <Wallet size={18} color="#6366F1" /><T variant="heading" style={{ fontSize: 14, flex: 1 }}>{w}</T>
                {wallet === w ? <Check size={16} color={palette.gold} strokeWidth={3} /> : null}
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ marginTop: spacing.base }}>
          {soon ? <PButton variant="ghost" onPress={onClose}>Choose another method</PButton> : <PButton variant="gold" onPress={onGive}>Give Now</PButton>}
        </View>
        {!soon ? <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm, textAlign: "center" }}>Used only for this transaction prompt</T> : null}
      </View>
    </View>
  );
}

/* ---------- recurring schedule detail + cancel ---------- */
function ScheduleDetailSheet({ schedule, onClose, onCancel }: { schedule: GivingSchedule; onClose: () => void; onCancel: () => void }): ReactElement {
  const rows: Array<{ Icon: LucideIcon; label: string; value: string }> = [
    { Icon: HandHeart, label: "Fund", value: schedule.fund },
    { Icon: Repeat, label: "Frequency", value: freqLabel(schedule.frequency) },
    { Icon: CalendarClock, label: "Next charge", value: whenFull(schedule.next_run_at) },
    { Icon: CreditCard, label: "Method", value: methodLabel(schedule.method) },
  ];
  if (schedule.last_run_at) rows.push({ Icon: RotateCcw, label: "Last charge", value: whenFull(schedule.last_run_at) });
  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={st.sheet}>
        <View style={st.grab} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>RECURRING GIFT</T>
          <Pressable onPress={onClose} accessibilityLabel="Close"><X size={18} color={palette.navy} /></Pressable>
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: spacing.base }}>
          <T serif style={{ fontSize: 24, color: palette.ink400, marginTop: 6 }}>KSh </T>
          <T serif style={{ fontSize: 40, fontWeight: "700", color: palette.ink, letterSpacing: -1 }}>{(schedule.amount_minor / 100).toLocaleString()}</T>
          <T variant="caption" tone="tertiary" style={{ marginLeft: 6, marginTop: 14 }}>{freqLabel(schedule.frequency).toLowerCase()}</T>
        </View>

        <View style={[st.group, { marginTop: spacing.base }]}>
          {rows.map((r, i) => (
            <View key={r.label} style={[st.detailRow, i < rows.length - 1 && st.divider]}>
              <View style={st.detailIcon}><r.Icon size={16} color={palette.ink400} /></View>
              <T variant="caption" tone="secondary" style={{ flex: 1 }}>{r.label}</T>
              <T variant="heading" style={{ fontSize: 14, textTransform: "capitalize" }}>{r.value}</T>
            </View>
          ))}
        </View>

        <View style={{ marginTop: spacing.base }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel schedule"
            onPress={onCancel}
            style={({ pressed }) => [st.cancelBtn, pressed && { opacity: 0.85 }]}
          >
            <T variant="heading" style={{ fontSize: 15, color: palette.error, fontWeight: "700" }}>Cancel schedule</T>
          </Pressable>
        </View>
        <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm, textAlign: "center" }}>Cancelling stops future charges. Past gifts are unaffected.</T>
      </View>
    </View>
  );
}

/* ---------- giving history detail ---------- */
function HistoryDetailSheet({ record, onClose }: { record: GivingRecord; onClose: () => void }): ReactElement {
  const chip = historyStatusChip(record.status);
  const rows: Array<{ Icon: LucideIcon; label: string; value: string }> = [
    { Icon: HandHeart, label: "Fund", value: record.fund },
    { Icon: CalendarClock, label: "Given", value: whenFull(record.created_at) },
  ];
  if (record.settled_at) rows.push({ Icon: Check, label: "Settled", value: whenFull(record.settled_at) });
  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={st.sheet}>
        <View style={st.grab} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>GIFT DETAIL</T>
          <Pressable onPress={onClose} accessibilityLabel="Close"><X size={18} color={palette.navy} /></Pressable>
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: spacing.base }}>
          <T serif style={{ fontSize: 24, color: palette.ink400, marginTop: 6 }}>KSh </T>
          <T serif style={{ fontSize: 40, fontWeight: "700", color: palette.ink, letterSpacing: -1 }}>{(record.amount_minor / 100).toLocaleString()}</T>
        </View>
        <View style={[st.statusChip, { backgroundColor: chip.bg, alignSelf: "flex-start", marginTop: spacing.sm }]}>
          <T variant="micro" style={{ color: chip.fg, fontWeight: "700", fontSize: 10 }}>{chip.label.toUpperCase()}</T>
        </View>

        <View style={[st.group, { marginTop: spacing.base }]}>
          {rows.map((r, i) => (
            <View key={r.label} style={[st.detailRow, i < rows.length - 1 && st.divider]}>
              <View style={st.detailIcon}><r.Icon size={16} color={palette.ink400} /></View>
              <T variant="caption" tone="secondary" style={{ flex: 1 }}>{r.label}</T>
              <T variant="heading" style={{ fontSize: 14, textTransform: "capitalize" }}>{r.value}</T>
            </View>
          ))}
        </View>

        <View style={{ marginTop: spacing.base }}>
          <PButton variant="ghost" onPress={onClose}>Done</PButton>
        </View>
      </View>
    </View>
  );
}

/* ---------- ceremony ---------- */
function CeremonyOverlay({ c, onDismiss, onRetry, onConfirmPayPal }: { c: Ceremony; onDismiss: () => void; onRetry: () => void; onConfirmPayPal: (orderId: string) => void }): ReactElement {
  const mm = c.method === "mpesa" || c.method === "airtel";
  const paypal = c.note === "paypal" || c.note === "paypal-capturing";
  if (c.phase === "stk" && paypal) {
    const capturing = c.note === "paypal-capturing";
    return (
      <View style={st.ceremonyNavy}>
        <Glow size={260} color="rgba(201,162,39,0.14)" style={{ alignSelf: "center", top: 80 }} />
        <View style={st.stkDisc}>{capturing ? <Loader size={30} color={palette.gold} /> : <T serif style={{ fontSize: 22, color: palette.gold, fontWeight: "800" }}>PP</T>}</View>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: spacing.xl, textAlign: "center" }}>Approve in PayPal</T>
        <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 290 }}>
          {`We've opened PayPal to approve $${c.amount.toLocaleString()} to ${c.fund}. Once you've approved, tap Confirm to complete it.`}
        </T>
        <T variant="micro" tone="onNavyFaint" style={{ marginTop: spacing.lg }}>{capturing ? "Confirming with PayPal…" : "PayPal gifts are charged in US$"}</T>
        <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 48, gap: spacing.sm }}>
          <PButton variant="gold" onPress={() => onConfirmPayPal(c.ref)} disabled={capturing}>{capturing ? "Confirming…" : "I've approved — Confirm"}</PButton>
          <PButton variant="ghostDark" onPress={onDismiss}>Cancel</PButton>
        </View>
      </View>
    );
  }
  if (c.phase === "stk") {
    return (
      <View style={st.ceremonyNavy}>
        <Glow size={260} color="rgba(201,162,39,0.14)" style={{ alignSelf: "center", top: 80 }} />
        <View style={st.stkDisc}><Loader size={30} color={palette.gold} /></View>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: spacing.xl, textAlign: "center" }}>{mm ? "Check your phone" : "Completing your gift"}</T>
        <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 280 }}>
          {mm ? `Enter your ${c.method === "mpesa" ? "M-Pesa" : "Airtel Money"} PIN to complete ${ksh(c.amount)} to ${c.fund}.` : `Securing ${ksh(c.amount)} to ${c.fund} with Stripe.`}
        </T>
        <T variant="micro" tone="onNavyFaint" style={{ marginTop: spacing.lg }}>{c.note ?? "Waiting up to 60s…"}</T>
        <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 48 }}><PButton variant="ghostDark" onPress={onDismiss}>Done</PButton></View>
      </View>
    );
  }
  if (c.phase === "success") {
    return (
      <View style={st.ceremonyCream}>
        <View style={st.successDisc}><Check size={34} color={palette.white} /></View>
        <T serif style={{ fontSize: 26, color: palette.ink, marginTop: spacing.xl, textAlign: "center" }}>{c.scheduled ? "Your recurring gift is set" : "Thank you for your generosity"}</T>
        <T variant="body" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center" }}>
          {c.scheduled ? `${ksh(c.amount)} · ${c.fund} · recurring` : `${ksh(c.amount)} · ${c.fund}${c.ref ? ` · Ref ${c.ref.slice(0, 10).toUpperCase()}` : ""}`}
        </T>
        <T variant="micro" tone="tertiary" style={{ marginTop: spacing.md }}>{c.scheduled ? "Manage it anytime under Recurring giving." : "Your receipt is saved to Recent giving."}</T>
        <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 48 }}><PButton variant="primary" onPress={onDismiss}>Done</PButton></View>
      </View>
    );
  }
  const offline = c.note === "offline";
  const soon = c.note === "soon";
  return (
    <View style={st.ceremonyCream}>
      <View style={st.failDisc}><X size={32} color={palette.white} /></View>
      <T serif style={{ fontSize: 24, color: palette.ink, marginTop: spacing.xl, textAlign: "center" }}>
        {offline ? "Giving needs a connection" : soon ? "Method coming soon" : "That didn’t go through"}
      </T>
      <T variant="body" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 300 }}>
        {offline ? "You’re offline. Giving resumes when you reconnect." : soon ? "This payment method isn’t live yet. Try M-Pesa, Airtel Money or Card." : "Your amount and fund are saved. Try again whenever you’re ready."}
      </T>
      <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 48, gap: spacing.sm }}>
        {!offline && !soon ? <PButton variant="gold" onPress={onRetry}>Try again</PButton> : null}
        <PButton variant="ghost" onPress={onDismiss}>Close</PButton>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  header: { backgroundColor: palette.navy, paddingTop: 54, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg, overflow: "hidden" },
  kicker: { letterSpacing: 2, textTransform: "uppercase" },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  yearPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: spacing.md, borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  repeatCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.priorityBg, borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", borderRadius: 18, padding: spacing.base },
  recurCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.priorityBg, borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", borderRadius: 18, padding: spacing.base },
  repeatIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  repeatBtn: { backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 8 },
  fundCard: { width: 124, backgroundColor: palette.white, borderRadius: 16, borderWidth: 2, borderColor: palette.border, padding: spacing.md, ...shadow.card },
  fundCardOn: { borderColor: palette.gold, backgroundColor: palette.priorityBg },
  fundIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  amountCard: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  currency: { fontSize: 22, color: palette.ink400, marginTop: 8, lineHeight: 26 },
  bigNum: { fontSize: 44, fontWeight: "700", letterSpacing: -1.5, color: palette.ink, lineHeight: 48 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.base },
  preset: { height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  presetCustom: { borderWidth: 1, borderColor: "rgba(201,162,39,0.5)", backgroundColor: "transparent" },
  freqRow: { flexDirection: "row", gap: 4, backgroundColor: "rgba(10,37,64,0.06)", borderRadius: radii.control, padding: 5 },
  freqItem: { flex: 1, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  freqItemOn: { backgroundColor: palette.white, ...shadow.card },
  soonChip: { backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 2 },
  payHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  methodCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: 16, borderWidth: 1.5, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.sm, ...shadow.card },
  methodCardOn: { borderColor: palette.gold, backgroundColor: palette.priorityBg },
  glyph: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  feeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: "rgba(10,37,64,0.18)", padding: 3, justifyContent: "center" },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.white },
  group: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  histRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, justifyContent: "space-between", paddingHorizontal: spacing.base, paddingVertical: 13 },
  divider: { borderBottomWidth: 1, borderBottomColor: "rgba(10,37,64,0.06)" },
  emptyRow: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.base, paddingVertical: spacing.lg },
  emptyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.mutedBg, alignItems: "center", justifyContent: "center" },
  recurIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  scheduleCard: { flexGrow: 1, flexBasis: "46%", minWidth: 150, backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  statusChip: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: 13 },
  detailIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  cancelBtn: { height: 52, borderRadius: radii.button, borderWidth: 1, borderColor: "rgba(212,24,61,0.4)", backgroundColor: "rgba(212,24,61,0.06)", alignItems: "center", justifyContent: "center" },
  verse: { backgroundColor: palette.verseBg, borderRadius: 18, borderWidth: 1, borderColor: "rgba(201,162,39,0.3)", padding: spacing.base },
  trust: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingVertical: spacing.sm },
  ctaBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: 28, backgroundColor: "rgba(244,240,232,0.96)", borderTopWidth: 1, borderTopColor: palette.border },
  sheetWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: palette.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: 40 },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(10,37,64,0.15)", marginBottom: spacing.base },
  keypad: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.lg, marginBottom: spacing.base },
  key: { width: "33.33%", height: 56, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  methodOpt: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: spacing.md, marginBottom: spacing.sm },
  methodOptOn: { borderColor: palette.gold, backgroundColor: palette.priorityBg },
  checkDisc: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  moveCol: { alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 16, paddingHorizontal: spacing.base, marginTop: spacing.sm },
  inputFlex: { flex: 1, paddingVertical: 12, fontSize: 16, color: palette.navy, fontWeight: "600" },
  soonDisc: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  ceremonyNavy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.navyCeremony, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, overflow: "hidden" },
  ceremonyCream: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.paper, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  stkDisc: { width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(201,162,39,0.16)", borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", alignItems: "center", justifyContent: "center" },
  successDisc: { width: 84, height: 84, borderRadius: 42, backgroundColor: palette.success, alignItems: "center", justifyContent: "center" },
  failDisc: { width: 80, height: 80, borderRadius: 40, backgroundColor: palette.error, alignItems: "center", justifyContent: "center" },
} as const;
