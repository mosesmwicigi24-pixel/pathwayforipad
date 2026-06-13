// Give (new design, spec §11; Contract Matrix M2 over B7; §1.10 C, §5.6).
// M-Pesa-first: repeat-last-gift, fund cards, big-number amount with a keypad
// sheet, payment-method sheet, cover-the-fee toggle, real recent-giving ledger,
// and a sticky CTA. Money is online-only and server-authoritative — we create an
// intent, then watch the real ledger for settlement (STK → success / failed).
// We NEVER fake a successful gift and NEVER queue money offline (§5.6).
import { useCallback, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  Delete,
  Gift,
  Globe,
  HandHeart,
  Loader,
  Percent,
  Quote,
  RotateCcw,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { assertOnlineForGiving, getConnectivity } from "../net/connectivity";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, PButton, T } from "../theme/components";
import { useGivingHistory, useMe, useSchedules } from "../api/hooks";
import { invalidateQueries } from "../api/query";
import type { GivingMethod, GivingRecord } from "../api/types";

const CURRENCY = "KES";

function ksh(n: number): string {
  return `KSh ${n.toLocaleString()}`;
}
function kshMinor(minor: number): string {
  return `KSh ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}
function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function thisYear(iso: string): boolean {
  return iso.slice(0, 4) === new Date().toISOString().slice(0, 4);
}
const SETTLED = new Set(["succeeded", "settled", "completed"]);

/** A transparent estimate of the mobile-money/processor fee, in KSh, shown only
 *  when the member opts to cover it. The whole charged amount goes through giving. */
function feeFor(amount: number): number {
  if (amount <= 0) return 0;
  if (amount <= 100) return 0;
  if (amount <= 500) return 7;
  if (amount <= 1000) return 13;
  if (amount <= 1500) return 23;
  if (amount <= 2500) return 33;
  if (amount <= 3500) return 53;
  if (amount <= 5000) return 57;
  return Math.round(amount * 0.012);
}

type FundDef = { code: string; label: string; tagline: string; Icon: LucideIcon; tint: string; fg: string };
const FUNDS: FundDef[] = [
  { code: "tithe", label: "Tithe", tagline: "A faithful portion", Icon: Percent, tint: palette.goldTint, fg: palette.goldLo },
  { code: "offering", label: "Offering", tagline: "Freewill worship", Icon: HandHeart, tint: "#FEE2E2", fg: "#B91C1C" },
  { code: "gift", label: "Gift", tagline: "A special gift", Icon: Gift, tint: "#F3E8FF", fg: "#7E22CE" },
  { code: "mission", label: "Mission", tagline: "Beyond our walls", Icon: Globe, tint: "#E0F2FE", fg: "#0369A1" },
  { code: "general", label: "General", tagline: "Where needed most", Icon: BookOpen, tint: palette.successBg, fg: palette.successText },
];
const DEFAULT_FUND: FundDef = FUNDS[0]!;
const PRESETS = [200, 500, 1000, 2500, 5000];

type MethodDef = { key: GivingMethod; label: string; sub: string; mobileMoney: boolean };
const METHODS: MethodDef[] = [
  { key: "mpesa", label: "M-Pesa", sub: "STK push to your phone", mobileMoney: true },
  { key: "airtel", label: "Airtel Money", sub: "Mobile money", mobileMoney: true },
  { key: "card", label: "Card", sub: "Visa · Mastercard", mobileMoney: false },
];
const DEFAULT_METHOD: MethodDef = METHODS[0]!;

type Phase = "stk" | "success" | "failed";
type Ceremony = { phase: Phase; amount: number; fund: string; method: GivingMethod; ref: string; note?: string };

export function GivingScreen(): ReactElement {
  const nav = useNavigation();
  const { data: history } = useGivingHistory();
  const { data: schedules, refetch: refetchSchedules } = useSchedules();
  const { data: me } = useMe();

  const [fundCode, setFundCode] = useState("tithe");
  const [amount, setAmount] = useState(1000);
  const [method, setMethod] = useState<GivingMethod>("mpesa");
  const [coverFee, setCoverFee] = useState(false);
  const [sheet, setSheet] = useState<"none" | "keypad" | "method">("none");
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const pollRef = useRef(false);

  const fund = FUNDS.find((f) => f.code === fundCode) ?? DEFAULT_FUND;
  const methodDef = METHODS.find((m) => m.key === method) ?? DEFAULT_METHOD;
  const fee = coverFee ? feeFor(amount) : 0;
  const total = amount + fee;

  const lastGift = (history ?? []).find((g) => SETTLED.has(g.status)) ?? (history ?? [])[0] ?? null;
  const yearTotal = (history ?? [])
    .filter((g) => SETTLED.has(g.status) && thisYear(g.created_at))
    .reduce((s, g) => s + g.amount_minor, 0);
  const active = (schedules ?? []).filter((s) => s.status === "active");
  const phoneHint = me?.profile?.phone_number ?? null;

  /** Watch the real ledger until this gift settles or fails (never faked). */
  const watchSettlement = useCallback(async (txnId: string, base: Omit<Ceremony, "phase">): Promise<void> => {
    pollRef.current = true;
    for (let i = 0; i < 10 && pollRef.current; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      if (!pollRef.current) return;
      let rows: GivingRecord[] = [];
      try {
        rows = await NuruApi.givingHistory();
      } catch {
        continue;
      }
      const row = rows.find((g) => g.transaction_id === txnId);
      if (!row) continue;
      if (SETTLED.has(row.status)) {
        invalidateQueries("giving");
        setCeremony({ ...base, phase: "success" });
        return;
      }
      if (row.status === "failed" || row.status === "cancelled") {
        setCeremony({ ...base, phase: "failed" });
        return;
      }
    }
    // Still pending: tell the truth — settlement confirms out of band.
    if (pollRef.current) {
      invalidateQueries("giving");
      setCeremony({
        ...base,
        phase: "stk",
        note: "Still waiting on confirmation. Your gift will appear on your statement once it settles.",
      });
    }
  }, []);

  async function give(): Promise<void> {
    if (amount <= 0) return;
    // §5.6: never queue money offline — offline gets a kind, distinct message.
    try {
      await assertOnlineForGiving(getConnectivity());
    } catch {
      setCeremony({ phase: "failed", amount: total, fund: fund.label, method, ref: "", note: "offline" });
      return;
    }
    let res: { transaction_id: string; provider_ref?: string };
    try {
      res = await NuruApi.giving({
        fund: fund.code,
        amount_minor: total * 100,
        currency: CURRENCY,
        method,
        ...(methodDef.mobileMoney && phoneHint ? { phone_number: phoneHint } : {}),
        idempotency_key: uuidv4(),
      });
    } catch {
      // Server/provider error (e.g. a method not configured) — not an offline state.
      setCeremony({ phase: "failed", amount: total, fund: fund.label, method, ref: "" });
      return;
    }
    const base = { amount: total, fund: fund.label, method, ref: res.provider_ref ?? res.transaction_id };
    setCeremony({ ...base, phase: "stk" });
    void watchSettlement(res.transaction_id, base);
  }

  function repeatLast(): void {
    if (!lastGift) return;
    const f = FUNDS.find((x) => x.code === lastGift.fund);
    if (f) setFundCode(f.code);
    setAmount(Math.round(lastGift.amount_minor / 100));
  }

  function dismiss(): void {
    pollRef.current = false;
    setCeremony(null);
  }

  async function cancelSchedule(id: string): Promise<void> {
    try {
      await NuruApi.cancelSchedule(id);
    } finally {
      void refetchSchedules();
    }
  }

  return (
    <View style={st.screen}>
      {/* ── Navy header ───────────────────────────────────────────── */}
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

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.screen, gap: spacing.base, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Repeat last gift */}
        {lastGift ? (
          <View style={st.repeatCard}>
            <View style={st.repeatIcon}><RotateCcw size={18} color={palette.goldLo} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading" style={{ fontSize: 15 }}>Repeat last gift</T>
              <T variant="micro" tone="tertiary" style={{ marginTop: 2, textTransform: "capitalize" }}>
                {`${kshMinor(lastGift.amount_minor)} · ${lastGift.fund}`}
              </T>
            </View>
            <Pressable accessibilityRole="button" onPress={repeatLast} style={({ pressed }) => [st.repeatBtn, pressed && { opacity: 0.85 }]}>
              <T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>Give again</T>
            </Pressable>
          </View>
        ) : null}

        {/* Choose a fund */}
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
          <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{`${fund.label} · one-time`}</T>
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

        {/* Frequency (recurring is a fast-follow — D-M3) */}
        <View style={st.freqRow}>
          {[
            { key: "once", label: "One-time", soon: false },
            { key: "weekly", label: "Weekly", soon: true },
            { key: "monthly", label: "Monthly", soon: true },
          ].map((f) => (
            <View key={f.key} style={[st.freqItem, f.key === "once" && st.freqItemOn]}>
              <T variant="caption" style={{ color: f.key === "once" ? palette.white : palette.ink600, fontWeight: f.key === "once" ? "700" : "400" }}>{f.label}</T>
              {f.soon ? <View style={st.soonChip}><T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", fontSize: 9 }}>SOON</T></View> : null}
            </View>
          ))}
        </View>

        {/* Paying with */}
        <Pressable accessibilityRole="button" onPress={() => setSheet("method")} style={st.payRow}>
          <View style={[st.methodTile, methodDef.mobileMoney && method === "mpesa" && { backgroundColor: "#16a34a" }, method === "airtel" && { backgroundColor: "#E2231A" }]}>
            <T variant="micro" style={{ color: palette.white, fontWeight: "800", fontSize: 9 }}>
              {method === "mpesa" ? "M-PESA" : method === "airtel" ? "AIRTEL" : "CARD"}
            </T>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="tertiary" style={{ letterSpacing: 1 }}>PAYING WITH</T>
            <T variant="heading" style={{ fontSize: 14, marginTop: 1 }}>{methodDef.label}</T>
          </View>
          <ChevronDown size={18} color={palette.ink400} />
        </Pressable>

        {/* Cover the fee */}
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: coverFee }} onPress={() => setCoverFee((v) => !v)} style={st.feeRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="heading" style={{ fontSize: 14 }}>Cover the transaction fee</T>
            <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>
              {fee > 0 ? `Adds ${ksh(fee)} — 100% reaches the fund` : "100% of your gift reaches the fund"}
            </T>
          </View>
          <View style={[st.switch, coverFee && { backgroundColor: palette.gold }]}>
            <View style={[st.knob, coverFee && { transform: [{ translateX: 18 }] }]} />
          </View>
        </Pressable>

        {/* Recent giving (real ledger) */}
        {history && history.length > 0 ? (
          <View>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>RECENT GIVING</T>
            <View style={st.group}>
              {history.slice(0, 4).map((g, i, arr) => (
                <View key={g.transaction_id} style={[st.histRow, i < arr.length - 1 && st.divider]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="heading" style={{ fontSize: 14, textTransform: "capitalize" }}>{g.fund}</T>
                    <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{`${when(g.created_at)} · ${g.status}`}</T>
                  </View>
                  <T serif style={{ fontSize: 15, color: palette.ink }}>{kshMinor(g.amount_minor)}</T>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Active recurring (kept so existing schedules stay cancellable) */}
        {active.length > 0 ? (
          <View>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>RECURRING GIVING</T>
            <View style={st.group}>
              {active.map((s, i) => (
                <View key={s.schedule_id} style={[st.histRow, i < active.length - 1 && st.divider]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="heading" style={{ fontSize: 14, textTransform: "capitalize" }}>{`${s.fund} · ${s.frequency}`}</T>
                    <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{`${kshMinor(s.amount_minor)} · next ${when(s.next_run_at)}`}</T>
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => void cancelSchedule(s.schedule_id)}>
                    <T variant="caption" style={{ color: palette.error, fontWeight: "600" }}>Cancel</T>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}

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

      {/* ── Sticky CTA ────────────────────────────────────────────── */}
      <View style={st.ctaBar}>
        <PButton variant="gold" onPress={() => void give()} disabled={amount <= 0}>
          {`Give ${ksh(total)}  →`}
        </PButton>
      </View>

      {/* ── Keypad sheet ──────────────────────────────────────────── */}
      {sheet === "keypad" ? (
        <KeypadSheet fundLabel={fund.label} initial={amount} onClose={() => setSheet("none")} onSubmit={(v) => { setAmount(v); setSheet("none"); }} />
      ) : null}

      {/* ── Method sheet ──────────────────────────────────────────── */}
      {sheet === "method" ? (
        <MethodSheet current={method} phoneHint={phoneHint} onPick={(m) => { setMethod(m); setSheet("none"); }} onClose={() => setSheet("none")} />
      ) : null}

      {/* ── Ceremony overlays ─────────────────────────────────────── */}
      {ceremony ? <CeremonyOverlay c={ceremony} onDismiss={dismiss} onRetry={() => { setCeremony(null); void give(); }} /> : null}
    </View>
  );
}

// ── Keypad sheet ─────────────────────────────────────────────────────
function KeypadSheet({ fundLabel, initial, onClose, onSubmit }: { fundLabel: string; initial: number; onClose: () => void; onSubmit: (v: number) => void }): ReactElement {
  const [text, setText] = useState(initial > 0 ? String(initial) : "");
  const value = Number(text || "0");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];
  function press(k: string): void {
    if (k === "del") setText((t) => t.slice(0, -1));
    else if (k === ".") return; // KES has no minor units in the UI
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
            <Pressable key={k} accessibilityRole="button" disabled={k === "."} onPress={() => press(k)} style={({ pressed }) => [st.key, pressed && { backgroundColor: palette.surface }]}>
              {k === "del" ? <Delete size={20} color={palette.ink} /> : <T serif style={{ fontSize: 22, color: k === "." ? palette.ink400 : palette.ink }}>{k}</T>}
            </Pressable>
          ))}
        </View>
        <PButton variant="gold" onPress={() => onSubmit(value)} disabled={value <= 0}>{`Give ${ksh(value)}`}</PButton>
      </View>
    </View>
  );
}

// ── Method sheet ─────────────────────────────────────────────────────
function MethodSheet({ current, phoneHint, onPick, onClose }: { current: GivingMethod; phoneHint: string | null; onPick: (m: GivingMethod) => void; onClose: () => void }): ReactElement {
  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={st.sheet}>
        <View style={st.grab} />
        <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2, marginBottom: spacing.sm }}>PAYMENT METHOD</T>
        {METHODS.map((m) => {
          const on = m.key === current;
          const sub = m.key === "mpesa" && phoneHint ? phoneHint : m.sub;
          return (
            <Pressable key={m.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onPick(m.key)} style={[st.methodOpt, on && st.methodOptOn]}>
              <View style={[st.methodTile, m.key === "mpesa" && { backgroundColor: "#16a34a" }, m.key === "airtel" && { backgroundColor: "#E2231A" }]}>
                <T variant="micro" style={{ color: palette.white, fontWeight: "800", fontSize: 9 }}>{m.key === "mpesa" ? "M-PESA" : m.key === "airtel" ? "AIRTEL" : "CARD"}</T>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="heading" style={{ fontSize: 14 }}>{m.label}</T>
                <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{sub}</T>
              </View>
              {on ? <View style={st.checkDisc}><Check size={12} color={palette.white} /></View> : null}
            </Pressable>
          );
        })}
        <View style={[st.trust, { justifyContent: "center", marginTop: spacing.md }]}>
          <ShieldCheck size={13} color={palette.ink400} />
          <T variant="micro" tone="tertiary">Encrypted via Safaricom Daraja &amp; Stripe</T>
        </View>
      </View>
    </View>
  );
}

// ── Ceremony overlays (STK / success / failed) ───────────────────────
function CeremonyOverlay({ c, onDismiss, onRetry }: { c: Ceremony; onDismiss: () => void; onRetry: () => void }): ReactElement {
  const mobileMoney = c.method === "mpesa" || c.method === "airtel";
  if (c.phase === "stk") {
    return (
      <View style={st.ceremonyNavy}>
        <Glow size={260} color="rgba(201,162,39,0.14)" style={{ alignSelf: "center", top: 80 }} />
        <View style={st.stkDisc}><Loader size={30} color={palette.gold} /></View>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: spacing.xl, textAlign: "center" }}>
          {mobileMoney ? "Check your phone" : "Completing your gift"}
        </T>
        <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 280 }}>
          {mobileMoney
            ? `Enter your ${c.method === "mpesa" ? "M-Pesa" : "Airtel Money"} PIN to complete ${ksh(c.amount)} to ${c.fund}.`
            : `Securing ${ksh(c.amount)} to ${c.fund} with Stripe.`}
        </T>
        <T variant="micro" tone="onNavyFaint" style={{ marginTop: spacing.lg }}>{c.note ?? "Waiting up to 60s…"}</T>
        <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 48 }}>
          <PButton variant="ghostDark" onPress={onDismiss}>Done</PButton>
        </View>
      </View>
    );
  }
  if (c.phase === "success") {
    return (
      <View style={st.ceremonyCream}>
        <View style={st.successDisc}><Check size={34} color={palette.white} /></View>
        <T serif style={{ fontSize: 26, color: palette.ink, marginTop: spacing.xl, textAlign: "center" }}>Thank you for your generosity</T>
        <T variant="body" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center" }}>
          {`${ksh(c.amount)} · ${c.fund} · Ref ${c.ref.slice(0, 10).toUpperCase()}`}
        </T>
        <T variant="micro" tone="tertiary" style={{ marginTop: spacing.md }}>Your receipt is saved to Recent giving.</T>
        <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 48 }}>
          <PButton variant="primary" onPress={onDismiss}>Done</PButton>
        </View>
      </View>
    );
  }
  // failed
  const offline = c.note === "offline";
  return (
    <View style={st.ceremonyCream}>
      <View style={st.failDisc}><X size={32} color={palette.white} /></View>
      <T serif style={{ fontSize: 24, color: palette.ink, marginTop: spacing.xl, textAlign: "center" }}>
        {offline ? "Giving needs a connection" : "That didn't go through"}
      </T>
      <T variant="body" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 300 }}>
        {offline
          ? "You're offline. Your Pathway progress keeps saving locally — giving resumes when you reconnect."
          : "Your amount and fund are saved. Try again whenever you're ready."}
      </T>
      <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 48, gap: spacing.sm }}>
        {!offline ? <PButton variant="gold" onPress={onRetry}>Try again</PButton> : null}
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

  freqRow: { flexDirection: "row", gap: 4, backgroundColor: "rgba(10,37,64,0.05)", borderRadius: radii.control, padding: 5 },
  freqItem: { flex: 1, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  freqItemOn: { backgroundColor: palette.navy },
  soonChip: { backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 2 },

  payRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  methodTile: { width: 48, height: 32, borderRadius: 8, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },

  feeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: "rgba(10,37,64,0.18)", padding: 3, justifyContent: "center" },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.white },

  group: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  histRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.base, paddingVertical: 13 },
  divider: { borderBottomWidth: 1, borderBottomColor: "rgba(10,37,64,0.06)" },

  verse: { backgroundColor: palette.verseBg, borderRadius: 18, borderWidth: 1, borderColor: "rgba(201,162,39,0.3)", padding: spacing.base },
  trust: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingVertical: spacing.sm },

  ctaBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: 28, backgroundColor: "rgba(244,240,232,0.96)", borderTopWidth: 1, borderTopColor: palette.border },

  // sheets
  sheetWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: palette.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: 40 },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(10,37,64,0.15)", marginBottom: spacing.base },
  keypad: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.lg, marginBottom: spacing.base },
  key: { width: "33.33%", height: 56, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  methodOpt: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: spacing.md, marginBottom: spacing.sm },
  methodOptOn: { borderColor: palette.gold, backgroundColor: palette.priorityBg },
  checkDisc: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },

  // ceremony
  ceremonyNavy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.navyCeremony, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, overflow: "hidden" },
  ceremonyCream: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.paper, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  stkDisc: { width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(201,162,39,0.16)", borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", alignItems: "center", justifyContent: "center" },
  successDisc: { width: 84, height: 84, borderRadius: 42, backgroundColor: palette.success, alignItems: "center", justifyContent: "center" },
  failDisc: { width: 80, height: 80, borderRadius: 40, backgroundColor: palette.error, alignItems: "center", justifyContent: "center" },
} as const;
