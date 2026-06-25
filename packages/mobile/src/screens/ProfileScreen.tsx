// Profile (rebuilt to the "Nuru Pathway app design" make — AgqYlBEN2Sy2tA6vjBaUxE).
// Faithful section layout: identity header, Personal information, Security & login,
// Connected accounts, Notifications, Achievements, Milestones, Certificates, and
// Help & privacy — with bottom-sheet editors. Seeded from real /me + achievements;
// edits are session-local (the make itself keeps them in component state), so the
// data shown is real while the interactions mirror the design exactly.
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, Alert, Clipboard, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  AtSign, Award, Bell, Calendar, Check, ChevronRight, Compass, Copy, Download,
  Fingerprint, Globe, Heart, KeyRound, Languages, LifeBuoy, Link2, Lock, LogOut,
  Mail, MapPin, Pencil, Phone, ScrollText, Settings, ShieldCheck, Smartphone, Sparkles, Tag,
  Trash2, Type, User, UserCog, X,
  type LucideIcon,
} from "lucide-react-native";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing, shadow } from "../theme/tokens";
import { T, Pill } from "../theme/components";
import { useFontScale, type FontSize } from "../theme/fontScale";
import { launchImageLibrary } from "react-native-image-picker";
import QRCode from "react-native-qrcode-svg";
import { useMe, useAchievements, useCertificates } from "../api/hooks";
import { NuruApi } from "../api/client";
import { Avatar } from "../components/Avatar";
import { apiBaseUrl } from "../config";
import type { Achievements, CertificateRow } from "../api/types";
import { clearQueryCache, invalidateQueries, errorMessage } from "../api/query";
import { resetAnnouncementAlerts } from "../notifications/announcementAlerts";
import { requestNotifPermission, ensureChannels, scheduleDailyReminder, cancelDailyReminder, openNotificationSettings } from "../notifications/localNotify";
import { getVault } from "../auth/vault";

const CREAM = "#F6F4EE";
const SURFACE = "#FBF8F1";
const GREEN = "#16A34A";
const GOLD_TEXT = "#A8861C";

interface Field {
  id: string;
  label: string;
  value: string;
  Icon: LucideIcon;
  type?: "text" | "email" | "tel" | "date" | "select";
  options?: string[];
  readOnly?: boolean; // shown but not editable (email is the login identity, §5.8)
}

// Curated country list (persists ISO-3166 alpha-2 → users.country_code).
const COUNTRIES: Array<{ name: string; code: string; flag: string }> = [
  { name: "Kenya", code: "KE", flag: "🇰🇪" },
  { name: "Uganda", code: "UG", flag: "🇺🇬" },
  { name: "Tanzania", code: "TZ", flag: "🇹🇿" },
  { name: "Nigeria", code: "NG", flag: "🇳🇬" },
  { name: "Ghana", code: "GH", flag: "🇬🇭" },
  { name: "South Africa", code: "ZA", flag: "🇿🇦" },
  { name: "United States", code: "US", flag: "🇺🇸" },
  { name: "United Kingdom", code: "GB", flag: "🇬🇧" },
];
const countryName = (code?: string | null): string => {
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? `${c.flag} ${c.name}` : "—";
};
const GENDER_TO_CODE: Record<string, "male" | "female" | "prefer_not_to_say"> = {
  Male: "male", Female: "female", "Prefer not to say": "prefer_not_to_say",
};
const LANG_TO_LOCALE: Record<string, string> = {
  English: "en", Swahili: "sw", Kikuyu: "ki", Luo: "luo", Luhya: "luy", Kamba: "kam", French: "fr", Arabic: "ar",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}
function genderLabel(g?: string | null): string {
  if (g === "male") return "Male";
  if (g === "female") return "Female";
  if (g === "prefer_not_to_say") return "Prefer not to say";
  return "—";
}

const ALL_LANGUAGES = ["English", "Swahili", "Kikuyu", "Luo", "Luhya", "Kamba", "French", "Arabic"];

type Badge = Achievements["badges"][number];

// Social-media handles stored in users.socials (a key→value record). The order
// here is the display + edit order; any extra keys already on the record are
// appended so nothing the backend stores is hidden.
const SOCIAL_LINKS: Array<{ key: string; label: string; Icon: LucideIcon; placeholder: string }> = [
  { key: "instagram", label: "Instagram", Icon: AtSign, placeholder: "your.handle" },
  { key: "x", label: "X (Twitter)", Icon: AtSign, placeholder: "yourhandle" },
  { key: "facebook", label: "Facebook", Icon: Link2, placeholder: "your.profile or URL" },
];
function socialLabel(key: string): string {
  const known = SOCIAL_LINKS.find((s) => s.key === key);
  if (known) return known.label;
  return key.charAt(0).toUpperCase() + key.slice(1);
}
// Trim, drop empties → the record we persist (and compare for "anything set?").
function cleanSocials(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const t = (v ?? "").trim();
    if (t) out[k] = t;
  }
  return out;
}

