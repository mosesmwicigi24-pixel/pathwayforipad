// Giving receipt (mobile "Give" make — the GiveTab success/"View receipt" stage).
// A single gift's official receipt: a navy + gold hero seal, a classic confirmation
// line, a four-stage TRANSACTION JOURNEY, an Account/Fee/Total ledger strip, the
// M-PESA receipt-no. voucher with a "received with thanks" seal, a scripture strip,
// and Share/Save PDF actions. Read-only over GET /giving/transactions/:id (we only
// render what the ledger reports — money is server-authoritative). The PDF is
// rendered server-side and opened in the OS viewer (Save) or shared via the OS
// share sheet (Share); both hit GET /giving/transactions/:id/receipt.pdf.
import { useState, type ReactElement } from "react";
import {
  Linking, Platform, Pressable, ScrollView, Share, View, type StyleProp, type ViewStyle,
} from "react-native";
import {
  Check, Copy, CreditCard, Download, Globe, HandHeart, Landmark, Loader, Share2,
  ShieldCheck, Smartphone, X, type LucideIcon,
} from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { Loading, ErrorState } from "../components/states";
import { useGivingDetail, useMe } from "../api/hooks";
import { errorMessage } from "../api/query";
import { methodLabel } from "./givingHelpers";
import { apiBaseUrl } from "../config";
import { getVault } from "../auth/vault";
import type { GivingDetail, GivingMethod } from "../api/types";

const CHURCH_NAME = "Nuru Place Church";
const CHURCH_PAYBILL = "400200";
const SETTLED = new Set(["succeeded", "settled", "completed"]);

const kshMinor = (m: number): string => `KSh ${(m / 100).toLocaleString()}`;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const dateFull = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// Per-method display name + brand dot + the right label for the reference voucher.
type MethodMeta = { name: string; dot: string; refLabel: string };
const METHOD_META: Record<GivingMethod, MethodMeta> = {
  mpesa: { name: "M-PESA", dot: "#3BA935", refLabel: "M-PESA receipt no." },
  airtel: { name: "Airtel Money", dot: "#E2231A", refLabel: "Transaction ID" },
  card: { name: "Card", dot: "#1F3A8A", refLabel: "Authorization code" },
  paypal: { name: "PayPal", dot: "#0070BA", refLabel: "Transaction ID" },
};
function methodMeta(method: GivingMethod): MethodMeta {
  return METHOD_META[method] ?? { name: methodLabel(method), dot: palette.gold, refLabel: "Reference" };
}

// A gift's journey, as four detailed stages. Timestamps are honest: 01 uses
// created_at, 04 uses settled_at (or shows the status when not yet settled), and
// 02/03 reuse created_at rather than inventing distinct precise times.
type StepState = "done" | "current" | "pending" | "failed";
type Step = { label: string; primary: string; sub?: string; stamp: string; state: StepState; Icon: LucideIcon };

function buildTimeline(d: GivingDetail, donor: string, donorContact: string): Step[] {
  const m = methodMeta(d.method);
  const isMM = d.method === "mpesa" || d.method === "airtel";
  const authIcon: LucideIcon = isMM ? Smartphone : d.method === "card" ? CreditCard : d.method === "paypal" ? Globe : Landmark;
  const ref = d.provider_ref ?? d.transaction_id;
  const created = `${dateFull(d.created_at)} · ${timeLabel(d.created_at)}`;
  const amt = kshMinor(d.amount_minor);
  const settled = SETTLED.has(d.status);
  const failed = d.status === "failed" || d.status === "cancelled";
  const refunded = d.status === "refunded";

  const steps: Step[] = [
    { label: "Initiated", primary: donor, ...(donorContact ? { sub: donorContact } : {}), stamp: created, state: "done", Icon: HandHeart },
  ];
  if (failed) {
    steps.push({ label: "Declined", primary: m.name, sub: "Cancelled / timed out", stamp: created, state: "failed", Icon: X });
    return steps;
  }
  steps.push({ label: "Authorized", primary: m.name, sub: `Code ${ref}`, stamp: created, state: "done", Icon: authIcon });
  steps.push({
    label: "Received",
    primary: CHURCH_NAME,
    sub: d.method === "mpesa" ? `Paybill ${CHURCH_PAYBILL} · ${cap(d.fund)}` : `${cap(d.fund)} account`,
    stamp: created,
    state: settled || refunded ? "done" : "current",
    Icon: Landmark,
  });
  if (refunded) {
    steps.push({ label: "Refunded", primary: "Finance office", sub: `Reversed · ${amt}`, stamp: created, state: "done", Icon: ShieldCheck });
  } else if (d.settled_at) {
    steps.push({ label: "Settled", primary: "Finance office", sub: `Cleared · ${amt}`, stamp: `${dateFull(d.settled_at)} · ${timeLabel(d.settled_at)}`, state: "done", Icon: ShieldCheck });
  } else if (settled) {
    steps.push({ label: "Settled", primary: "Finance office", sub: `Cleared · ${amt}`, stamp: created, state: "done", Icon: ShieldCheck });
  } else {
    steps.push({ label: "Settling", primary: "Finance office", sub: "Within 1–2 days", stamp: cap(d.status), state: "pending", Icon: ShieldCheck });
  }
  return steps;
}

