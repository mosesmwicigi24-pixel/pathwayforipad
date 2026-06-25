// Chat — oversight/moderation console over the member-facing mobile chat, rebuilt
// to the "Final Pathway Portal" make and wired to the live chat + assistant
// modules. The portal admin reads disciple/group/space threads, moderates flagged
// messages, replies as admin, and uses Nuru (assistant module) to draft replies,
// prayers and encouragement. Backend conversation `kind` is dm|group|space — the
// make's "direct"/"support" labels map from `dm`/derived. Moderation (flag /
// dismiss flag / remove) is server-authoritative via the chat module's moderation
// routes; flagged counts and per-message state come from the server. Mute /
// archive / attachment upload have no endpoint yet and stay local display-only.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  ChevronRight, Search, MessagesSquare, Flag, Trash2, Volume2, VolumeX,
  Archive, ArchiveRestore, Send, ShieldAlert, Users, Sparkles, AlertTriangle,
  CheckCheck, Check, Circle, X, MessageSquare, Activity, Eye,
  WifiOff, Moon, LayoutGrid, Hash, Wand2, Loader2, Image as ImageIcon, Paperclip, FileText,
  Plus, Mic, Square, Globe, PenSquare, UserPlus,
} from "lucide-react";
import {
  ChatApi, AssistantApi, uploadToCloudinary,
  type ChatConversationRow, type ChatMessageRow, type ChatKind, type ChatAiTag,
  type ChatMsgType, type AssistantTurn, type ChatDiscoverSpace, type ChatPerson, type ChatReaders,
} from "../../api/client";
import { errorMessage } from "../../util/error";

/* ── UI type model (make) — backend kinds (dm|group|space) widened with a
      derived "support" label; we only ever receive dm/group/space. ── */
type ChatType = "direct" | "group" | "support" | "space";
type ChatHealth = "ongoing" | "silent" | "failed";
type View = "overview" | "conversations";
type NuruIntent = "reply" | "encourage" | "prayer";
type NuruTone = "default" | "shorter" | "warmer" | "formal";

// Inbox segments — mirror the mobile app's three-segment chat control so the
// portal feels like the same product: My Space / DM / My Groups.
type Segment = "space" | "dm" | "group";
const SEGMENTS: { key: Segment; label: string; kind: ChatKind }[] = [
  { key: "space", label: "My Space", kind: "space" },
  { key: "dm", label: "DM", kind: "dm" },
  { key: "group", label: "My Groups", kind: "group" },
];

const typeMeta: Record<ChatType, { label: string; bg: string; color: string }> = {
  direct: { label: "Direct", bg: "#EEF1F8", color: "#1F3A6B" },
  group: { label: "Group", bg: "#E8F6EE", color: "#0F6B33" },
  support: { label: "Support", bg: "#F0EBFA", color: "#5B2BB8" },
  space: { label: "Space", bg: "#FDF5E5", color: "#8A6B1F" },
};

const healthMeta: Record<ChatHealth, { label: string; color: string }> = {
  ongoing: { label: "Ongoing", color: "#16A34A" },
  silent: { label: "Silent", color: "#94A3B8" },
  failed: { label: "Failed", color: "#DC2626" },
};

const aiTagMeta: Record<Exclude<ChatAiTag, null>, { label: string; emoji: string; bg: string; color: string }> = {
  prayer: { label: "Prayer", emoji: "🙏", bg: "#F0EBFA", color: "#5B2BB8" },
  action: { label: "Action", emoji: "✅", bg: "#E8F6EE", color: "#0F6B33" },
  important: { label: "Important", emoji: "⚠️", bg: "#FDECEC", color: "#A8281F" },
};

const DAY = 24 * 60 * 60 * 1000;
const SILENT_AFTER = 3 * DAY;

const typeOf = (kind: ChatKind): ChatType => (kind === "dm" ? "direct" : kind);

function initials(name: string): string {
  return name
    .split(" ")
    .filter((p) => !/^(pastor|rev|dr|mr|mrs|ms)\.?$/i.test(p))
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("") || "?";
}

// Deterministic avatar colour (mirrors the mobile app's 7-colour hash) so a name
// always maps to the same tile colour across portal and app.
const AVATAR_COLORS = ["#C89B3C", "#6366F1", "#3FA9F5", "#22B07D", "#E07B39", "#EC4899", "#14B8A6"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Profile-photo thumbnail, falling back to initials on a deterministic colour. */
function Avatar({ uri, name, size = 40, square, icon }: { uri?: string | null | undefined; name: string; size?: number | undefined; square?: boolean | undefined; icon?: ReactNode | undefined }): ReactElement {
  const radius = square ? Math.round(size * 0.3) : size / 2;
  if (uri) {
    return <img src={uri} alt={name} style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0, background: "#E8EEF7", display: "block" }} />;
  }
  return (
    <span className="flex items-center justify-center shrink-0" style={{ width: size, height: size, borderRadius: radius, background: avatarColor(name || "?"), color: "#fff", fontSize: Math.round(size * 0.4), fontWeight: 700 }}>
      {icon ?? initials(name)}
    </span>
  );
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

function chatTimeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - ms(iso)) / 1000);
  if (s < 45) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms(iso)).toLocaleDateString();
}