export function ProfileScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { size: fontSize, setSize: setFontSize } = useFontScale();
  const { data: me, refetch: refetchMe } = useMe();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function pickAvatar(): Promise<void> {
    const res = await launchImageLibrary({ mediaType: "photo", quality: 0.8, selectionLimit: 1 });
    const a = res.assets?.[0];
    if (!a?.uri) return;
    setUploadingAvatar(true);
    try {
      await NuruApi.uploadAvatar({ uri: a.uri, name: a.fileName ?? "avatar.jpg", type: a.type ?? "image/jpeg" });
      invalidateQueries("me");
      await refetchMe();
    } catch (e) {
      Alert.alert("Upload failed", errorMessage(e));
    } finally {
      setUploadingAvatar(false);
    }
  }
  const { data: achievements } = useAchievements();
  const { data: certificates, isLoading: certsLoading, error: certsError } = useCertificates();
  const profileData = me?.profile;
  const level = me?.enrollment?.current_level ?? 1;

  // Source of truth for the optimistic-concurrency token. `invalidateQueries("me")`
  // clears the cache the instant a save returns, so reading `profileData.row_version`
  // for the *next* edit would briefly see undefined (→ fall back to 1) and the server
  // would reject it as a stale version. The ref survives that refetch window: it's
  // seeded from the server and advanced to the version each save returns.
  const versionRef = useRef<number>(profileData?.row_version ?? 1);
  useEffect(() => {
    if (typeof profileData?.row_version === "number") versionRef.current = profileData.row_version;
  }, [profileData?.row_version]);
  // Reflect the server's real 2FA state on the toggle (and after enable/disable).
  useEffect(() => {
    if (typeof profileData?.mfa_enabled === "boolean") setTwoFA(profileData.mfa_enabled);
  }, [profileData?.mfa_enabled]);

  const seeded = useMemo<Field[]>(() => {
    const p = profileData;
    return [
      { id: "name", label: "Full name", value: p?.full_name ?? "Member", Icon: User },
      { id: "email", label: "Email", value: p?.email ?? "—", Icon: Mail, type: "email", readOnly: true },
      { id: "phone", label: "Phone", value: p?.phone_number ?? "—", Icon: Phone, type: "tel" },
      { id: "dob", label: "Date of birth", value: (p?.date_of_birth ?? "").slice(0, 10), Icon: Calendar, type: "date" },
      { id: "gender", label: "Gender", value: genderLabel(p?.gender), Icon: UserCog, type: "select", options: ["Male", "Female", "Prefer not to say"] },
      { id: "country", label: "Country", value: countryName(p?.country_code), Icon: Globe, type: "select", options: COUNTRIES.map((c) => `${c.flag} ${c.name}`) },
      { id: "city", label: "City", value: p?.city ?? "—", Icon: MapPin },
    ];
  }, [profileData]);

  const [profile, setProfile] = useState<Field[] | null>(null);
  const fields = profile ?? seeded;
  const name = fields.find((f) => f.id === "name")?.value ?? "Member";
  const email = fields.find((f) => f.id === "email")?.value ?? "";

  const [editingField, setEditingField] = useState<Field | null>(null);
  const [languages, setLanguages] = useState<string[]>(["English", "Swahili"]);
  const [defaultLanguage, setDefaultLanguage] = useState("English");
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [sheet, setSheet] = useState<null | "password" | "twofa" | "disable2fa" | "appLang" | "support" | "privacy">(null);
  const [twoFA, setTwoFA] = useState(false);
  const [appLanguage, setAppLanguage] = useState("English");
  const [pushOn, setPushOn] = useState(true);
  const [emailOn, setEmailOn] = useState(true);
  const [smsOn, setSmsOn] = useState(false);
  const [socials, setSocials] = useState<Record<string, boolean>>({ Google: true, Facebook: false, Instagram: true, X: false, LinkedIn: false, YouTube: false });
  const [socialLinksOpen, setSocialLinksOpen] = useState(false);
  const [openBadge, setOpenBadge] = useState<Badge | null>(null);

  // Real social-media handles from /me (record key → handle). Edited via the
  // "Social links" sheet; persisted through the same PATCH /me flow as fields.
  const socialLinks = profileData?.socials ?? {};
  const setSocialLinks = async (next: Record<string, string>): Promise<void> => {
    setSocialLinksOpen(false);
    const cleaned = cleanSocials(next);
    try {
      const r = await NuruApi.updateMe({ socials: cleaned }, versionRef.current);
      versionRef.current = r.row_version;
      invalidateQueries("me");
    } catch (e) {
      const stale = (e as { response?: { status?: number } }).response?.status === 409;
      if (stale) invalidateQueries("me");
      Alert.alert(
        stale ? "Profile changed elsewhere" : "Couldn't save",
        stale ? "We've refreshed it — please try your edit again." : "Please check your connection and try again.",
      );
    }
  };

  // Map an edited row to the PATCH /me payload. Returns null when the value can't
  // be persisted (bad format), so the caller can warn instead of silently dropping.
  const patchFor = (id: string, value: string): Record<string, unknown> | null => {
    const v = value.trim();
    switch (id) {
      case "name": return v ? { full_name: v } : null;
      case "phone": return { phone_number: v };
      case "city": return { city: v };
      case "gender": return { gender: GENDER_TO_CODE[v] ?? null };
      case "dob": return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { date_of_birth: v } : null;
      case "country": {
        const c = COUNTRIES.find((x) => `${x.flag} ${x.name}` === v || x.name === v);
        return c ? { country_code: c.code } : null;
      }
      default: return null;
    }
  };

  // Persist an edit to the member record (PATCH /me) and refetch /me so the new
  // identity propagates everywhere (Home greeting, header, etc.). Optimistic with
  // rollback; surfaces VERSION_STALE so a concurrent edit can't be clobbered.
  const saveField = async (id: string, value: string): Promise<void> => {
    setEditingField(null);
    const patch = patchFor(id, value);
    if (!patch) {
      if (id === "dob") Alert.alert("Check the date", "Use YYYY-MM-DD, e.g. 1992-04-18.");
      return;
    }
    const prev = fields;
    setProfile(fields.map((f) => (f.id === id ? { ...f, value } : f))); // optimistic
    try {
      const r = await NuruApi.updateMe(patch, versionRef.current);
      versionRef.current = r.row_version;
      invalidateQueries("me");
    } catch (e) {
      setProfile(prev);
      const stale = (e as { response?: { status?: number } }).response?.status === 409;
      if (stale) invalidateQueries("me");
      Alert.alert(stale ? "Profile changed elsewhere" : "Couldn't save", stale ? "We've refreshed it — please try your edit again." : "Please check your connection and try again.");
    }
  };

  const persistLocale = async (lang: string): Promise<void> => {
    try {
      const r = await NuruApi.updateMe({ locale: LANG_TO_LOCALE[lang] ?? "en" }, versionRef.current);
      versionRef.current = r.row_version;
      invalidateQueries("me");
    } catch { /* best-effort: language is a soft preference */ }
  };

  async function signOut(): Promise<void> {
    try {
      const rt = await getVault().getRefresh();
      if (rt) await NuruApi.logout(rt);
    } catch {
      /* best-effort */
    }
    await getVault().clear();
    clearQueryCache();
    resetAnnouncementAlerts(); // next member re-seeds; don't inherit this user's seen-set
    nav.reset({ index: 0, routes: [{ name: "Login" }] });
  }

  const badges = achievements?.badges ?? [];
  const milestones: Array<{ id: string; label: string; meta: string; status: "done" | "active" | "future" }> = [
    { id: "baptism", label: "Baptism", meta: profileData?.is_baptized ? "Baptised" : "Not yet recorded", status: profileData?.is_baptized ? "done" : "future" },
    ...(level > 1 ? [{ id: "l1", label: "Level 1 completed", meta: "Foundations of Faith", status: "done" as const }] : []),
    { id: "active", label: `Level ${level} · in progress`, meta: "Keep going", status: "active" },
    { id: "path", label: "Pathway completion", meta: "Your journey continues", status: "future" },
  ];
  // Open a certificate PDF. download_url is a server-relative path
  // ("/media/certificates/<code>"); resolve it against the configured API base.
  const openCertificate = (downloadUrl: string): void => {
    const base = apiBaseUrl().replace(/\/+$/, "");
    const url = /^https?:\/\//i.test(downloadUrl) ? downloadUrl : `${base}${downloadUrl}`;
    void Linking.openURL(url).catch(() => Alert.alert("Couldn't open", "Please check your connection and try again."));
  };

  return (
    <View style={st.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={st.header}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <T variant="micro" tone="gold" style={st.kicker}>ACCOUNT</T>
            <Pressable accessibilityRole="button" accessibilityLabel="App settings" onPress={() => setSheet("appLang")} style={st.headerBtn}>
              <Settings size={18} color="#fff" />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              onPress={() => void pickAvatar()}
              disabled={uploadingAvatar}
              style={{ width: 64, height: 64 }}
            >
              <Avatar uri={profileData?.avatar_url} name={name} size={64} ring />
              <View style={st.avatarEdit}>
                {uploadingAvatar ? <ActivityIndicator size="small" color={palette.navy} /> : <Pencil size={11} color={palette.navy} strokeWidth={2.5} />}
              </View>
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T serif tone="onNavy" style={{ fontSize: 22 }} numberOfLines={1}>{name}</T>
              <T variant="caption" style={{ color: "rgba(255,255,255,0.6)", marginTop: 2 }} numberOfLines={1}>{email}</T>
              <View style={{ flexDirection: "row", gap: 6, marginTop: spacing.sm }}>
                <View style={st.levelChip}><Award size={10} color={palette.gold} /><T variant="micro" style={{ color: "#fff", fontWeight: "700" }}>Level {level}</T></View>
                {twoFA ? <View style={st.faChip}><ShieldCheck size={10} color="#86efac" /><T variant="micro" style={{ color: "#86efac", fontWeight: "700" }}>2FA</T></View> : null}
              </View>
            </View>
          </View>
        </View>

        <View style={{ padding: spacing.lg, gap: spacing.base }}>
          <Section title="PERSONAL INFORMATION" Icon={User}>
            {fields.map((f, i) => (
              <Row key={f.id} divider={i > 0} {...(f.readOnly ? {} : { onPress: () => setEditingField(f) })}>
                <View style={st.fieldIcon}><f.Icon size={15} color={palette.navy} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="micro" tone="tertiary" style={st.fieldLabel}>{f.label.toUpperCase()}</T>
                  <T variant="body" style={{ color: palette.navy, fontWeight: "500" }} numberOfLines={1}>
                    {f.id === "dob" && f.value ? formatDate(f.value) : f.value}
                  </T>
                </View>
                {f.readOnly ? null : <Pencil size={14} color={palette.ink400} />}
              </Row>
            ))}
            <Row divider onPress={() => setLanguagesOpen(true)}>
              <View style={st.fieldIcon}><Languages size={15} color={palette.navy} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="micro" tone="tertiary" style={st.fieldLabel}>LANGUAGES SPOKEN</T>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                  {languages.map((l) => (
                    <View key={l} style={[st.langChip, l === defaultLanguage && st.langChipDefault]}>
                      <T variant="micro" style={{ color: l === defaultLanguage ? GOLD_TEXT : palette.navy, fontWeight: "600" }}>{l}</T>
                      {l === defaultLanguage ? <Check size={10} color={GOLD_TEXT} strokeWidth={3} /> : null}
                    </View>
                  ))}
                </View>
              </View>
              <Pencil size={14} color={palette.ink400} />
            </Row>
          </Section>

          <Section title="SECURITY & LOGIN" Icon={Lock}>
            <ActionRow Icon={KeyRound} tint="#EEF2FF" color="#6366F1" title="Change password" meta="Keep your account secure" onPress={() => setSheet("password")} />
            <ActionRow
              divider Icon={Fingerprint} tint={twoFA ? "#DCFCE7" : "#FEF3C7"} color={twoFA ? GREEN : "#D97706"}
              title="Two-factor authentication" meta={twoFA ? "Active · Authenticator app" : "Not enabled · recommended"}
              trailing={<Toggle on={twoFA} onToggle={() => setSheet(twoFA ? "disable2fa" : "twofa")} />}
            />
            <ActionRow divider Icon={Smartphone} tint="#FCE7F3" color="#DB2777" title="Active sessions" meta="This device" />
          </Section>

          <Section title="CONNECTED ACCOUNTS" Icon={Globe}>
            {Object.entries(socials).map(([nameKey, on], i) => (
              <Row key={nameKey} divider={i > 0}>
                <View style={[st.fieldIcon, { backgroundColor: "rgba(11,31,51,0.05)" }]}><Globe size={15} color={palette.navy} /></View>
                <View style={{ flex: 1 }}>
                  <T variant="body" style={{ color: palette.navy, fontWeight: "600" }}>{nameKey}</T>
                  <T variant="micro" tone="secondary">{on ? "Connected" : "Not connected"}</T>
                </View>
                <Pressable onPress={() => setSocials({ ...socials, [nameKey]: !on })} style={[st.connectBtn, on ? st.connectBtnOn : st.connectBtnOff]}>
                  <T variant="micro" style={{ color: on ? palette.ink600 : palette.navy, fontWeight: "700" }}>{on ? "Disconnect" : "Connect"}</T>
                </Pressable>
              </Row>
            ))}
          </Section>

          <Section title="SOCIAL LINKS" Icon={Link2}>
            {(() => {
              const entries = Object.entries(socialLinks).filter(([, v]) => (v ?? "").trim());
              return entries.length > 0 ? (
                entries.map(([key, handle], i) => (
                  <Row key={key} divider={i > 0}>
                    <View style={st.fieldIcon}><AtSign size={15} color={palette.navy} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="micro" tone="tertiary" style={st.fieldLabel}>{socialLabel(key).toUpperCase()}</T>
                      <T variant="body" style={{ color: palette.navy, fontWeight: "500" }} numberOfLines={1}>{handle}</T>
                    </View>
                  </Row>
                ))
              ) : (
                <T variant="caption" tone="secondary">Add your social links so cell-mates can connect.</T>
              );
            })()}
            <View style={{ marginTop: spacing.sm }}>
              <Pressable accessibilityRole="button" onPress={() => setSocialLinksOpen(true)} style={st.certOpenBtn}>
                <Pencil size={14} color={palette.navy} />
                <T variant="caption" style={{ color: palette.navy, fontWeight: "600" }}>Edit social links</T>
              </Pressable>
            </View>
          </Section>

          <Section title="NOTIFICATIONS" Icon={Bell}>
            <PreferenceRow Icon={Bell} title="Push notifications" meta="Devotionals, events, reminders" on={pushOn} onToggle={() => {
              const next = !pushOn;
              setPushOn(next);
              void (async () => {
                if (next) {
                  await requestNotifPermission();
                  await ensureChannels();
                  await scheduleDailyReminder(7, 0);
                } else {
                  await cancelDailyReminder();
                }
              })();
            }} />
            <PreferenceRow divider Icon={Mail} title="Email" meta="Weekly summary & receipts" on={emailOn} onToggle={() => setEmailOn(!emailOn)} />
            <PreferenceRow divider Icon={Phone} title="SMS" meta="Critical updates only" on={smsOn} onToggle={() => setSmsOn(!smsOn)} />
            <ActionRow divider Icon={Bell} tint="#FEF3C7" color="#B45309" title="Notification settings" meta="Manage sounds & toggles in phone settings" onPress={() => void openNotificationSettings()} />
          </Section>

          <Section title="ACHIEVEMENTS" Icon={Sparkles}>
            {badges.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingVertical: 4 }}>
                {badges.map((b) => <Medallion key={b.code} name={b.name} onPress={() => setOpenBadge(b)} />)}
              </ScrollView>
            ) : (
              <T variant="caption" tone="secondary">Your badges will appear here as you grow.</T>
            )}
            <T variant="micro" tone="tertiary" style={{ textAlign: "center", marginTop: spacing.sm, fontStyle: "italic" }}>
              Badges celebrate your growth — not competition.
            </T>
          </Section>

          <Section title="MILESTONES" Icon={Compass}>
            {milestones.map((m, i) => <MilestoneRow key={m.id} label={m.label} meta={m.meta} status={m.status} isLast={i === milestones.length - 1} />)}
          </Section>

          <Section title="CERTIFICATES" Icon={ScrollText}>
            {certsLoading && !certificates ? (
              <T variant="caption" tone="secondary">Loading your certificates…</T>
            ) : certsError ? (
              <T variant="caption" tone="secondary">Couldn't load certificates. Pull to refresh and try again.</T>
            ) : certificates && certificates.length > 0 ? (
              certificates.map((c) => (
                <CertificateCard key={c.certificate_id} cert={c} onOpen={() => openCertificate(c.download_url)} />
              ))
            ) : (
              <T variant="caption" tone="secondary">No certificates yet — complete a level to earn your first.</T>
            )}
          </Section>

          <Section title="DISPLAY" Icon={Type}>
            <T variant="caption" tone="secondary" style={{ marginBottom: spacing.sm }}>Text size</T>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {(["small", "default", "large"] as FontSize[]).map((s) => (
                <Pressable
                  key={s}
                  accessibilityRole="button"
                  accessibilityState={{ selected: fontSize === s }}
                  onPress={() => setFontSize(s)}
                  style={[st.sizeOpt, fontSize === s && st.sizeOptOn]}
                >
                  <T style={{ fontSize: s === "small" ? 13 : s === "large" ? 18 : 15, fontWeight: "700", color: fontSize === s ? palette.navyDeep : palette.ink600 }}>
                    {s === "small" ? "Small" : s === "large" ? "Large" : "Default"}
                  </T>
                </Pressable>
              ))}
            </View>
            <T variant="micro" tone="tertiary" style={{ marginTop: 8 }}>Adjusts text size across the whole app.</T>
          </Section>

          <Section title="HELP & PRIVACY" Icon={LifeBuoy}>
            <ActionRow Icon={Languages} tint="#E0F2FE" color="#0EA5E9" title="Language" meta={`App language · ${appLanguage}`} onPress={() => setSheet("appLang")} />
            <ActionRow divider Icon={LifeBuoy} tint="#DCFCE7" color={GREEN} title="Help & support" meta="FAQs, contact us" onPress={() => setSheet("support")} />
            <ActionRow divider Icon={ShieldCheck} tint="#EEF2FF" color="#6366F1" title="Privacy policy" meta="How we handle your data" onPress={() => setSheet("privacy")} />
          </Section>

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable onPress={() => void signOut()} style={[st.dangerBtn, { backgroundColor: palette.white, borderColor: palette.border }]}>
              <LogOut size={15} color={palette.navy} /><T variant="caption" style={{ color: palette.navy, fontWeight: "600" }}>Sign out</T>
            </Pressable>
            <Pressable style={[st.dangerBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <Trash2 size={15} color="#DC2626" /><T variant="caption" style={{ color: "#DC2626", fontWeight: "600" }}>Delete account</T>
            </Pressable>
          </View>
          <T variant="micro" tone="tertiary" style={{ textAlign: "center" }}>Nuru Pathway · v1.0</T>
        </View>
      </ScrollView>

      {editingField ? (
        <EditFieldSheet field={editingField} onClose={() => setEditingField(null)} onSave={(v) => void saveField(editingField.id, v)} />
      ) : null}
      {languagesOpen ? (
        <LanguagesSheet selected={languages} fallbackDefault={defaultLanguage} onClose={() => setLanguagesOpen(false)} onSave={(sel, def) => { setLanguages(sel); setDefaultLanguage(def); setLanguagesOpen(false); void persistLocale(def); }} />
      ) : null}
      {openBadge ? <BadgeDetailSheet badge={openBadge} onClose={() => setOpenBadge(null)} /> : null}
      {socialLinksOpen ? (
        <SocialLinksSheet
          current={socialLinks}
          onClose={() => setSocialLinksOpen(false)}
          onSave={(next) => void setSocialLinks(next)}
        />
      ) : null}
      {sheet === "password" ? <PasswordSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "twofa" ? <TwoFASheet onClose={() => setSheet(null)} onEnabled={() => { setTwoFA(true); invalidateQueries("me"); void refetchMe(); }} /> : null}
      {sheet === "disable2fa" ? <Disable2FASheet onClose={() => setSheet(null)} onDisabled={() => { setTwoFA(false); setSheet(null); invalidateQueries("me"); void refetchMe(); }} /> : null}
      {sheet === "appLang" ? <AppLanguageSheet value={appLanguage} onClose={() => setSheet(null)} onSave={(v) => { setAppLanguage(v); setSheet(null); }} /> : null}
      {sheet === "support" ? <InfoSheet title="Help & support" body="Reach the Nuru team at support@nuru.app or talk to your cell leader. FAQs cover pathway progress, reflections, giving and offline use." onClose={() => setSheet(null)} /> : null}
      {sheet === "privacy" ? <InfoSheet title="Privacy policy" body="We collect only what personalises your discipleship journey. Your mentor and cell leader can see pathway progress and reflections; contact details stay private. Data is encrypted in transit and at rest. You can edit or delete your information anytime." onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

/* ---------- building blocks ---------- */

function Section({ title, Icon, children }: { title: string; Icon: LucideIcon; children: ReactNode }): ReactElement {
  return (
    <View style={st.section}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm }}>
        <Icon size={12} color={GOLD_TEXT} />
        <T variant="micro" style={{ color: GOLD_TEXT, fontWeight: "700", letterSpacing: 1.4 }}>{title}</T>
      </View>
      {children}
    </View>
  );
}

function Row({ children, onPress, divider }: { children: ReactNode; onPress?: (() => void) | undefined; divider?: boolean | undefined }): ReactElement {
  const inner = <View style={[st.row, divider && st.rowDivider]}>{children}</View>;
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>{inner}</Pressable>
  ) : inner;
}

