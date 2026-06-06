// Chat (Figma "ChatTab"). The mentor conversation — a calm, WhatsApp-style thread
// with the assigned Level mentor. Messages sync offline (the queue is the system of
// record, §1.7); here the thread is presentational with a working composer. Level
// badges on bubbles reflect the sender's discipleship level.
import { useState, type ReactElement } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  CheckCheck,
  FileText,
  Gift,
  Headphones,
  Image as ImageIcon,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  Star,
  Video,
} from "lucide-react-native";
import { palette, radii, spacing } from "../theme/tokens";
import { T } from "../theme/components";

interface Message {
  id: number;
  from: "me" | "them";
  name?: string;
  level: string;
  text: string;
  time: string;
  read?: boolean;
}

const SEED: Message[] = [
  { id: 1, from: "them", name: "Pastor Daniel", level: "Level 6", text: "Good morning Moses. How is Level 2 going this week?", time: "8:42 AM" },
  { id: 2, from: "me", level: "Level 2", text: "Good morning Pastor. I finished the lesson on renewing the mind last night.", time: "8:44 AM", read: true },
  { id: 3, from: "them", name: "Pastor Daniel", level: "Level 6", text: "Excellent. Before the quiz, write down one scripture you will meditate on today.", time: "8:46 AM" },
  { id: 4, from: "me", level: "Level 2", text: "Romans 12:2. I saved it for offline reading too.", time: "8:49 AM", read: true },
  { id: 5, from: "them", name: "Pastor Daniel", level: "Level 6", text: "Beautiful. I am praying with you. Send a note after your quiz.", time: "8:51 AM" },
];

const ATTACH = [
  { label: "Images", Icon: ImageIcon },
  { label: "Files", Icon: FileText },
  { label: "GIF", Icon: Gift },
  { label: "Video", Icon: Video },
  { label: "Audio", Icon: Headphones },
] as const;

export function ChatScreen(): ReactElement {
  const [messages, setMessages] = useState<Message[]>(SEED);
  const [text, setText] = useState("");
  const [showAttach, setShowAttach] = useState(false);

  const send = (): void => {
    const body = text.trim();
    if (!body) return;
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    setMessages((prev) => [...prev, { id: prev.length + 1, from: "me", level: "Level 2", text: body, time, read: false }]);
    setText("");
  };

  return (
    <KeyboardAvoidingView style={st.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* Header */}
      <View style={st.header}>
        <View style={st.avatarWrap}>
          <View style={st.avatar}>
            <T variant="label" style={{ color: "#071F3B" }}>PD</T>
          </View>
          <View style={st.presence} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="heading" tone="onNavy" style={{ fontSize: 17 }}>Level 2 Mentor</T>
          <T variant="micro" style={{ color: "rgba(255,255,255,0.55)", marginTop: 1 }}>online · messages sync offline</T>
        </View>
        {[Phone, Search, MoreVertical].map((Icon, i) => (
          <Pressable key={i} style={st.headBtn}>
            <Icon size={19} color="rgba(255,255,255,0.70)" />
          </Pressable>
        ))}
      </View>

      {/* Thread */}
      <ScrollView style={st.thread} contentContainerStyle={st.threadInner} showsVerticalScrollIndicator={false}>
        <View style={st.dayChip}>
          <T variant="micro" tone="secondary">Today</T>
        </View>
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
      </ScrollView>

      {/* Composer */}
      <View style={st.composerWrap}>
        {showAttach ? (
          <View style={st.attachGrid}>
            {ATTACH.map(({ label, Icon }) => (
              <Pressable key={label} style={st.attachItem}>
                <Icon size={18} color={palette.navy} />
                <T variant="micro" tone="tertiary" style={{ marginTop: 4, fontSize: 9 }}>{label}</T>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={st.composer}>
          <View style={st.inputBox}>
            <Pressable onPress={() => setShowAttach((s) => !s)}>
              <Paperclip size={20} color={showAttach ? palette.navy : palette.ink600} />
            </Pressable>
            <Pressable onPress={() => setText((t) => `${t}😊`)}>
              <Smile size={20} color={palette.ink600} />
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={palette.ink600}
              multiline
              style={st.input}
            />
            <Mic size={20} color={palette.ink600} />
          </View>
          <Pressable onPress={send} style={({ pressed }) => [st.sendBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
            <Send size={18} color={palette.gold} fill={palette.gold} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: Message }): ReactElement {
  const mine = message.from === "me";
  return (
    <View style={[st.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
      <View style={[st.bubble, mine ? st.bubbleMine : st.bubbleThem]}>
        {!mine && message.name ? (
          <View style={st.bubbleHead}>
            <T variant="micro" tone="gold">{message.name}</T>
            <View style={st.levelChip}>
              <T variant="micro" style={{ color: palette.urgentText, fontSize: 9 }}>{message.level}</T>
              <Star size={8} color={palette.urgentText} fill={palette.urgentText} />
            </View>
          </View>
        ) : null}
        <T style={st.bubbleText}>{message.text}</T>
        <View style={st.bubbleMeta}>
          {mine ? (
            <View style={st.levelChipBare}>
              <T variant="micro" style={{ color: palette.goldLo, fontSize: 10 }}>{message.level}</T>
              <Star size={8} color={palette.goldLo} fill={palette.goldLo} />
            </View>
          ) : null}
          <T variant="micro" tone="secondary" style={{ fontSize: 10 }}>{message.time}</T>
          {mine ? <CheckCheck size={14} color="#4C8AD8" /> : null}
        </View>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.chatPaper },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.navy, paddingHorizontal: spacing.base, paddingTop: 52, paddingBottom: spacing.md },
  avatarWrap: { width: 44, height: 44 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.goldHi, alignItems: "center", justifyContent: "center" },
  presence: { position: "absolute", right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: palette.navy, backgroundColor: palette.online },
  headBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center" },
  thread: { flex: 1 },
  threadInner: { paddingHorizontal: spacing.base, paddingVertical: spacing.base, gap: spacing.sm },
  dayChip: { alignSelf: "center", backgroundColor: "rgba(255,255,255,0.70)", borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 4, marginBottom: spacing.sm },
  bubbleRow: { flexDirection: "row" },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: palette.myBubble, borderBottomRightRadius: 6 },
  bubbleThem: { backgroundColor: palette.white, borderBottomLeftRadius: 6 },
  bubbleHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  levelChip: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: palette.goldTint, borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 2 },
  levelChipBare: { flexDirection: "row", alignItems: "center", gap: 2 },
  bubbleText: { fontSize: 14.5, lineHeight: 20, color: palette.ink, letterSpacing: -0.1 },
  bubbleMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 },
  composerWrap: { borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)", backgroundColor: "rgba(247,243,234,0.95)", paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  attachGrid: { flexDirection: "row", gap: spacing.sm, backgroundColor: palette.white, borderRadius: 22, padding: spacing.sm, marginBottom: spacing.sm },
  attachItem: { flex: 1, alignItems: "center", backgroundColor: "rgba(10,37,64,0.04)", borderRadius: 16, paddingVertical: spacing.sm },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  inputBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, backgroundColor: palette.white, borderRadius: 22, paddingHorizontal: spacing.md },
  input: { flex: 1, maxHeight: 96, paddingVertical: 8, fontSize: 14, color: palette.ink },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
} as const;
