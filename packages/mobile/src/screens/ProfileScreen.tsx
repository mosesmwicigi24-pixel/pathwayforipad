// Profile (rebuilt to the "Nuru Pathway app design" make — AgqYlBEN2Sy2tA6vjBaUxE).
// Faithful section layout: identity header, Personal information, Security & login,
// Connected accounts, Notifications, Achievements, Milestones, Certificates, and
// Help & privacy — with bottom-sheet editors. Seeded from real /me + achievements;
// edits are session-local (the make itself keeps them in component state), so the
// data shown is real while the interactions mirror the design exactly.
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  Award, Bell, Calendar, Check, ChevronRight, Compass, Download, Fingerprint, Globe,
  Heart, KeyRound, Languages, LifeBuoy, Lock, LogOut, Mail, MapPin, Pencil, Phone,
  ScrollText, Settings, ShieldCheck, Smartphone, Sparkles, Trash2, User, UserCog, X,
  type LucideIcon,
} from "lucide-react-native";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { useMe, useAchievements } from "../api/hooks";
import { NuruApi } from "../api/client";
import { clearQueryCache, invalidateQueries } from "../api/query";
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

function initials(full: string): string {
  return full.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "NP";
}
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

export function ProfileScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: me } = useMe();
  const { data: achievements } = useAchievements();
  const profileData = me?.profile;
  const level = me?.enrollment?.current_level ?? 1;

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
  const [sheet, setSheet] = useState<null | "password" | "twofa" | "appLang" | "support" | "privacy">(null);
  const [twoFA, setTwoFA] = useState(false);
  const [appLanguage, setAppLanguage] = useState("English");
  const [pushOn, setPushOn] = useState(true);
  const [emailOn, setEmailOn] = useState(true);
  const [smsOn, setSmsOn] = useState(false);
  const [socials, setSocials] = useState<Record<string, boolean>>({ Google: true, Facebook: false, Instagram: true, X: false, LinkedIn: false, YouTube: false });

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
      await NuruApi.updateMe(patch, profileData?.row_version ?? 1);
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
      await NuruApi.updateMe({ locale: LANG_TO_LOCALE[lang] ?? "en" }, profileData?.row_version ?? 1);
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
    nav.reset({ index: 0, routes: [{ name: "Login" }] });
  }

  const badges = achievements?.badges ?? [];
  const milestones: Array<{ id: string; label: string; meta: string; status: "done" | "active" | "future" }> = [
    { id: "baptism", label: "Baptism", meta: profileData?.is_baptized ? "Confirmed" : "Not yet recorded", status: profileData?.is_baptized ? "done" : "future" },
    ...(level > 1 ? [{ id: "l1", label: "Level 1 completed", meta: "Foundations of Faith", status: "done" as const }] : []),
    { id: "active", label: `Level ${level} · in progress`, meta: "Keep going", status: "active" },
    { id: "path", label: "Pathway completion", meta: "Your journey continues", status: "future" },
  ];
  const certificates = level > 1 ? Array.from({ length: level - 1 }, (_, i) => ({ id: `c${i + 1}`, title: `Level ${i + 1} Certificate`, meta: `Completed · Level ${i + 1}` })) : [];

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
            <View style={st.avatar}>
              <T serif tone="onNavy" style={{ fontSize: 24 }}>{initials(name)}</T>
              <View style={st.avatarEdit}><Pencil size={11} color={palette.navy} strokeWidth={2.5} /></View>
            </View>
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
              trailing={<Toggle on={twoFA} onToggle={() => (twoFA ? setTwoFA(false) : setSheet("twofa"))} />}
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

          <Section title="NOTIFICATIONS" Icon={Bell}>
            <PreferenceRow Icon={Bell} title="Push notifications" meta="Devotionals, events, reminders" on={pushOn} onToggle={() => setPushOn(!pushOn)} />
            <PreferenceRow divider Icon={Mail} title="Email" meta="Weekly summary & receipts" on={emailOn} onToggle={() => setEmailOn(!emailOn)} />
            <PreferenceRow divider Icon={Phone} title="SMS" meta="Critical updates only" on={smsOn} onToggle={() => setSmsOn(!smsOn)} />
          </Section>

          <Section title="ACHIEVEMENTS" Icon={Sparkles}>
            {badges.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingVertical: 4 }}>
                {badges.map((b) => <Medallion key={b.code} name={b.name} />)}
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
            {certificates.length > 0 ? certificates.map((c) => (
              <View key={c.id} style={st.certCard}>
                <View style={st.certIcon}><Award size={20} color={palette.gold} /></View>
                <View style={{ flex: 1 }}>
                  <T variant="body" style={{ color: palette.navy, fontWeight: "600" }}>{c.title}</T>
                  <T variant="micro" tone="secondary">{c.meta}</T>
                </View>
                <View style={st.certDownload}><Download size={15} color={palette.gold} /></View>
              </View>
            )) : (
              <T variant="caption" tone="secondary">Complete a level to earn your first certificate.</T>
            )}
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
      {sheet === "password" ? <PasswordSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "twofa" ? <TwoFASheet onClose={() => setSheet(null)} onEnable={() => { setTwoFA(true); setSheet(null); }} /> : null}
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