function ActionRow({ Icon, tint, color, title, meta, onPress, trailing, divider }: { Icon: LucideIcon; tint: string; color: string; title: string; meta: string; onPress?: (() => void) | undefined; trailing?: ReactNode; divider?: boolean | undefined }): ReactElement {
  return (
    <Row onPress={onPress} divider={divider}>
      <View style={[st.fieldIcon, { backgroundColor: tint, borderColor: "transparent" }]}><Icon size={16} color={color} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="body" style={{ color: palette.navy, fontWeight: "600" }}>{title}</T>
        <T variant="micro" tone="secondary" numberOfLines={1}>{meta}</T>
      </View>
      {trailing ?? <ChevronRight size={16} color={palette.ink400} />}
    </Row>
  );
}

function PreferenceRow({ Icon, title, meta, on, onToggle, divider }: { Icon: LucideIcon; title: string; meta: string; on: boolean; onToggle: () => void; divider?: boolean | undefined }): ReactElement {
  return (
    <View style={[st.row, divider && st.rowDivider]}>
      <View style={st.fieldIcon}><Icon size={16} color={palette.navy} /></View>
      <View style={{ flex: 1 }}>
        <T variant="body" style={{ color: palette.navy, fontWeight: "600" }}>{title}</T>
        <T variant="micro" tone="secondary">{meta}</T>
      </View>
      <Toggle on={on} onToggle={onToggle} />
    </View>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={onToggle} style={[st.toggle, { backgroundColor: on ? palette.gold : "rgba(11,31,51,0.15)" }]}>
      <View style={[st.knob, { alignSelf: on ? "flex-end" : "flex-start" }]} />
    </Pressable>
  );
}