function chatClock(iso: string): string {
  return new Date(ms(iso)).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ── A lightweight, listing-side view of a conversation (derived from the
      list endpoint). The thread + messages are fetched on demand. ── */
interface ConvoView extends ChatConversationRow {
  type: ChatType;
}

function conversationTitle(c: ChatConversationRow): string {
  return c.title?.trim() || (c.kind === "dm" ? "Direct message" : c.kind === "space" ? "Space" : "Group");
}

/* Health from the list row (we lack per-message delivery state at list time, so
   "failed" is surfaced from the open thread instead — list health is ongoing/silent). */
function rowHealth(c: ChatConversationRow): ChatHealth {
  const last = ms(c.last_at);
  if (!last || Date.now() - last > SILENT_AFTER) return "silent";
  return "ongoing";
}

export function Chat(): ReactElement {
  const [searchParams] = useSearchParams();
  const paramC = searchParams.get("c");

  const [rows, setRows] = useState<ChatConversationRow[]>([]);
  const [discover, setDiscover] = useState<ChatDiscoverSpace[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const [segment, setSegment] = useState<Segment>("dm");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(paramC ?? "");
  const [view, setView] = useState<View>("conversations");

  // New-message (DM directory) + "Seen by" read-receipt popover.
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [readersFor, setReadersFor] = useState<string | null>(null);
  const [readers, setReaders] = useState<ChatReaders | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Open-thread state
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Attachment upload (Cloudinary; bytes never touch our server).
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create-space modal + voice-note recording
  const [createOpen, setCreateOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Server-authoritative moderation: track in-flight message actions to disable buttons.
  const [moderatingIds, setModeratingIds] = useState<Set<string>>(new Set());
  // Mute / archive have no endpoint yet — local display-only.
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());

  // Nuru assist
  const [aiOpen, setAiOpen] = useState(true);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistIntent, setAssistIntent] = useState<NuruIntent | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const typeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadList = (): void => {
    setListLoading(true);
    ChatApi.conversations("mine")
      .then((r) => {
        setRows(r.conversations);
        setDiscover(r.discover_spaces ?? []);
        setListError(null);
        if (!activeId && r.conversations[0]) setActiveId(r.conversations[0].conversation_id);
      })
      .catch((e) => setListError(errorMessage(e, "Could not load conversations.")))
      .finally(() => setListLoading(false));
  };
  useEffect(loadList, []);

  const convos = useMemo<ConvoView[]>(
    () => rows.map((c) => ({ ...c, type: typeOf(c.kind) })),
    [rows],
  );

  const segKind = SEGMENTS.find((s) => s.key === segment)!.kind;
  const filtered = useMemo(() => {
    return convos.filter((c) => {
      if (c.kind !== segKind) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = `${conversationTitle(c)} ${c.last_body ?? ""} ${c.last_author ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [convos, segKind, query]);
  // Per-segment counts for the pill chips (mirrors the mobile count chips).
  const counts = useMemo(() => {
    const c: Record<Segment, number> = { space: 0, dm: 0, group: 0 };
    convos.forEach((cv) => { if (cv.kind in c) c[cv.kind as Segment] += 1; });
    return c;
  }, [convos]);

  const active = filtered.find((c) => c.conversation_id === activeId) ?? filtered[0] ?? convos.find((c) => c.conversation_id === activeId);
  const list = filtered;

  // Fetch the open thread when the active conversation changes.
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    let alive = true;
    setThreadLoading(true);
    setSummary(null);
    setAssistOpen(false);
    setAssistIntent(null);
    ChatApi.conversation(activeId)
      .then((d) => {
        if (!alive) return;
        setMessages(d.messages);
        setThreadError(null);
        // best-effort mark-read; ignore failures
        void ChatApi.markRead(activeId).then(() => {
          setRows((prev) => prev.map((r) => (r.conversation_id === activeId ? { ...r, unread: 0 } : r)));
        }).catch(() => { /* read receipt is non-critical */ });
      })
      .catch((e) => { if (alive) { setThreadError(errorMessage(e, "Could not open this conversation.")); setMessages([]); } })
      .finally(() => { if (alive) setThreadLoading(false); });
    return () => { alive = false; };
  }, [activeId]);

  // Auto-grow composer + keep latest message in view.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, messages, draft]);

  // Per-message status straight from server moderation state.
  const statusOf = (m: ChatMessageRow): "sent" | "flagged" | "removed" => {
    if (m.is_hidden) return "removed";
    if (m.is_flagged) return "flagged";
    return "sent";
  };
  const isMuted = active ? mutedIds.has(active.conversation_id) : false;
  const isArchived = active ? archivedIds.has(active.conversation_id) : false;

  /* ── Nuru (assistant module) ── */
  const recentTurns = (): AssistantTurn[] =>
    messages
      .filter((m) => !m.is_hidden)
      .slice(-12)
      .map((m): AssistantTurn => ({ role: m.mine ? "assistant" : "user", text: `${m.author_name}: ${m.body}`.slice(0, 4000) }))
      .filter((t) => t.text.trim().length > 0);

  const typeInto = (text: string): void => {
    if (typeRef.current) clearTimeout(typeRef.current);
    const words = text.split(" ");
    let i = 0;
    setDraft("");
    const step = (): void => {
      i += 1;
      setDraft(words.slice(0, i).join(" "));
      if (i < words.length) typeRef.current = setTimeout(step, 40);
    };
    typeRef.current = setTimeout(step, 40);
  };

  const INTENT_PROMPT: Record<NuruIntent, string> = {
    reply: "Draft a short, warm admin reply to the most recent member message in this conversation.",
    prayer: "Offer a short, heartfelt prayer responding to what this member shared.",
    encourage: "Write a brief, genuine word of encouragement for this member.",
  };
  const TONE_PROMPT: Record<NuruTone, string> = {
    default: "",
    shorter: " Keep it to one or two sentences.",
    warmer: " Make it especially warm and personal.",
    formal: " Use a respectful, formal tone.",
  };

  const runAssist = async (intent: NuruIntent, tone: NuruTone = "default"): Promise<void> => {
    if (!active) return;
    setAssistIntent(intent);
    setAssistBusy(true);
    try {
      const turns = recentTurns();
      const ask: AssistantTurn = { role: "user", text: INTENT_PROMPT[intent] + TONE_PROMPT[tone] };
      const { reply } = await AssistantApi.chat({
        messages: [...turns, ask],
        conversation_id: active.conversation_id,
      });
      typeInto(reply);
    } catch (e) {
      setThreadError(errorMessage(e, "Nuru could not draft a reply just now."));
    } finally {
      setAssistBusy(false);
    }
  };

  const loadSummary = async (): Promise<void> => {
    if (!active) return;
    setSummaryBusy(true);
    try {
      const { reply } = await AssistantApi.chat({
        messages: [{ role: "user", text: "Summarise this conversation in 2-3 sentences, noting any prayer requests, follow-ups, or anything needing a leader's attention." }],
        conversation_id: active.conversation_id,
      });
      setSummary(reply);
    } catch (e) {
      setSummary(null);
      setThreadError(errorMessage(e, "Nuru summary unavailable."));
    } finally {
      setSummaryBusy(false);
    }
  };

  /* ── Moderation (server-authoritative via the chat module) ── */
  const refetchThread = async (id: string): Promise<void> => {
    const d = await ChatApi.conversation(id);
    setMessages(d.messages);
  };
  const moderate = async (m: ChatMessageRow, run: () => Promise<unknown>): Promise<void> => {
    if (!active || moderatingIds.has(m.message_id)) return;
    const id = active.conversation_id;
    setModeratingIds((s) => new Set(s).add(m.message_id));
    try {
      await run();
      await refetchThread(id);
      // Keep the list's flagged badge in step with the thread we just changed.
      loadList();
    } catch (e) {
      setThreadError(errorMessage(e, "Moderation action failed."));
    } finally {
      setModeratingIds((s) => { const n = new Set(s); n.delete(m.message_id); return n; });
    }
  };
  const handleRemove = (m: ChatMessageRow): void => void moderate(m, () => ChatApi.removeMessage(m.message_id));
  const handleFlag = (m: ChatMessageRow): void => void moderate(m, () => ChatApi.flagMessage(m.message_id));
  const handleUnflag = (m: ChatMessageRow): void => void moderate(m, () => ChatApi.unflagMessage(m.message_id));
  const toggleId = (id: string, set: typeof setMutedIds): void =>
    set((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const handleMute = (): void => { if (active) toggleId(active.conversation_id, setMutedIds); };
  const handleArchive = (): void => { if (active) toggleId(active.conversation_id, setArchivedIds); };

  /* ── Send as admin (real POST; then refetch thread) ── */
  const sendAdminMessage = async (): Promise<void> => {
    if (!active || !draft.trim() || sending || isArchived) return;
    const id = active.conversation_id;
    const text = draft.trim();
    setSending(true);
    try {
      await ChatApi.sendMessage(id, { message_id: crypto.randomUUID(), body: text, msg_type: "text" });
      setDraft("");
      setAssistOpen(false);
      setAssistIntent(null);
      const d = await ChatApi.conversation(id);
      setMessages(d.messages);
      setRows((prev) => prev.map((r) =>
        r.conversation_id === id
          ? { ...r, last_body: text, last_at: new Date().toISOString(), last_author: "You", last_type: "text" }
          : r,
      ));
    } catch (e) {
      setThreadError(errorMessage(e, "Could not send your reply."));
    } finally {
      setSending(false);
    }
  };

  /* ── Attachment upload (sign → Cloudinary multipart POST → send message) ── */
  const sendAttachment = async (file: File, kind: "image" | "file" | "voice"): Promise<void> => {
    if (!active || uploading || sending || isArchived) return;
    const id = active.conversation_id;
    const caption = draft.trim();
    const msgType: ChatMsgType =
      kind === "image"
        ? "image"
        : file.type.startsWith("audio/")
          ? "voice"
          : file.type.startsWith("video/")
            ? "video"
            : "file";
    if (kind === "image" && file.size > 10 * 1024 * 1024) {
      setThreadError("Image is larger than 10 MB. Please choose a smaller image.");
      return;
    }
    setUploading(true);
    setThreadError(null);
    try {
      const sign = await ChatApi.signAttachment({ content_type: file.type || "application/octet-stream", kind });
      const up = await uploadToCloudinary(sign, file);
      await ChatApi.sendMessage(id, {
        message_id: crypto.randomUUID(),
        msg_type: msgType,
        attachment_url: up.secure_url,
        attachment_meta: { public_id: up.public_id, bytes: up.bytes, name: file.name },
        ...(caption ? { body: caption } : {}),
      });
      setDraft("");
      const d = await ChatApi.conversation(id);
      setMessages(d.messages);
      setRows((prev) => prev.map((r) =>
        r.conversation_id === id
          ? { ...r, last_body: caption || file.name, last_at: new Date().toISOString(), last_author: "You", last_type: msgType }
          : r,
      ));
    } catch (e) {
      setThreadError(errorMessage(e, "Could not upload the attachment."));
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>, kind: "image" | "file"): void => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (file) void sendAttachment(file, kind);
  };

  /* ── Voice-note recording (MediaRecorder → webm → upload as msg_type voice) ── */
  const startRecording = async (): Promise<void> => {
    if (recording || isArchived) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "-");
        const file = new File([blob], `voice-note-${stamp}.webm`, { type: "audio/webm" });
        void sendAttachment(file, "voice");
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setThreadError("Microphone unavailable or permission denied.");
    }
  };
  const stopRecording = (): void => { recorderRef.current?.stop(); setRecording(false); };

  /* ── Create a public space (real POST; then reload + open it) ── */
  const handleCreateSpace = async (title: string, topic: string): Promise<void> => {
    const conversation_id = crypto.randomUUID();
    const res = await ChatApi.createSpace({ conversation_id, title, ...(topic ? { topic } : {}) });
    setCreateOpen(false);
    loadList();
    setActiveId(res.conversation_id);
    setView("conversations");
  };

  /* ── Start (or open) a DM with any registered member ── */
  const handleStartDm = async (userId: string): Promise<void> => {
    const { conversation_id } = await ChatApi.createDm(userId);
    setNewMsgOpen(false);
    loadList();
    setActiveId(conversation_id);
    setSegment("dm");
    setView("conversations");
  };

  /* ── Follow a public space from "Discover" ── */
  const handleJoinSpace = async (id: string): Promise<void> => {
    if (joiningId) return;
    setJoiningId(id);
    try {
      await ChatApi.joinSpace(id);
      loadList();
      setActiveId(id);
    } catch (e) {
      setListError(errorMessage(e, "Could not join the space."));
    } finally {
      setJoiningId(null);
    }
  };

  /* ── "Seen by" read receipts for one of my messages ── */
  const showReaders = async (m: ChatMessageRow): Promise<void> => {
    setReadersFor(m.message_id);
    setReaders(null);
    try {
      setReaders(await ChatApi.messageReaders(m.message_id));
    } catch {
      setReaders({ recipient_count: m.recipient_count ?? 0, read_count: m.read_count ?? 0, readers: [] });
    }
  };

  /* ── Hero stats (derived from the list; flagged from the server per-row count) ── */
  const totalFlagged = rows.reduce((s, c) => s + (c.flagged || 0), 0);
  const msgsToday = rows.reduce((s, c) => s + (c.last_at && Date.now() - ms(c.last_at) < DAY ? 1 : 0), 0);
  const unreadTotal = rows.reduce((s, c) => s + (c.unread || 0), 0);

  return (
    <div className="min-h-full" style={{ background: "var(--background)", minWidth: 0 }}>
      {/* Hero */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
          <span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Chat</span>
        </div>
        <div className="mt-5 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Messaging</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px, 4vw, 34px)", lineHeight: 1.05 }}>Chat</h1>
            <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 580, lineHeight: 1.5 }}>
              Oversee disciple, group and space conversations from the mobile app. Read threads, moderate flagged messages and reply when needed.
            </p>
          </div>
          {totalFlagged > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg px-3" style={{ height: 34, background: "rgba(220,38,38,0.16)", color: "#FCA5A5", fontSize: 12, fontWeight: 700, border: "1px solid rgba(220,38,38,0.3)" }}>
              <ShieldAlert size={13} /> {totalFlagged} flagged
            </span>
          )}
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          {[
            { emoji: "💬", label: "Conversations", value: String(rows.length), hint: `${convos.filter((c) => !archivedIds.has(c.conversation_id)).length} active`, tint: "rgba(79,157,247,0.18)" },
            { emoji: "✉️", label: "Active today", value: String(msgsToday), hint: "threads with activity", tint: "rgba(22,163,74,0.18)" },
            { emoji: "🔵", label: "Unread", value: String(unreadTotal), hint: "across all chats", tint: "rgba(245,199,126,0.2)" },
            { emoji: "🚩", label: "Flagged", value: String(totalFlagged), hint: "need moderation", tint: "rgba(220,38,38,0.2)" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "13px 15px" }}>
              <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: item.tint, fontSize: 19 }}>{item.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div className="flex items-baseline gap-1.5">
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1 }}>{item.value}</span>
                  <span style={{ fontSize: 10.5, color: "rgba(232,239,245,0.55)" }}>{item.hint}</span>
                </div>
                <div style={{ fontSize: 11, color: "rgba(232,239,245,0.6)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 3 }}>{item.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px clamp(16px, 4vw, 48px) 40px" }}>
        {listError && (
          <div className="rounded-xl mb-4" style={{ padding: "10px 14px", background: "#FEF2F2", border: "1px solid #F5C6C2", color: "#A8281F", fontSize: 13 }}>{listError}</div>
        )}

        {/* View switch */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
          <div className="flex items-center rounded-xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: 3 }}>
            {([["overview", "Overview", LayoutGrid], ["conversations", "Conversations", MessagesSquare]] as const).map(([key, label, Icon]) => {
              const on = view === key;
              return (
                <button key={key} onClick={() => setView(key)} className="flex items-center gap-2 rounded-lg transition-colors" style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 600, background: on ? "var(--nuru-navy)" : "transparent", color: on ? "#fff" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                  <Icon size={14} /> {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-lg px-3.5" style={{ height: 38, background: "#fff", color: "var(--nuru-navy)", fontSize: 12.5, fontWeight: 700, border: "1px solid var(--border)", cursor: "pointer" }}>
              <Hash size={14} /> New space
            </button>
            <button onClick={() => setNewMsgOpen(true)} className="flex items-center gap-2 rounded-lg px-3.5" style={{ height: 38, background: "var(--nuru-gold)", color: "#fff", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: "0 6px 18px rgba(200,155,60,0.32)" }}>
              <PenSquare size={14} /> New message
            </button>
          </div>
        </div>

        {view === "overview" && (
          <Overview
            rows={rows}
            loading={listLoading}
            flaggedCount={totalFlagged}
            onPick={(id) => { setActiveId(id); setView("conversations"); }}
          />
        )}

        {view === "conversations" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* ── Conversation list ── */}
            <aside className="lg:col-span-4 xl:col-span-4 rounded-2xl overflow-hidden flex flex-col" style={{ background: "#fff", border: "1px solid var(--border)", maxHeight: 660 }}>
              <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center gap-2 rounded-lg" style={{ height: 38, background: "var(--input-background)", padding: "0 12px", marginBottom: 10 }}>
                  <Search size={14} style={{ color: "var(--muted-foreground)" }} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13, border: "none" }} />
                </div>
                <div className="flex items-center rounded-xl" style={{ background: "var(--input-background)", padding: 3, gap: 2 }}>
                  {SEGMENTS.map((s) => {
                    const on = segment === s.key;
                    return (
                      <button key={s.key} onClick={() => setSegment(s.key)} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg transition-colors" style={{
                        padding: "7px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none",
                        background: on ? "var(--nuru-navy)" : "transparent",
                        color: on ? "#fff" : "var(--muted-foreground)",
                      }}>
                        {s.label}
                        <span className="inline-flex items-center justify-center rounded-full" style={{ minWidth: 17, height: 17, padding: "0 5px", fontSize: 10, fontWeight: 800, background: on ? "var(--nuru-gold)" : "var(--secondary)", color: on ? "#fff" : "var(--muted-foreground)" }}>{counts[s.key]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>
                {listLoading ? (
                  <div className="flex flex-col items-center justify-center text-center" style={{ padding: "48px 20px", color: "var(--muted-foreground)" }}>
                    <Loader2 size={22} className="animate-spin" style={{ marginBottom: 10 }} />
                    <span style={{ fontSize: 13 }}>Loading conversations…</span>
                  </div>
                ) : list.length === 0 && !(segment === "space" && discover.length > 0) ? (
                  <div className="flex flex-col items-center justify-center text-center" style={{ padding: "48px 20px", color: "var(--muted-foreground)" }}>
                    <MessagesSquare size={24} style={{ opacity: 0.4, marginBottom: 10 }} />
                    <span style={{ fontSize: 13 }}>
                      {segment === "dm" ? "No direct messages yet — start one with “New message”." : segment === "space" ? "No spaces yet — follow one below." : "No groups yet."}
                    </span>
                  </div>
                ) : (
                  <>
                    {list.map((c) => {
                      const isActive = active?.conversation_id === c.conversation_id;
                      const title = conversationTitle(c);
                      const isDm = c.kind === "dm";
                      return (
                        <button key={c.conversation_id} onClick={() => setActiveId(c.conversation_id)} className="w-full text-left transition-colors" style={{
                          padding: "12px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer",
                          background: isActive ? "rgba(200,155,60,0.08)" : "transparent",
                          borderLeft: "3px solid " + (isActive ? "var(--nuru-gold)" : "transparent"),
                        }}>
                          <div className="flex items-start gap-3">
                            <Avatar uri={isDm ? c.avatar_url : null} name={title} size={42} square={!isDm}
                              icon={c.kind === "group" ? <Users size={18} /> : c.kind === "space" ? <Hash size={18} /> : undefined} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="flex items-center gap-1.5">
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{title}</span>
                                {c.last_at && <span style={{ fontSize: 10.5, color: c.unread > 0 ? "var(--nuru-gold)" : "var(--muted-foreground)", fontWeight: c.unread > 0 ? 700 : 400, flexShrink: 0 }}>{chatTimeAgo(c.last_at)}</span>}
                              </div>
                              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {c.last_body ? `${c.last_author ? `${c.last_author}: ` : ""}${c.last_body}` : "No messages yet"}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1.5">
                                {c.category && <span className="rounded-full" style={{ padding: "1px 7px", fontSize: 9.5, fontWeight: 700, background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{c.category}</span>}
                                {!isDm && <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{c.member_count} {c.member_count === 1 ? "member" : "members"}</span>}
                                {mutedIds.has(c.conversation_id) && <VolumeX size={11} style={{ color: "var(--muted-foreground)" }} />}
                                {archivedIds.has(c.conversation_id) && <Archive size={11} style={{ color: "var(--muted-foreground)" }} />}
                                {c.unread > 0 && (
                                  <span className="ml-auto inline-flex items-center justify-center rounded-full" style={{ minWidth: 18, height: 18, padding: "0 5px", fontSize: 10, fontWeight: 800, background: "var(--nuru-gold)", color: "#fff" }}>
                                    {c.unread}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {/* Discover public spaces to follow (mobile parity). */}
                    {segment === "space" && discover.length > 0 && (
                      <div style={{ padding: "12px 14px 4px" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted-foreground)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Discover spaces</div>
                        {discover.map((s) => (
                          <div key={s.conversation_id} className="flex items-center gap-3" style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                            <Avatar name={s.title ?? "Space"} size={38} square icon={<Hash size={16} />} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title ?? "Space"}</div>
                              <div style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.topic || `${s.member_count} ${s.member_count === 1 ? "member" : "members"}`}</div>
                            </div>
                            <button onClick={() => void handleJoinSpace(s.conversation_id)} disabled={joiningId === s.conversation_id} className="rounded-lg px-3 shrink-0" style={{ height: 30, fontSize: 11.5, fontWeight: 700, border: "1px solid var(--nuru-gold)", background: "rgba(200,155,60,0.1)", color: "var(--nuru-gold)", cursor: "pointer" }}>
                              {joiningId === s.conversation_id ? "Following…" : "Follow"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </aside>

            {/* ── Thread detail ── */}
            <section className="lg:col-span-8 xl:col-span-8 rounded-2xl overflow-hidden flex flex-col" style={{ background: "#fff", border: "1px solid var(--border)", maxHeight: 660 }}>
              {!active ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center" style={{ padding: 48, color: "var(--muted-foreground)" }}>
                  <MessagesSquare size={28} style={{ opacity: 0.4, marginBottom: 12 }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--nuru-navy)" }}>Select a conversation</span>
                  <span style={{ fontSize: 12.5, marginTop: 2 }}>Pick a chat from the list to read and moderate it.</span>
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar uri={active.kind === "dm" ? active.avatar_url : null} name={conversationTitle(active)} size={42} square={active.kind !== "dm"}
                        icon={active.kind === "group" ? <Users size={18} /> : active.kind === "space" ? <Hash size={18} /> : undefined} />
                      <div style={{ minWidth: 0 }}>
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>{conversationTitle(active)}</span>
                          <span className="rounded-full" style={{ padding: "1px 8px", fontSize: 9.5, fontWeight: 700, background: typeMeta[active.type].bg, color: typeMeta[active.type].color, textTransform: "uppercase" }}>{typeMeta[active.type].label}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {active.topic || `${active.member_count} ${active.member_count === 1 ? "member" : "members"}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { setAiOpen((v) => !v); if (!summary) void loadSummary(); }} title="Nuru AI insights" className="flex items-center gap-1.5 rounded-lg px-2.5 transition-colors" style={{ height: 34, cursor: "pointer", border: "1px solid " + (aiOpen ? "rgba(124,58,237,0.4)" : "var(--border)"), background: aiOpen ? "#F0EBFA" : "#fff", color: aiOpen ? "#5B2BB8" : "var(--nuru-navy)", fontSize: 12, fontWeight: 700 }}>
                        <Sparkles size={14} /> Nuru
                      </button>
                      <ToolBtn onClick={handleMute} title={isMuted ? "Unmute" : "Mute"}>
                        {isMuted ? <Volume2 size={15} /> : <VolumeX size={15} />}
                      </ToolBtn>
                      <ToolBtn onClick={handleArchive} title={isArchived ? "Reopen" : "Archive"}>
                        {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                      </ToolBtn>
                    </div>
                  </div>

                  {/* Nuru summary panel — assistant module */}
                  {aiOpen && (
                    <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "linear-gradient(180deg, #FAF7FE, #fff)" }}>
                      <div className="flex items-center justify-between gap-2" style={{ marginBottom: 8 }}>
                        <div className="flex items-center gap-2">
                          <span className="flex items-center justify-center rounded-lg" style={{ width: 24, height: 24, background: "#5B2BB8", color: "#fff" }}><Sparkles size={13} /></span>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: "#5B2BB8", letterSpacing: "0.02em" }}>Nuru summary</span>
                        </div>
                        <button onClick={() => setAiOpen(false)} className="rounded-md p-1" style={{ color: "var(--muted-foreground)", border: "none", background: "none", cursor: "pointer" }}><X size={13} /></button>
                      </div>
                      {summaryBusy ? (
                        <p className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}><Loader2 size={12} className="animate-spin" /> Nuru is reading the thread…</p>
                      ) : summary ? (
                        <p style={{ fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.5 }}>{summary}</p>
                      ) : (
                        <button onClick={() => void loadSummary()} style={{ fontSize: 12, fontWeight: 700, color: "#5B2BB8", border: "none", background: "none", cursor: "pointer", padding: 0 }}>Summarise this conversation</button>
                      )}
                      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 10 }}>
                        <button onClick={() => { void runAssist("reply"); setAssistOpen(true); }} disabled={isArchived || assistBusy} className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: "#5B2BB8", color: "#fff", fontSize: 11.5, fontWeight: 700, border: "none", cursor: isArchived ? "not-allowed" : "pointer", opacity: isArchived ? 0.5 : 1 }}>
                          <Wand2 size={12} /> Draft a reply
                        </button>
                        <button onClick={() => { void runAssist("prayer"); setAssistOpen(true); }} disabled={isArchived || assistBusy} className="rounded-full px-3 py-1.5" style={{ background: "#F0EBFA", color: "#5B2BB8", fontSize: 11.5, fontWeight: 700, border: "none", cursor: isArchived ? "not-allowed" : "pointer", opacity: isArchived ? 0.5 : 1 }}>🙏 Offer a prayer</button>
                        <button onClick={() => { void runAssist("encourage"); setAssistOpen(true); }} disabled={isArchived || assistBusy} className="rounded-full px-3 py-1.5" style={{ background: "#F0EBFA", color: "#5B2BB8", fontSize: 11.5, fontWeight: 700, border: "none", cursor: isArchived ? "not-allowed" : "pointer", opacity: isArchived ? 0.5 : 1 }}>💛 Encourage</button>
                      </div>
                    </div>
                  )}

                  {/* Messages */}
                  <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ padding: "16px 18px", background: "var(--background)", scrollbarWidth: "thin", minHeight: 0 }}>
                    {threadError && (
                      <div className="rounded-lg mb-3" style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #F5C6C2", color: "#A8281F", fontSize: 12 }}>{threadError}</div>
                    )}
                    {threadLoading ? (
                      <div className="flex items-center justify-center" style={{ padding: 40, color: "var(--muted-foreground)" }}>
                        <Loader2 size={20} className="animate-spin" />
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-center" style={{ padding: 40, color: "var(--muted-foreground)" }}>
                        <MessageSquare size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
                        <span style={{ fontSize: 13 }}>No messages yet.</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {messages.map((m) => {
                          const mine = m.mine;
                          const st = statusOf(m);
                          const removed = st === "removed";
                          const flagged = st === "flagged";
                          const tag = m.ai_tag;
                          // Read state for blue ticks (mine only): all-read → blue double-check.
                          const recip = m.recipient_count ?? 0;
                          const reads = m.read_count ?? 0;
                          const allRead = recip > 0 && reads >= recip;
                          const someRead = reads > 0 && !allRead;
                          // Navy bubble for my own messages (mobile parity); white text on navy.
                          const navy = mine && !removed && !flagged;
                          const txt = navy ? "#fff" : removed ? "var(--muted-foreground)" : "#1F2937";
                          const subTxt = navy ? "rgba(255,255,255,0.72)" : "var(--muted-foreground)";
                          return (
                            <div key={m.message_id} className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                              {!mine && <Avatar uri={m.author_avatar} name={m.author_name} size={28} />}
                              <div style={{ maxWidth: "78%" }}>
                                {!mine && (
                                  <div className="flex items-center gap-1.5" style={{ marginBottom: 3, marginLeft: 2 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-navy)" }}>{m.author_name}</span>
                                  </div>
                                )}
                                <div className="group relative" style={{
                                  padding: "9px 13px",
                                  borderRadius: 16,
                                  borderBottomRightRadius: mine ? 5 : 16,
                                  borderBottomLeftRadius: mine ? 16 : 5,
                                  background: removed ? "var(--input-background)" : flagged ? "#FEF2F2" : navy ? "var(--nuru-navy)" : "#fff",
                                  border: flagged ? "1px solid #F5C6C2" : navy ? "none" : "1px solid #E6E8EB",
                                  color: txt,
                                }}>
                                  {!removed && m.reply_body && (
                                    <div className="rounded-lg" style={{ marginBottom: 6, padding: "5px 8px", background: navy ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.04)", borderLeft: "2px solid var(--nuru-gold)" }}>
                                      <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: navy ? "#fff" : "var(--nuru-navy)" }}>{m.reply_author ?? "Reply"}</span>
                                      <span style={{ display: "block", fontSize: 11, color: subTxt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{m.reply_body}</span>
                                    </div>
                                  )}
                                  {!removed && m.attachment_url && <MessageAttachment m={m} />}
                                  {!removed && m.body && (
                                    <p style={{ fontSize: 13, lineHeight: 1.5, color: txt, whiteSpace: "pre-wrap", marginTop: m.attachment_url ? 6 : 0 }}>{m.body}</p>
                                  )}
                                  {removed && (
                                    <p style={{ fontSize: 13, lineHeight: 1.5, fontStyle: "italic", color: "var(--muted-foreground)" }}>This message was removed by a moderator.</p>
                                  )}
                                  {!removed && tag && (
                                    <span className="inline-flex items-center gap-1 rounded-full" style={{ marginTop: 6, padding: "1px 8px", fontSize: 9.5, fontWeight: 700, background: aiTagMeta[tag].bg, color: aiTagMeta[tag].color }}>
                                      <Sparkles size={9} /> {aiTagMeta[tag].emoji} {aiTagMeta[tag].label}
                                    </span>
                                  )}
                                  {flagged && (
                                    <div className="flex items-center gap-1" style={{ marginTop: 5, fontSize: 10.5, color: "#B91C1C", fontWeight: 600 }}>
                                      <AlertTriangle size={10} /> Flagged for review{m.flag_reason ? ` · ${m.flag_reason}` : ""}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-end gap-1" style={{ marginTop: 4, fontSize: 9.5, color: subTxt }}>
                                    <span>{chatClock(m.created_at)}</span>
                                    {mine && !removed && (
                                      <button onClick={() => void showReaders(m)} title={allRead ? "Read" : someRead ? `${reads} read` : "Sent"} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                                        {allRead ? <CheckCheck size={13} color="#3DA8E0" /> : someRead ? <CheckCheck size={13} color={subTxt} /> : <Check size={13} color={subTxt} />}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Moderation actions — server-authoritative (chat module) */}
                                {!removed && !mine && (() => {
                                  const busy = moderatingIds.has(m.message_id);
                                  const btn = (extra: object): object => ({ border: "none", background: "none", padding: 0, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1, ...extra });
                                  return (
                                    <div className="flex items-center gap-2" style={{ marginTop: 4, marginLeft: 2 }}>
                                      {flagged ? (
                                        <button onClick={() => handleUnflag(m)} disabled={busy} className="flex items-center gap-1" style={btn({ fontSize: 10.5, color: "#0F6B33", fontWeight: 700 })}>
                                          <Circle size={9} /> Dismiss flag
                                        </button>
                                      ) : (
                                        <button onClick={() => handleFlag(m)} disabled={busy} className="flex items-center gap-1" style={btn({ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 })}>
                                          <Flag size={10} /> Flag
                                        </button>
                                      )}
                                      <button onClick={() => handleRemove(m)} disabled={busy} className="flex items-center gap-1" style={btn({ fontSize: 10.5, color: "#DC2626", fontWeight: 700 })}>
                                        <Trash2 size={10} /> Remove
                                      </button>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Nuru composer assist */}
                  {assistOpen && !isArchived && (
                    <div style={{ padding: "10px 16px 0" }}>
                      <div className="rounded-xl" style={{ background: "#FAF7FE", border: "1px solid rgba(124,58,237,0.25)", padding: "10px 12px" }}>
                        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                          <span className="flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 800, color: "#5B2BB8" }}><Sparkles size={12} /> Nuru assist {assistBusy && <Loader2 size={11} className="animate-spin" />}</span>
                          <button onClick={() => { setAssistOpen(false); setAssistIntent(null); }} className="rounded-md p-1" style={{ color: "var(--muted-foreground)", border: "none", background: "none", cursor: "pointer" }}><X size={12} /></button>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {([["reply", "Help me reply"], ["encourage", "Encourage"], ["prayer", "Offer a prayer"]] as const).map(([intent, label]) => (
                            <button key={intent} onClick={() => void runAssist(intent)} disabled={assistBusy} className="rounded-full px-3 py-1.5" style={{ fontSize: 11.5, fontWeight: 700, cursor: assistBusy ? "wait" : "pointer", border: "1px solid " + (assistIntent === intent ? "#5B2BB8" : "rgba(124,58,237,0.3)"), background: assistIntent === intent ? "#5B2BB8" : "#fff", color: assistIntent === intent ? "#fff" : "#5B2BB8" }}>
                              {label}
                            </button>
                          ))}
                        </div>
                        {assistIntent && (
                          <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 8 }}>
                            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 }}>Tone:</span>
                            {([["default", "Default"], ["shorter", "Shorter"], ["warmer", "Warmer"], ["formal", "Formal"]] as const).map(([tone, label]) => (
                              <button key={tone} onClick={() => assistIntent && void runAssist(assistIntent, tone)} disabled={assistBusy} className="rounded-full px-2.5 py-1" style={{ fontSize: 10.5, fontWeight: 600, border: "1px solid var(--border)", background: "#fff", color: "var(--nuru-navy)", cursor: assistBusy ? "wait" : "pointer" }}>
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Uploading chip */}
                  {uploading && (
                    <div className="flex items-center gap-2 shrink-0" style={{ padding: "8px 16px 0" }}>
                      <span className="inline-flex items-center gap-1.5 rounded-full" style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 700, background: "#F0EBFA", color: "#5B2BB8", border: "1px solid rgba(124,58,237,0.25)" }}>
                        <Loader2 size={12} className="animate-spin" /> Uploading attachment…
                      </span>
                    </div>
                  )}

                  {/* Composer */}
                  <div className="flex items-end gap-2 shrink-0" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", background: "#fff" }}>
                    <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(e) => onPickFile(e, "image")} />
                    <input ref={fileInputRef} type="file" hidden onChange={(e) => onPickFile(e, "file")} />
                    <div className="flex items-center gap-1 shrink-0">
                      <CBtn onClick={() => imageInputRef.current?.click()} disabled={isArchived || uploading || sending} title="Attach image"><ImageIcon size={16} /></CBtn>
                      <CBtn onClick={() => fileInputRef.current?.click()} disabled={isArchived || uploading || sending} title="Attach file"><Paperclip size={16} /></CBtn>
                      <CBtn onClick={() => (recording ? stopRecording() : void startRecording())} disabled={isArchived || uploading || sending} title={recording ? "Stop recording" : "Record voice note"} active={recording} accent="#DC2626">
                        {recording ? <Square size={15} /> : <Mic size={16} />}
                      </CBtn>
                      <CBtn onClick={() => setAssistOpen((v) => !v)} disabled={isArchived} title="Nuru assist" active={assistOpen} accent="#5B2BB8"><Sparkles size={16} /></CBtn>
                    </div>
                    <textarea
                      ref={taRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendAdminMessage(); } }}
                      rows={1}
                      placeholder={isArchived ? "Conversation archived — reopen to reply" : "Reply as admin, or ask Nuru to draft…  (Shift+Enter for a new line)"}
                      disabled={isArchived || sending || uploading}
                      className="flex-1 rounded-lg outline-none resize-none block"
                      style={{ minHeight: 40, maxHeight: 140, padding: "9px 12px", background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, lineHeight: 1.45, color: "var(--foreground)", opacity: isArchived ? 0.5 : 1, overflowY: "auto" }}
                    />
                    {(() => {
                      const canSend = draft.trim().length > 0 && !isArchived && !sending && !uploading;
                      return (
                        <button onClick={() => void sendAdminMessage()} disabled={!canSend} className="flex items-center justify-center rounded-lg shrink-0 transition-opacity hover:opacity-90" style={{ width: 40, height: 40, background: "var(--nuru-gold)", color: "#fff", border: "none", opacity: canSend ? 1 : 0.5, cursor: canSend ? "pointer" : "not-allowed" }}>
                          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                      );
                    })()}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>

      {createOpen && <CreateSpaceModal onClose={() => setCreateOpen(false)} onCreate={handleCreateSpace} />}
      {newMsgOpen && <NewMessageModal onClose={() => setNewMsgOpen(false)} onPick={handleStartDm} />}
      {readersFor && <SeenByPopover data={readers} onClose={() => { setReadersFor(null); setReaders(null); }} />}
    </div>
  );
}

/* ────── Create a public space ────── */
function CreateSpaceModal({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, topic: string) => Promise<void> }): ReactElement {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (name.trim().length < 3) { setError("Give the space a name (at least 3 characters)."); return; }
    setBusy(true);
    setError("");
    try {
      await onCreate(name.trim(), topic.trim());
    } catch {
      setBusy(false);
      setError("Could not create the space. Please try again.");
    }
  };

  const field: React.CSSProperties = { width: "100%", height: 40, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", padding: "0 12px", fontSize: 13, color: "var(--foreground)", outline: "none" };
  const labelSt: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6, display: "block" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "#fff", maxWidth: 540, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)" }}><Globe size={19} /></span>
            <div>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "var(--nuru-navy)", lineHeight: 1.1 }}>Create a space</h2>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>A public, joinable channel in the mobile-app chat.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>

        <div style={{ padding: "20px 22px" }}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Space name <span style={{ color: "#DC2626" }}>*</span></label>
            <div className="relative flex items-center">
              <Hash size={15} style={{ position: "absolute", left: 12, color: "var(--muted-foreground)" }} />
              <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Citywide Prayer Wall" style={{ ...field, paddingLeft: 36, borderColor: error ? "#DC2626" : "var(--border)" }} />
            </div>
            {error && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{error}</p>}
          </div>

          <div>
            <label style={labelSt}>Topic <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>(optional)</span></label>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What is this space for?" style={field} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2" style={{ padding: "16px 22px", borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create space
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────── New message — DM directory (every registered member is reachable) ────── */
function NewMessageModal({ onClose, onPick }: { onClose: () => void; onPick: (userId: string) => Promise<void> }): ReactElement {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      ChatApi.people(q.trim() || undefined)
        .then((p) => { if (alive) { setPeople(p); setError(null); } })
        .catch((e) => { if (alive) setError(errorMessage(e, "Could not load the directory.")); })
        .finally(() => { if (alive) setLoading(false); });
    }, 220); // debounce the search
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const pick = async (id: string): Promise<void> => {
    setBusyId(id);
    try { await onPick(id); }
    catch (e) { setBusyId(null); setError(errorMessage(e, "Could not start the conversation.")); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "#fff", maxWidth: 520, maxHeight: "82vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)" }}><UserPlus size={19} /></span>
            <div>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "var(--nuru-navy)", lineHeight: 1.1 }}>New message</h2>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>Start a direct message with anyone registered.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>

        <div style={{ padding: "14px 22px 8px" }}>
          <div className="flex items-center gap-2 rounded-lg" style={{ height: 40, background: "var(--input-background)", padding: "0 12px" }}>
            <Search size={15} style={{ color: "var(--muted-foreground)" }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13, border: "none" }} />
          </div>
          {error && <p style={{ fontSize: 11.5, color: "#DC2626", marginTop: 8 }}>{error}</p>}
        </div>

        <div className="overflow-y-auto" style={{ padding: "4px 12px 16px", scrollbarWidth: "thin" }}>
          {loading ? (
            <div className="flex items-center justify-center" style={{ padding: 32, color: "var(--muted-foreground)" }}><Loader2 size={20} className="animate-spin" /></div>
          ) : people.length === 0 ? (
            <div className="text-center" style={{ padding: 28, color: "var(--muted-foreground)", fontSize: 13 }}>No one matches “{q}”.</div>
          ) : people.map((p) => (
            <button key={p.user_id} onClick={() => void pick(p.user_id)} disabled={busyId != null} className="w-full flex items-center gap-3 rounded-xl transition-colors hover:bg-[var(--secondary)] text-left" style={{ padding: "9px 10px", border: "none", background: "none", cursor: busyId ? "wait" : "pointer" }}>
              <Avatar uri={p.avatar_url} name={p.full_name} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.full_name}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{p.role}{p.congregation ? ` · ${p.congregation}` : ""}</div>
              </div>
              {busyId === p.user_id ? <Loader2 size={15} className="animate-spin" style={{ color: "var(--nuru-gold)" }} /> : <Send size={14} style={{ color: "var(--muted-foreground)" }} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────── "Seen by" — read receipts for one of my messages ────── */
function SeenByPopover({ data, onClose }: { data: ChatReaders | null; onClose: () => void }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.5)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "#fff", maxWidth: 380, maxHeight: "70vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 800, color: "var(--nuru-navy)" }}>
            <Eye size={15} style={{ color: "#3DA8E0" }} /> Seen by{data ? ` · ${data.read_count} of ${data.recipient_count}` : ""}
          </span>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ background: "var(--secondary)", border: "none", cursor: "pointer", color: "var(--foreground)" }}><X size={14} /></button>
        </div>
        <div className="overflow-y-auto" style={{ padding: "8px 12px 14px", scrollbarWidth: "thin" }}>
          {!data ? (
            <div className="flex items-center justify-center" style={{ padding: 28, color: "var(--muted-foreground)" }}><Loader2 size={18} className="animate-spin" /></div>
          ) : data.readers.length === 0 ? (
            <div className="text-center" style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 12.5 }}>No one has read this yet.</div>
          ) : data.readers.map((r) => (
            <div key={r.user_id} className="flex items-center gap-3" style={{ padding: "7px 8px" }}>
              <Avatar uri={r.avatar_url} name={r.full_name} size={32} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{r.full_name}</span>
              <span className="flex items-center gap-1" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
                {r.read_at ? chatTimeAgo(r.read_at) : ""} <CheckCheck size={13} color="#3DA8E0" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Renders a message attachment by msg_type: image thumbnail, audio player, or download chip. */
function MessageAttachment({ m }: { m: ChatMessageRow }): ReactElement | null {
  const url = m.attachment_url;
  if (!url) return null;
  const meta = (m.attachment_meta ?? {}) as { name?: string; bytes?: number };
  const name = typeof meta.name === "string" && meta.name ? meta.name : "Attachment";
  if (m.msg_type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden" style={{ maxWidth: 240 }}>
        <img src={url} alt={name} style={{ display: "block", maxWidth: 240, maxHeight: 240, width: "auto", height: "auto", borderRadius: 10 }} />
      </a>
    );
  }
  if (m.msg_type === "voice") {
    return <audio controls src={url} style={{ maxWidth: 240, width: "100%" }} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg" style={{ padding: "7px 10px", background: "rgba(0,0,0,0.04)", border: "1px solid var(--border)", textDecoration: "none", maxWidth: 240 }}>
      <FileText size={15} style={{ color: "var(--nuru-navy)", flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
    </a>
  );
}

function ToolBtn({ children, onClick, title }: { children: ReactNode; onClick: () => void; title: string }): ReactElement {
  return (
    <button onClick={onClick} title={title} className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--secondary)]" style={{ width: 34, height: 34, border: "1px solid var(--border)", background: "#fff", color: "var(--nuru-navy)", cursor: "pointer" }}>
      {children}
    </button>
  );
}

function CBtn({ children, onClick, title, disabled, active, accent }: { children: ReactNode; onClick: () => void; title: string; disabled?: boolean; active?: boolean; accent?: string }): ReactElement {
  const color = accent ?? "var(--nuru-navy)";
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="flex items-center justify-center rounded-lg shrink-0 transition-colors hover:bg-[var(--secondary)]" style={{ width: 34, height: 40, border: "1px solid " + (active ? (accent ? accent + "66" : "var(--nuru-gold)") : "var(--border)"), background: active ? (accent ? accent + "14" : "var(--secondary)") : "#fff", color, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      {children}
    </button>
  );
}

/* ────── Overview / analytics ────── */
const HEALTH_ICON = { ongoing: Activity, silent: Moon, failed: WifiOff } as const;

function Overview({ rows, loading, flaggedCount, onPick }: { rows: ChatConversationRow[]; loading: boolean; flaggedCount: number; onPick: (id: string) => void }): ReactElement {
  const totalMsg = rows.reduce((s, c) => s + (c.last_body ? 1 : 0), 0); // proxy: threads with content
  const unread = rows.reduce((s, c) => s + (c.unread || 0), 0);

  const health: Record<ChatHealth, number> = { ongoing: 0, silent: 0, failed: 0 };
  rows.forEach((c) => { health[rowHealth(c)] += 1; });

  const types: Record<ChatType, number> = { direct: 0, group: 0, support: 0, space: 0 };
  rows.forEach((c) => { types[typeOf(c.kind)] += 1; });

  const perDay = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startMs = start.getTime() - 6 * DAY;
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() - (6 - i) * DAY);
      return { day: d.toLocaleDateString([], { weekday: "short" }), count: 0 };
    });
    rows.forEach((c) => {
      const at = ms(c.last_at);
      if (at >= startMs) {
        const idx = Math.floor((at - startMs) / DAY);
        if (idx >= 0 && idx < 7 && buckets[idx]) buckets[idx].count += 1;
      }
    });
    return buckets;
  }, [rows]);

  const healthPie = [
    { name: "Ongoing", key: "ongoing" as const, value: health.ongoing, color: healthMeta.ongoing.color },
    { name: "Silent", key: "silent" as const, value: health.silent, color: healthMeta.silent.color },
    { name: "Failed", key: "failed" as const, value: health.failed, color: healthMeta.failed.color },
  ];
  const typeRows = (Object.keys(types) as ChatType[]).map((t) => ({ type: t, label: typeMeta[t].label, value: types[t], color: typeMeta[t].color }));

  const cards = [
    { label: "Active threads", value: totalMsg, sub: "with recent content", Icon: MessageSquare, tint: "#EEF1F8", tone: "#1F3A6B" },
    { label: "Ongoing", value: health.ongoing, sub: "active in last 3 days", Icon: Activity, tint: "#E8F6EE", tone: "#0F6B33" },
    { label: "Silent", value: health.silent, sub: "no recent activity", Icon: Moon, tint: "#EEF1F8", tone: "#475569" },
    { label: "Flagged", value: flaggedCount, sub: "awaiting moderation", Icon: Flag, tint: "#FDECEC", tone: "#A8281F" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: 60, color: "var(--muted-foreground)" }}>
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((k) => {
          const Icon = k.Icon;
          return (
            <div key={k.label} className="rounded-2xl flex items-center gap-3" style={{ background: "#fff", border: "1px solid var(--border)", padding: "16px 18px" }}>
              <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 42, height: 42, background: k.tint, color: k.tone }}>
                <Icon size={19} />
              </div>
              <div className="min-w-0">
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{k.label}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", lineHeight: 1.1 }}>{k.value}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 1 }}>{k.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Pie — conversation health */}
        <div className="lg:col-span-2 rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "18px 20px" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Conversation health</h3>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{rows.length} chats</span>
          </div>
          <div style={{ position: "relative", height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={healthPie} dataKey="value" innerRadius={55} outerRadius={82} paddingAngle={2} stroke="none">
                  {healthPie.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [`${v} chats`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--nuru-navy)", lineHeight: 1 }}>{rows.length}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>Chats</div>
            </div>
          </div>
          <div className="flex flex-col gap-2 mt-2">
            {healthPie.map((d) => {
              const Icon = HEALTH_ICON[d.key];
              return (
                <div key={d.key} className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                  <span className="flex items-center gap-2" style={{ color: "var(--foreground)" }}>
                    <span className="rounded-full" style={{ width: 9, height: 9, background: d.color }} />
                    <Icon size={13} style={{ color: d.color }} /> {d.name}
                  </span>
                  <span style={{ fontWeight: 700, color: "var(--nuru-navy)" }}>{d.value}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bar — messages this week */}
        <div className="lg:col-span-3 rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "18px 20px" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Activity this week</h3>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{unread} unread</span>
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perDay} barCategoryGap={10}>
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} threads`, "Active"]} cursor={{ fill: "rgba(200,155,60,0.08)" }} />
                <Bar dataKey="count" fill="#C89B3C" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Type breakdown */}
          <div className="mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>By type</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {typeRows.map((r) => (
                <div key={r.type} className="rounded-lg" style={{ background: typeMeta[r.type].bg, padding: "8px 10px" }}>
                  <div style={{ fontSize: 18, fontFamily: "var(--font-display)", color: r.color, lineHeight: 1.1 }}>{r.value}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: r.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{r.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Needs attention — silent or flagged threads */}
      {(() => {
        const needs = rows.filter((c) => rowHealth(c) !== "ongoing");
        if (needs.length === 0) return null;
        return (
          <div className="rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)", marginBottom: 10 }}>Needs attention</h3>
            <div className="flex flex-col gap-2">
              {needs.map((c) => {
                const h = rowHealth(c);
                return (
                  <button key={c.conversation_id} onClick={() => onPick(c.conversation_id)} className="flex items-center justify-between gap-3 rounded-xl transition-colors hover:bg-gray-50" style={{ padding: "10px 12px", border: "1px solid var(--border)", background: "#fff", cursor: "pointer" }}>
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="rounded-full" style={{ width: 8, height: 8, background: healthMeta[h].color }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{conversationTitle(c)}</span>
                      <span className="rounded-full shrink-0" style={{ padding: "1px 7px", fontSize: 9.5, fontWeight: 700, background: typeMeta[typeOf(c.kind)].bg, color: typeMeta[typeOf(c.kind)].color, textTransform: "uppercase" }}>{typeMeta[typeOf(c.kind)].label}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span style={{ fontSize: 11, fontWeight: 700, color: healthMeta[h].color }}>{healthMeta[h].label}</span>
                      <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