export function GivingReceiptScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "GivingReceipt">>();
  const { transactionId } = route.params;
  const { data: detail, isLoading, error, refetch } = useGivingDetail(transactionId);
  const { data: me } = useMe();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"none" | "sharing" | "saving">("none");

  const donor = me?.profile?.full_name ?? "Giver";
  const donorContact = me?.profile?.phone_number ?? "";

  // The PDF is rendered server-side and opened in the OS browser / viewer or
  // share sheet, neither of which can attach a bearer header — pass the access
  // token as a query param (mirrors the statement download).
  async function receiptUrl(): Promise<string | null> {
    const token = await getVault().getAccess();
    if (!token) return null;
    return `${apiBaseUrl(Platform.OS)}/giving/transactions/${transactionId}/receipt.pdf?token=${encodeURIComponent(token)}`;
  }

  async function onSave(): Promise<void> {
    setBusy("saving");
    try {
      const url = await receiptUrl();
      if (url) await Linking.openURL(url);
    } catch {
      /* no handler for the URL */
    } finally {
      setBusy("none");
    }
  }

  async function onShare(): Promise<void> {
    setBusy("sharing");
    try {
      const url = await receiptUrl();
      if (url) {
        const summary = detail
          ? `Nuru Place giving receipt — ${kshMinor(detail.amount_minor)} to ${CHURCH_NAME} (${cap(detail.fund)}).`
          : "Nuru Place giving receipt.";
        await Share.share(Platform.OS === "ios" ? { url, message: summary } : { message: `${summary}\n${url}` });
      }
    } catch {
      /* user dismissed the share sheet */
    } finally {
      setBusy("none");
    }
  }

  function copyRef(ref: string): void {
    // No clipboard dependency in the app; copy is best-effort via the share sheet
    // on long content. Keep the gold→check affordance even when we can't write.
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    void Share.share({ message: ref }).catch(() => undefined);
  }

  return (
    <View style={st.screen}>
      {/* Navy hero — kicker + close, gold seal, GIFT RECEIVED, amount, fund + church, method pill */}
      <View style={st.hero}>
        <View style={st.heroRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={st.brandSeal}><HandHeart size={16} color={palette.navyDeep} /></View>
            <View>
              <T variant="micro" tone="gold" style={st.kicker}>NURU PLACE</T>
              <T variant="micro" tone="onNavyDim" style={{ fontSize: 10 }}>Giving receipt</T>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => nav.goBack()} style={({ pressed }) => [st.closeBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
            <X size={16} color={palette.onNavy} />
          </Pressable>
        </View>

        {detail ? (
          <View style={{ alignItems: "center", marginTop: spacing.base }}>
            <View style={st.checkSeal}>
              {SETTLED.has(detail.status)
                ? <Check size={26} color={palette.gold} strokeWidth={2.5} />
                : detail.status === "failed" || detail.status === "cancelled"
                  ? <X size={26} color={palette.gold} />
                  : <Loader size={24} color={palette.gold} />}
            </View>
            <T variant="micro" tone="gold" style={st.statusHeadline}>
              {SETTLED.has(detail.status) ? "GIFT RECEIVED" : detail.status === "failed" ? "GIFT FAILED" : detail.status === "refunded" ? "GIFT REFUNDED" : "GIFT PROCESSING"}
            </T>
            <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 4 }}>
              <T serif style={{ fontSize: 17, color: palette.gold }}>KSh </T>
              <T serif tone="onNavy" style={{ fontSize: 36, fontWeight: "700" }}>{(detail.amount_minor / 100).toLocaleString()}</T>
            </View>
            <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }}>{`${cap(detail.fund)} · to ${CHURCH_NAME}`}</T>
            <View style={st.methodPill}>
              <View style={[st.dot, { backgroundColor: methodMeta(detail.method).dot }]} />
              <T variant="micro" tone="onNavy" style={{ fontWeight: "600" }}>{`via ${methodMeta(detail.method).name}`}</T>
            </View>
          </View>
        ) : null}
      </View>

      {/* Dashed perforation dividing hero from body */}
      <View style={st.perfWrap}>
        <View style={[st.perfNotch, { left: -10 }]} />
        <View style={[st.perfNotch, { right: -10 }]} />
        <View style={st.perfLine} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.base }} showsVerticalScrollIndicator={false}>
        {isLoading && !detail ? <Loading label="Loading your receipt…" /> : null}
        {error && !detail ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {detail ? <ReceiptBody detail={detail} donor={donor} donorContact={donorContact} copied={copied} onCopyRef={copyRef} /> : null}

        {detail ? (
          <>
            <View style={st.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Share receipt PDF" onPress={() => void onShare()} disabled={busy !== "none"} style={({ pressed }) => [st.shareBtn, pressed && { transform: [{ scale: 0.99 }] }, busy !== "none" && { opacity: 0.7 }]}>
                <Share2 size={15} color={palette.navyDeep} />
                <T variant="heading" style={{ fontSize: 14, color: palette.navyDeep, fontWeight: "700" }}>{busy === "sharing" ? "Sharing…" : "Share PDF"}</T>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Save receipt PDF" onPress={() => void onSave()} disabled={busy !== "none"} style={({ pressed }) => [st.saveBtn, pressed && { transform: [{ scale: 0.99 }] }, busy !== "none" && { opacity: 0.7 }]}>
                <Download size={15} color={palette.navy} />
                <T variant="heading" style={{ fontSize: 14, color: palette.navy }}>{busy === "saving" ? "Opening…" : "Save PDF"}</T>
              </Pressable>
            </View>

            <View style={st.footer}>
              <ShieldCheck size={11} color={palette.ink400} />
              <T variant="micro" tone="tertiary">Official receipt · emailed to you · Finance · Nuru Place</T>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ReceiptBody({ detail, donor, donorContact, copied, onCopyRef }: { detail: GivingDetail; donor: string; donorContact: string; copied: boolean; onCopyRef: (ref: string) => void }): ReactElement {
  const m = methodMeta(detail.method);
  const ref = detail.provider_ref ?? detail.transaction_id;
  const isMM = detail.method === "mpesa" || detail.method === "airtel";
  const steps = buildTimeline(detail, donor, donorContact);
  const doneCount = steps.filter((s) => s.state === "done").length;
  const allDone = doneCount === steps.length;
  const anyFailed = steps.some((s) => s.state === "failed");

  const journeyChip: { bg: string; fg: string; label: string; check: boolean } = anyFailed
    ? { bg: "rgba(212,24,61,0.12)", fg: palette.error, label: "Incomplete", check: false }
    : allDone
      ? { bg: "rgba(201,162,39,0.14)", fg: palette.goldChipText, label: "Completed", check: true }
      : { bg: palette.mutedBg, fg: palette.ink600, label: `${doneCount}/${steps.length}`, check: false };

  return (
    <>
      {/* Classic confirmation line — gold accent edge */}
      <View style={st.confirmLine}>
        <T variant="body" style={{ fontSize: 13, lineHeight: 19, color: palette.ink600 }}>
          <T variant="body" style={{ fontSize: 13, color: palette.navy, fontWeight: "700" }}>{ref}</T>
          {` Confirmed. ${kshMinor(detail.amount_minor)} ${detail.status === "refunded" ? "refunded from" : "sent to"} ${CHURCH_NAME}${isMM ? ` for account ${cap(detail.fund)}` : ""} on ${dateFull(detail.created_at)} at ${timeLabel(detail.created_at)}.`}
        </T>
      </View>

      {/* TRANSACTION JOURNEY — 2×2 grid of numbered stage cards */}
      <View style={st.journeyCard}>
        <View style={st.journeyHead}>
          <T variant="overline" style={{ color: palette.goldLo }}>TRANSACTION JOURNEY</T>
          <View style={[st.journeyChip, { backgroundColor: journeyChip.bg }]}>
            {journeyChip.check ? <Check size={10} color={journeyChip.fg} strokeWidth={3} /> : null}
            <T variant="micro" style={{ color: journeyChip.fg, fontWeight: "700", fontSize: 10 }}>{journeyChip.label}</T>
          </View>
        </View>
        <View style={st.journeyGrid}>
          {steps.map((s, i) => (
            <View key={s.label} style={st.stageCard}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                <StageIcon step={s} />
                <T variant="micro" style={{ color: "#D6CBB0", fontWeight: "800", fontSize: 10 }}>{String(i + 1).padStart(2, "0")}</T>
              </View>
              <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700", fontSize: 8, letterSpacing: 0.8, marginTop: 6 }} numberOfLines={1}>{s.label.toUpperCase()}</T>
              <T variant="heading" style={{ fontSize: 12 }} numberOfLines={1}>{s.primary}</T>
              {s.sub ? <T variant="micro" tone="tertiary" style={{ fontSize: 9 }} numberOfLines={1}>{s.sub}</T> : null}
              <T variant="micro" tone="tertiary" style={{ fontSize: 9, marginTop: 4 }} numberOfLines={1}>{s.stamp}</T>
            </View>
          ))}
        </View>
      </View>

      {/* Account · Fee · Total strip */}
      <View style={st.ledgerStrip}>
        <LedgerCell label="ACCOUNT" value={cap(detail.fund)} />
        <View style={st.ledgerDivider} />
        <LedgerCell label="FEE" value="KSh 0" />
        <View style={st.ledgerDivider} />
        <LedgerCell label="TOTAL" value={kshMinor(detail.amount_minor)} accent />
      </View>

      {/* M-PESA RECEIPT NO. voucher + "received with thanks" seal */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Copy ${m.refLabel}`} onPress={() => onCopyRef(ref)} style={({ pressed }) => [st.voucher, pressed && { opacity: 0.92 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="gold" style={{ fontWeight: "700", fontSize: 8, letterSpacing: 1.2 }}>{m.refLabel.toUpperCase()}</T>
            <T serif tone="onNavy" style={{ fontSize: 15, letterSpacing: 1.5, fontWeight: "700", marginTop: 2 }} numberOfLines={1}>{ref}</T>
          </View>
          {copied ? <Check size={16} color={palette.success} /> : <Copy size={16} color={palette.gold} />}
        </Pressable>
        <View style={st.seal}>
          <View style={st.sealInner} />
          <HandHeart size={15} color={palette.goldLo} />
          <T variant="micro" style={{ color: palette.goldLo, fontWeight: "800", fontSize: 6, letterSpacing: 0.4, textAlign: "center", marginTop: 2, lineHeight: 8 }}>RECEIVED WITH THANKS</T>
        </View>
      </View>

      {/* Scripture strip */}
      <View style={st.verse}>
        <T serif style={{ fontSize: 13, lineHeight: 19, color: palette.ink, fontStyle: "italic", textAlign: "center" }}>
          “Each of you should give what you have decided in your heart to give… for God loves a cheerful giver.”
        </T>
        <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700", fontSize: 9, letterSpacing: 1.2, textAlign: "center", marginTop: 6 }}>2 CORINTHIANS 9:7</T>
      </View>
    </>
  );
}

function StageIcon({ step }: { step: Step }): ReactElement {
  const done = step.state === "done";
  const wrap: StyleProp<ViewStyle> = done
    ? [st.stageIcon, { backgroundColor: palette.gold }]
    : step.state === "current"
      ? [st.stageIcon, { backgroundColor: palette.white, borderWidth: 2, borderColor: palette.gold }]
      : step.state === "failed"
        ? [st.stageIcon, { backgroundColor: "rgba(212,24,61,0.12)" }]
        : [st.stageIcon, { backgroundColor: palette.mutedBg }];
  const color = done ? palette.navyDeep : step.state === "current" ? palette.goldLo : step.state === "failed" ? palette.error : palette.ink400;
  return (
    <View style={wrap}>
      {step.state === "current" ? <Loader size={13} color={palette.goldLo} /> : <step.Icon size={13} color={color} />}
      {done ? (
        <View style={st.stageCheck}>
          <Check size={8} color={palette.success} strokeWidth={3} />
        </View>
      ) : null}
    </View>
  );
}

function LedgerCell({ label, value, accent }: { label: string; value: string; accent?: boolean }): ReactElement {
  return (
    <View style={[st.ledgerCell, accent && { backgroundColor: "rgba(201,162,39,0.08)" }]}>
      <T variant="micro" style={{ color: accent ? palette.goldLo : palette.ink400, fontWeight: "700", fontSize: 8, letterSpacing: 0.8 }}>{label}</T>
      <T variant="heading" style={{ fontSize: 13, marginTop: 2, color: accent ? palette.goldLo : palette.ink, fontWeight: accent ? "800" : "700" }} numberOfLines={1}>{value}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  hero: { backgroundColor: palette.navy, paddingTop: 54, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg, overflow: "hidden" },
  heroRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandSeal: { width: 32, height: 32, borderRadius: 10, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 9, fontWeight: "700", letterSpacing: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  checkSeal: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(201,162,39,0.14)", borderWidth: 1, borderColor: "rgba(201,162,39,0.45)", alignItems: "center", justifyContent: "center" },
  statusHeadline: { marginTop: 10, fontSize: 11, fontWeight: "600", letterSpacing: 1.4 },
  methodPill: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(201,162,39,0.28)", borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  // Perforation — navy notches biting in from both edges + a dashed gold line.
  perfWrap: { height: 18, backgroundColor: palette.navy, justifyContent: "center" },
  perfNotch: { position: "absolute", top: 1, width: 20, height: 20, borderRadius: 10, backgroundColor: palette.paper },
  perfLine: { marginHorizontal: spacing.lg, borderBottomWidth: 1.5, borderStyle: "dashed", borderColor: "rgba(201,162,39,0.5)" },
  confirmLine: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderLeftWidth: 3, borderLeftColor: palette.gold, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  journeyCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 18, overflow: "hidden" },
  journeyHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.base, paddingTop: 14 },
  journeyChip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  journeyGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, padding: spacing.md },
  stageCard: { flexGrow: 1, flexBasis: "46%", minWidth: 130, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 10 },
  stageIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  stageCheck: { position: "absolute", bottom: -3, right: -3, width: 14, height: 14, borderRadius: 7, backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(201,162,39,0.45)", alignItems: "center", justifyContent: "center" },
  ledgerStrip: { flexDirection: "row", backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderRadius: 16, overflow: "hidden", ...shadow.card },
  ledgerCell: { flex: 1, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  ledgerDivider: { width: 1, backgroundColor: palette.border },
  voucher: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.navy, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  seal: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: palette.gold, backgroundColor: "rgba(201,162,39,0.10)", alignItems: "center", justifyContent: "center", paddingHorizontal: 6, transform: [{ rotate: "-12deg" }] },
  sealInner: { position: "absolute", top: 6, left: 6, right: 6, bottom: 6, borderRadius: 28, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(201,162,39,0.55)" },
  verse: { backgroundColor: palette.verseBg, borderWidth: 1, borderColor: "rgba(201,162,39,0.3)", borderRadius: 18, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  actions: { flexDirection: "row", gap: spacing.sm },
  shareBtn: { flex: 1, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: palette.gold, borderRadius: radii.button },
  saveBtn: { flex: 1, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(11,31,51,0.12)", borderRadius: radii.button },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingTop: spacing.xs },
} as const;