function Medallion({ name }: { name: string }): ReactElement {
  return (
    <View style={{ width: 66, alignItems: "center" }}>
      <View style={st.medallion}><Award size={20} color={palette.gold} /></View>
      <T variant="micro" style={{ color: palette.navy, fontWeight: "600", textAlign: "center", marginTop: 6 }} numberOfLines={2}>{name}</T>
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
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.grabber} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.base }}>
          <T serif style={{ fontSize: 20, color: palette.navy }}>{title}</T>
          <Pressable onPress={onClose} style={st.sheetClose}><X size={16} color={palette.navy} /></Pressable>
        </View>
        {children}
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

function TwoFASheet({ onClose, onEnable }: { onClose: () => void; onEnable: () => void }): ReactElement {
  return (
    <SheetShell title="Two-factor authentication" onClose={onClose}>
      <T variant="caption" tone="secondary">Add a second step at sign-in with an authenticator app (Google Authenticator, Authy, 1Password).</T>
      <View style={st.qrBox}><Fingerprint size={56} color={palette.navy} /></View>
      <T variant="micro" tone="secondary" style={{ textAlign: "center", marginTop: spacing.sm }}>Scan in your authenticator, then confirm.</T>
      <View style={{ marginTop: spacing.base }}><GoldButton label="Enable 2FA" onPress={onEnable} /></View>
    </SheetShell>
  );
}

function AppLanguageSheet({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (v: string) => void }): ReactElement {
  const [picked, setPicked] = useState(value);
  const options = [{ name: "English", note: "Available", disabled: false }, { name: "Swahili", note: "Available", disabled: false }, { name: "French", note: "Coming soon", disabled: true }];
  return (
    <SheetShell title="App language" onClose={onClose}>
      <View style={{ gap: spacing.sm }}>
        {options.map((o) => (
          <Pressable key={o.name} disabled={o.disabled} onPress={() => setPicked(o.name)} style={[st.selectOpt, picked === o.name && st.selectOptOn, o.disabled && { opacity: 0.5 }]}>
            <View>
              <T variant="body" style={{ color: palette.navy }}>{o.name}</T>
              <T variant="micro" tone="secondary">{o.note}</T>
            </View>
            {picked === o.name ? <Check size={16} color={palette.gold} strokeWidth={3} /> : null}
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
  certCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: spacing.md, marginBottom: spacing.sm },
  certIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(201,162,39,0.18)", borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", alignItems: "center", justifyContent: "center" },
  certDownload: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  dangerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 16, borderWidth: 1, paddingVertical: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: palette.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xxl, ...shadow.card },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(11,31,51,0.15)", marginBottom: spacing.md },
  sheetClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, paddingHorizontal: spacing.base, paddingVertical: 12, fontSize: 15, color: palette.navy },
  selectOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: spacing.md },
  selectOptOn: { backgroundColor: "rgba(201,162,39,0.10)", borderColor: palette.gold },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: palette.border, backgroundColor: palette.white, alignItems: "center", justifyContent: "center" },
  defaultPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(201,162,39,0.4)" },
  goldBtn: { backgroundColor: palette.gold, borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  qrBox: { alignSelf: "center", width: 160, height: 160, borderRadius: 16, backgroundColor: SURFACE, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", marginTop: spacing.base },
} as const;