function Medallion({ name, onPress }: { name: string; onPress: () => void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} badge details`}
      onPress={onPress}
      style={({ pressed }) => [{ width: 66, alignItems: "center" }, pressed ? { opacity: 0.6 } : null]}
    >
      <View style={st.medallion}><Award size={20} color={palette.gold} /></View>
      <T variant="micro" style={{ color: palette.navy, fontWeight: "600", textAlign: "center", marginTop: 6 }} numberOfLines={2}>{name}</T>
    </Pressable>
  );
}

function CertificateCard({ cert, onOpen }: { cert: CertificateRow; onOpen: () => void }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copyCode = (): void => {
    try {
      Clipboard.setString(cert.verification_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      Alert.alert("Verification code", cert.verification_code);
    }
  };
  return (
    <View style={st.certCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={st.certIcon}><Award size={20} color={palette.gold} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="body" style={{ color: palette.navy, fontWeight: "600" }} numberOfLines={1}>Level {cert.level_number} Certificate</T>
          <T variant="micro" tone="secondary">Issued {formatDate(cert.issued_at)}</T>
        </View>
        <View style={st.signedPill}>
          <ShieldCheck size={11} color={palette.successText} />
          <Pill bg="transparent" color={palette.successText}>Signed</Pill>
        </View>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Copy verification code" onPress={copyCode} style={st.codeRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="micro" tone="tertiary" style={st.fieldLabel}>VERIFICATION CODE</T>
          <T variant="caption" style={st.codeText} numberOfLines={1}>{cert.verification_code}</T>
        </View>
        {copied ? <Check size={15} color={palette.success} strokeWidth={3} /> : <Copy size={15} color={palette.navy} />}
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel="Download or view certificate PDF" onPress={onOpen} style={st.certOpenBtn}>
        <Download size={15} color={palette.navy} />
        <T variant="caption" style={{ color: palette.navy, fontWeight: "600" }}>Download / View PDF</T>
      </Pressable>
    </View>
  );
}

function MilestoneRow({ label, meta, status, isLast }: { label: string; meta: string; status: "done" | "active" | "future"; isLast: boolean }): ReactElement {
  const done = status === "done";
  const active = status === "active";
  return (
    <View style={{ flexDirection: "row", gap: spacing.md }}>
      <View style={{ alignItems: "center" }}>
        <View style={[st.msDot, { backgroundColor: done ? palette.gold : active ? palette.white : "#F3F4F6", borderWidth: active ? 2 : done ? 0 : 1, borderColor: active ? palette.gold : palette.border }]}>
          {done ? <Check size={14} color={palette.navy} strokeWidth={3} /> : active ? <Calendar size={13} color={palette.gold} /> : <Heart size={12} color={palette.ink400} />}
        </View>
        {!isLast ? <View style={{ width: 1, flex: 1, minHeight: 16, backgroundColor: done ? palette.gold : "rgba(11,31,51,0.12)", marginTop: 4 }} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: spacing.md }}>
        <T variant="body" style={{ color: done || active ? palette.navy : palette.ink400, fontWeight: "600" }}>{label}</T>
        <T variant="micro" tone="secondary" style={{ marginTop: 2 }}>{meta}</T>
      </View>
    </View>
  );
}

/* ---------- bottom sheets ---------- */

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): ReactElement {
  // Lift the sheet above the on-screen keyboard so the field being edited stays
  // visible (the sheet is anchored to bottom:0, which the keyboard would cover).
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={[st.sheet, { bottom: kbHeight }]}>
        <View style={st.grabber} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.base }}>
          <T serif style={{ fontSize: 20, color: palette.navy }}>{title}</T>
          <Pressable onPress={onClose} style={st.sheetClose}><X size={16} color={palette.navy} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function GoldButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean | undefined }): ReactElement {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[st.goldBtn, disabled && { opacity: 0.4 }]}>
      <T variant="body" style={{ color: palette.navy, fontWeight: "700" }}>{label}</T>
    </Pressable>
  );
}

function EditFieldSheet({ field, onClose, onSave }: { field: Field; onClose: () => void; onSave: (v: string) => void }): ReactElement {
  const [value, setValue] = useState(field.value === "—" ? "" : field.value);
  return (
    <SheetShell title={`Edit ${field.label.toLowerCase()}`} onClose={onClose}>
      {field.type === "select" && field.options ? (
        <View style={{ gap: spacing.sm }}>
          {field.options.map((opt) => (
            <Pressable key={opt} onPress={() => setValue(opt)} style={[st.selectOpt, value === opt && st.selectOptOn]}>
              <T variant="body" style={{ color: palette.navy }}>{opt}</T>
              {value === opt ? <Check size={16} color={palette.gold} strokeWidth={3} /> : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput
          autoFocus value={value} onChangeText={setValue}
          keyboardType={field.type === "email" ? "email-address" : field.type === "tel" ? "phone-pad" : "default"}
          placeholder={field.label} placeholderTextColor={palette.ink400} style={st.input}
        />
      )}
      <View style={{ marginTop: spacing.base }}><GoldButton label="Save changes" onPress={() => onSave(value || "—")} /></View>
    </SheetShell>
  );
}

function LanguagesSheet({ selected, fallbackDefault, onClose, onSave }: { selected: string[]; fallbackDefault: string; onClose: () => void; onSave: (sel: string[], def: string) => void }): ReactElement {
  const [picked, setPicked] = useState<string[]>(selected);
  const [def, setDef] = useState(fallbackDefault);
  const MAX = 3;
  const toggle = (lang: string): void => {
    setPicked((cur) => {
      if (cur.includes(lang)) {
        const next = cur.filter((l) => l !== lang);
        if (def === lang && next[0]) setDef(next[0]);
        return next;
      }
      return cur.length >= MAX ? cur : [...cur, lang];
    });
  };
  return (
    <SheetShell title="Languages spoken" onClose={onClose}>
      <T variant="caption" tone="secondary" style={{ marginBottom: spacing.sm }}>Pick up to {MAX}. Tap a chip to set your default.</T>
      <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: spacing.sm }}>
          {ALL_LANGUAGES.map((lang) => {
            const on = picked.includes(lang);
            return (
              <View key={lang} style={[st.selectOpt, on && st.selectOptOn]}>
                <Pressable onPress={() => toggle(lang)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={[st.checkbox, on && { backgroundColor: palette.gold, borderColor: palette.gold }]}>{on ? <Check size={13} color={palette.navy} strokeWidth={3} /> : null}</View>
                  <T variant="body" style={{ color: palette.navy }}>{lang}</T>
                </Pressable>
                {on ? (
                  <Pressable onPress={() => setDef(lang)} style={[st.defaultPill, def === lang && { backgroundColor: palette.gold }]}>
                    <T variant="micro" style={{ color: def === lang ? palette.navy : GOLD_TEXT, fontWeight: "700" }}>{def === lang ? "Default" : "Set default"}</T>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ marginTop: spacing.base }}>
        <GoldButton label="Save languages" disabled={picked.length === 0} onPress={() => picked.length > 0 && onSave(picked, picked.includes(def) ? def : (picked[0] ?? "English"))} />
      </View>
    </SheetShell>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }): ReactElement {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!current || !next) { setError("Enter your current and new password."); return; }
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("New passwords don't match."); return; }
    setBusy(true); setError(null);
    try {
      await NuruApi.changePassword(current, next);
      Alert.alert("Password updated", "Use your new password next time you sign in.");
      onClose();
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      setError(status === 403 ? "Your current password is incorrect." : "Couldn't update password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetShell title="Change password" onClose={onClose}>
      <View style={{ gap: spacing.sm }}>
        <TextInput secureTextEntry value={current} onChangeText={setCurrent} placeholder="Current password" placeholderTextColor={palette.ink400} style={st.input} />
        <TextInput secureTextEntry value={next} onChangeText={setNext} placeholder="New password" placeholderTextColor={palette.ink400} style={st.input} />
        <TextInput secureTextEntry value={confirm} onChangeText={setConfirm} placeholder="Confirm new password" placeholderTextColor={palette.ink400} style={st.input} />
      </View>
      {error ? <T variant="micro" style={{ color: palette.error, marginTop: spacing.sm }}>{error}</T> : (
        <T variant="micro" tone="secondary" style={{ marginTop: spacing.sm }}>Use at least 8 characters with letters, numbers and a symbol.</T>
      )}
      <View style={{ marginTop: spacing.base }}><GoldButton label={busy ? "Updating…" : "Update password"} disabled={busy} onPress={() => void submit()} /></View>
    </SheetShell>
  );
}

// Full enrollment flow: enroll (secret + otpauth) → scan/enter code to confirm →
// show one-time recovery codes. Server-authoritative; the factor only turns on
// once verifyMfa succeeds (§5.3).
function TwoFASheet({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }): ReactElement {
  const [step, setStep] = useState<"loading" | "scan" | "recovery">("loading");
  const [enroll, setEnroll] = useState<{ otpauth_uri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    NuruApi.mfaEnroll()
      .then((e) => { if (alive) { setEnroll(e); setStep("scan"); } })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, []);

  async function confirm(): Promise<void> {
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code from your app."); return; }
    setBusy(true); setError(null);
    try {
      const res = await NuruApi.mfaVerify(code.trim());
      setRecovery(res.recovery_codes ?? []);
      onEnabled();
      setStep("recovery");
    } catch {
      setError("That code didn't match. Check your authenticator and try again.");
    } finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <SheetShell title="Two-factor authentication" onClose={onClose}>
        <T variant="caption" tone="secondary">Couldn't start setup. Check your connection and try again.</T>
        <View style={{ marginTop: spacing.base }}><GoldButton label="Close" onPress={onClose} /></View>
      </SheetShell>
    );
  }

  if (step === "recovery") {
    return (
      <SheetShell title="Save your recovery codes" onClose={onClose}>
        <T variant="caption" tone="secondary">
          2FA is on. Store these codes somewhere safe — each works once if you lose your authenticator. They won&apos;t be shown again.
        </T>
        <View style={st.recoveryBox}>
          {recovery.map((c) => (
            <T key={c} variant="body" style={st.recoveryCode}>{c}</T>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => { Clipboard.setString(recovery.join("\n")); Alert.alert("Copied", "Recovery codes copied to the clipboard."); }}
          style={({ pressed }) => [st.copyRow, pressed && { opacity: 0.85 }]}
        >
          <Copy size={15} color={GOLD_TEXT} />
          <T variant="caption" style={{ color: GOLD_TEXT, fontWeight: "700" }}>Copy all codes</T>
        </Pressable>
        <View style={{ marginTop: spacing.base }}><GoldButton label="Done" onPress={onClose} /></View>
      </SheetShell>
    );
  }

  return (
    <SheetShell title="Set up two-factor authentication" onClose={onClose}>
      <T variant="caption" tone="secondary">
        Scan this QR with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code it shows.
      </T>
      <View style={st.qrBox}>
        {step === "loading" || !enroll ? (
          <ActivityIndicator color={palette.navy} />
        ) : (
          <QRCode value={enroll.otpauth_uri} size={172} backgroundColor="transparent" color={palette.navy} />
        )}
      </View>
      {enroll ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { Clipboard.setString(enroll.secret); Alert.alert("Copied", "Setup key copied — paste it into your authenticator."); }}
          style={({ pressed }) => [st.secretRow, pressed && { opacity: 0.85 }]}
        >
          <View style={{ flex: 1 }}>
            <T variant="micro" tone="tertiary" style={st.fieldLabel}>CAN&apos;T SCAN? ENTER THIS KEY</T>
            <T variant="caption" style={{ color: palette.ink, fontWeight: "600", letterSpacing: 1 }} numberOfLines={1}>{enroll.secret}</T>
          </View>
          <Copy size={16} color={palette.ink600} />
        </Pressable>
      ) : null}
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        placeholderTextColor={palette.ink400}
        keyboardType="number-pad"
        maxLength={6}
        style={[st.input, { marginTop: spacing.sm, textAlign: "center", letterSpacing: 6, fontSize: 20 }]}
      />
      {error ? <T variant="micro" style={{ color: palette.error, marginTop: spacing.sm }}>{error}</T> : null}
      <View style={{ marginTop: spacing.base }}>
        <GoldButton label={busy ? "Verifying…" : "Verify & enable"} disabled={busy || !enroll} onPress={() => void confirm()} />
      </View>
    </SheetShell>
  );
}

// Turning 2FA off requires a current code (TOTP or a recovery code) — the same
// proof the server demands, so a stolen unlocked phone can't silently disable it.
function Disable2FASheet({ onClose, onDisabled }: { onClose: () => void; onDisabled: () => void }): ReactElement {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!code.trim()) { setError("Enter a code to confirm."); return; }
    setBusy(true); setError(null);
    try {
      await NuruApi.mfaDisable(code.trim());
      Alert.alert("2FA turned off", "Two-factor authentication is no longer required to sign in.");
      onDisabled();
    } catch {
      setError("That code didn't match. Use a current code from your app or a recovery code.");
    } finally { setBusy(false); }
  }

  return (
    <SheetShell title="Turn off two-factor authentication" onClose={onClose}>
      <T variant="caption" tone="secondary">
        Enter a current 6-digit code from your authenticator (or a recovery code) to confirm. Your account will be less protected.
      </T>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="123456 or recovery code"
        placeholderTextColor={palette.ink400}
        autoCapitalize="none"
        autoCorrect={false}
        style={[st.input, { marginTop: spacing.md }]}
      />
      {error ? <T variant="micro" style={{ color: palette.error, marginTop: spacing.sm }}>{error}</T> : null}
      <View style={{ marginTop: spacing.base }}>
        <GoldButton label={busy ? "Turning off…" : "Turn off 2FA"} disabled={busy} onPress={() => void submit()} />
      </View>
    </SheetShell>
  );
}

function AppLanguageSheet({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (v: string) => void }): ReactElement {
  // Only English ships today; Swahili & French are previewed as "Coming soon"
  // and aren't selectable (disabled pressable + a clear pill).
  const [picked, setPicked] = useState(value === "English" ? value : "English");
  const options = [
    { name: "English", note: "Available", disabled: false },
    { name: "Swahili", note: "Translation in progress", disabled: true },
    { name: "French", note: "Translation in progress", disabled: true },
  ];
  return (
    <SheetShell title="App language" onClose={onClose}>
      <View style={{ gap: spacing.sm }}>
        {options.map((o) => (
          <Pressable
            key={o.name}
            disabled={o.disabled}
            accessibilityState={{ disabled: o.disabled, selected: picked === o.name }}
            onPress={() => !o.disabled && setPicked(o.name)}
            style={[st.selectOpt, picked === o.name && st.selectOptOn, o.disabled && { opacity: 0.55 }]}
          >
            <View style={{ flex: 1 }}>
              <T variant="body" style={{ color: palette.navy }}>{o.name}</T>
              <T variant="micro" tone="secondary">{o.note}</T>
            </View>
            {o.disabled ? (
              <View style={st.soonPill}><T variant="micro" style={{ color: GOLD_TEXT, fontWeight: "700", letterSpacing: 0.4 }}>Coming soon</T></View>
            ) : picked === o.name ? (
              <Check size={16} color={palette.gold} strokeWidth={3} />
            ) : null}
          </Pressable>
        ))}
      </View>
      <View style={{ marginTop: spacing.base }}><GoldButton label="Save" onPress={() => onSave(picked)} /></View>
    </SheetShell>
  );
}

function InfoSheet({ title, body, onClose }: { title: string; body: string; onClose: () => void }): ReactElement {
  return (
    <SheetShell title={title} onClose={onClose}>
      <T variant="body" tone="secondary" style={{ lineHeight: 21 }}>{body}</T>
      <View style={{ marginTop: spacing.base }}><GoldButton label="Got it" onPress={onClose} /></View>
    </SheetShell>
  );
}

function BadgeDetailSheet({ badge, onClose }: { badge: Badge; onClose: () => void }): ReactElement {
  return (
    <SheetShell title="Badge" onClose={onClose}>
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <View style={st.badgeLarge}><Award size={40} color={palette.gold} /></View>
        <T serif style={{ fontSize: 20, color: palette.navy, textAlign: "center" }}>{badge.name}</T>
        <View style={st.categoryChip}>
          <Tag size={11} color={GOLD_TEXT} />
          <T variant="micro" style={{ color: GOLD_TEXT, fontWeight: "700", letterSpacing: 0.8 }}>{badge.category.toUpperCase()}</T>
        </View>
      </View>
      <View style={st.badgeBody}>
        <T variant="micro" tone="tertiary" style={st.fieldLabel}>HOW IT&apos;S EARNED</T>
        <T variant="body" tone="secondary" style={{ lineHeight: 21, marginTop: 4 }}>{badge.description}</T>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, justifyContent: "center" }}>
        <Calendar size={13} color={palette.ink400} />
        <T variant="micro" tone="secondary">Earned {formatDate(badge.awarded_at)}</T>
      </View>
      <View style={{ marginTop: spacing.base }}><GoldButton label="Close" onPress={onClose} /></View>
    </SheetShell>
  );
}

function SocialLinksSheet({
  current,
  onClose,
  onSave,
}: {
  current: Record<string, string>;
  onClose: () => void;
  onSave: (next: Record<string, string>) => void;
}): ReactElement {
  // Known links first, then any extra keys the backend already stores.
  const extraKeys = Object.keys(current).filter((k) => !SOCIAL_LINKS.some((s) => s.key === k));
  const seed: Record<string, string> = {};
  for (const s of SOCIAL_LINKS) seed[s.key] = current[s.key] ?? "";
  for (const k of extraKeys) seed[k] = current[k] ?? "";
  const [draft, setDraft] = useState<Record<string, string>>(seed);
  const rows = [
    ...SOCIAL_LINKS,
    ...extraKeys.map((k) => ({ key: k, label: socialLabel(k), Icon: Link2 as LucideIcon, placeholder: "handle or URL" })),
  ];
  return (
    <SheetShell title="Social links" onClose={onClose}>
      <T variant="caption" tone="secondary" style={{ marginBottom: spacing.sm }}>
        Optional — leave blank to hide. Saved to your profile.
      </T>
      <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: spacing.md }}>
          {rows.map((r) => (
            <View key={r.key} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <r.Icon size={13} color={palette.navy} />
                <T variant="micro" style={{ color: palette.navy, fontWeight: "700", letterSpacing: 0.4 }}>{r.label}</T>
              </View>
              <TextInput
                value={draft[r.key] ?? ""}
                onChangeText={(v) => setDraft((cur) => ({ ...cur, [r.key]: v }))}
                placeholder={r.placeholder}
                placeholderTextColor={palette.ink400}
                autoCapitalize="none"
                autoCorrect={false}
                style={st.input}
              />
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={{ marginTop: spacing.base }}><GoldButton label="Save social links" onPress={() => onSave(draft)} /></View>
    </SheetShell>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: CREAM },
  header: { backgroundColor: palette.navy, paddingTop: 54, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  headerBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#15355f", borderWidth: 2, borderColor: palette.gold, alignItems: "center", justifyContent: "center" },
  avatarEdit: { position: "absolute", bottom: -2, right: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: palette.gold, borderWidth: 2, borderColor: palette.navy, alignItems: "center", justifyContent: "center" },
  levelChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  faChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(22,163,74,0.2)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  section: { backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: spacing.base },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  fieldIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  fieldLabel: { letterSpacing: 1, fontWeight: "700" },
  langChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  langChipDefault: { backgroundColor: "rgba(201,162,39,0.12)", borderColor: "rgba(201,162,39,0.4)" },
  connectBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  connectBtnOn: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border },
  connectBtnOff: { backgroundColor: palette.gold },
  toggle: { width: 40, height: 24, borderRadius: 12, padding: 2, justifyContent: "center" },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  medallion: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.goldTint, borderWidth: 1.5, borderColor: palette.gold, alignItems: "center", justifyContent: "center" },
  msDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  certCard: { gap: spacing.sm, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: spacing.md, marginBottom: spacing.sm },
  certIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(201,162,39,0.18)", borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", alignItems: "center", justifyContent: "center" },
  signedPill: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: palette.successBg, borderRadius: 999, paddingLeft: 8 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 10 },
  codeText: { color: palette.navy, fontWeight: "600", marginTop: 2, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), letterSpacing: 0.5 },
  certOpenBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingVertical: 10 },
  dangerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 16, borderWidth: 1, paddingVertical: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%", backgroundColor: palette.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xxl, ...shadow.card },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(11,31,51,0.15)", marginBottom: spacing.md },
  sheetClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, paddingHorizontal: spacing.base, paddingVertical: 12, fontSize: 15, color: palette.navy },
  selectOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: spacing.md },
  sizeOpt: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 52, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 14 },
  sizeOptOn: { backgroundColor: palette.goldChipBg, borderColor: palette.gold },
  selectOptOn: { backgroundColor: "rgba(201,162,39,0.10)", borderColor: palette.gold },
  soonPill: { backgroundColor: "rgba(201,162,39,0.12)", borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  secretRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: spacing.md, marginTop: spacing.md },
  recoveryBox: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: spacing.md, marginTop: spacing.md, rowGap: spacing.sm },
  recoveryCode: { width: "48%", color: palette.ink, fontWeight: "700", letterSpacing: 1, ...(Platform.OS === "ios" ? { fontFamily: "Menlo" } : { fontFamily: "monospace" }) },
  copyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: palette.border, backgroundColor: palette.white, alignItems: "center", justifyContent: "center" },
  defaultPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(201,162,39,0.4)" },
  goldBtn: { backgroundColor: palette.gold, borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  qrBox: { alignSelf: "center", width: 160, height: 160, borderRadius: 16, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", marginTop: spacing.base },
  badgeLarge: { width: 92, height: 92, borderRadius: 46, backgroundColor: palette.goldTint, borderWidth: 2, borderColor: palette.gold, alignItems: "center", justifyContent: "center" },
  categoryChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(201,162,39,0.12)", borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeBody: { backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: spacing.md, marginTop: spacing.base },
} as const;
