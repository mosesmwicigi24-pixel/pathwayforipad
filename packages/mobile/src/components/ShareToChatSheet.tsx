// Share-to-chat sheet (X/Twitter style). Pick a space, group, or person and the
// video is posted into that conversation as a video message; we then deep-link
// straight to the chat thread. People resolve to a DM (created on demand).
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { Hash, Megaphone, Search, Send, Users, X } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing } from "../theme/tokens";
import { T } from "../theme/components";
import { NuruApi } from "../api/client";
import { errorMessage, refreshQueries } from "../api/query";
import { queryKeys } from "../api/hooks";
import { getConnectivity } from "../net/connectivity";
import { uuidv4 } from "../util/uuid";
import type { ChatConversation, ChatPerson } from "../api/types";

export function ShareToChatSheet({
  videoUrl,
  caption,
  text,
  onClose,
}: {
  videoUrl?: string; // share a video attachment …
  caption?: string | null;
  text?: string; // … or plain text (e.g. the verse of the day)
  onClose: () => void;
}): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([NuruApi.chatInbox(), NuruApi.chatPeople()])
      .then(([inbox, ppl]) => {
        if (!live) return;
        setConversations(inbox.conversations);
        setPeople(ppl.people);
      })
      .catch((e) => live && setErr(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const needle = q.trim().toLowerCase();
  const convs = useMemo(
    () => conversations.filter((c) => !needle || (c.title ?? c.topic ?? "").toLowerCase().includes(needle)),
    [conversations, needle],
  );
  const ppl = useMemo(
    () => people.filter((p) => !needle || p.full_name.toLowerCase().includes(needle)),
    [people, needle],
  );

  async function post(conversationId: string, title?: string | null): Promise<void> {
    if (!(await getConnectivity().isOnline())) { setErr("You're offline — sharing needs a connection."); return; }
    const message = videoUrl
      ? {
          message_id: uuidv4(),
          body: caption?.trim() || "📺 Shared a video",
          msg_type: "video" as const,
          attachment_url: videoUrl,
          attachment_meta: { kind: "welcome_video" },
          client_mutation_id: uuidv4(),
        }
      : {
          message_id: uuidv4(),
          body: (text ?? caption ?? "").trim() || "Shared a verse",
          msg_type: "text" as const,
          client_mutation_id: uuidv4(),
        };
    await NuruApi.sendChatMessage(conversationId, message);
    refreshQueries(queryKeys.chatInbox);
    refreshQueries(queryKeys.chatConvo(conversationId));
    onClose();
    nav.navigate("ChatThread", { conversationId, ...(title ? { title } : {}) });
  }

  async function shareToConversation(c: ChatConversation): Promise<void> {
    setBusy(c.conversation_id); setErr(null);
    try { await post(c.conversation_id, c.title ?? c.topic ?? undefined); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(null); }
  }
  async function shareToPerson(p: ChatPerson): Promise<void> {
    setBusy(p.user_id); setErr(null);
    try {
      if (!(await getConnectivity().isOnline())) { setErr("You're offline — sharing needs a connection."); return; }
      const { conversation_id } = await NuruApi.createDm(p.user_id);
      await post(conversation_id, p.full_name);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(null); }
  }

  const kindIcon = (k: ChatConversation["kind"]): ReactElement =>
    k === "space" ? <Hash size={16} color={palette.navy} /> : k === "group" ? <Users size={16} color={palette.navy} /> : <Megaphone size={16} color={palette.navy} />;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,31,51,0.5)" }}>
        <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "82%", paddingBottom: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.base }}>
            <T variant="heading" style={{ flex: 1, fontSize: 18 }}>Share to chat</T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}><X size={22} color={palette.ink} /></Pressable>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.base, paddingHorizontal: spacing.md, height: 42, borderRadius: radii.button, backgroundColor: palette.mutedBg }}>
            <Search size={16} color={palette.ink400} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search spaces, groups, people"
              placeholderTextColor={palette.ink400}
              style={{ flex: 1, color: palette.ink, fontSize: 14 }}
            />
          </View>

          {err ? <T variant="caption" style={{ color: "#DC2626", marginHorizontal: spacing.base, marginTop: spacing.sm }}>{err}</T> : null}

          {loading ? (
            <View style={{ padding: spacing.xl, alignItems: "center" }}><ActivityIndicator color={palette.gold} /></View>
          ) : (
            <ScrollView style={{ marginTop: spacing.sm }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
              {convs.length > 0 ? <T variant="micro" tone="tertiary" style={{ marginHorizontal: spacing.base, marginTop: spacing.sm, letterSpacing: 1 }}>YOUR CHATS</T> : null}
              {convs.map((c) => (
                <Pressable key={c.conversation_id} disabled={!!busy} onPress={() => void shareToConversation(c)} style={st.row}>
                  <View style={st.avatar}>{kindIcon(c.kind)}</View>
                  <View style={{ flex: 1 }}>
                    <T variant="body" numberOfLines={1}>{c.title ?? c.topic ?? "Conversation"}</T>
                    <T variant="micro" tone="tertiary">{c.kind === "dm" ? "Direct message" : `${c.member_count} members`}</T>
                  </View>
                  {busy === c.conversation_id ? <ActivityIndicator color={palette.gold} /> : <Send size={16} color={palette.gold} />}
                </Pressable>
              ))}

              {ppl.length > 0 ? <T variant="micro" tone="tertiary" style={{ marginHorizontal: spacing.base, marginTop: spacing.md, letterSpacing: 1 }}>PEOPLE</T> : null}
              {ppl.map((p) => (
                <Pressable key={p.user_id} disabled={!!busy} onPress={() => void shareToPerson(p)} style={st.row}>
                  <View style={[st.avatar, { backgroundColor: palette.gold }]}>
                    <T variant="caption" style={{ color: "#fff", fontWeight: "700" }}>{p.full_name.trim().charAt(0).toUpperCase()}</T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T variant="body" numberOfLines={1}>{p.full_name}</T>
                    <T variant="micro" tone="tertiary">{p.role}</T>
                  </View>
                  {busy === p.user_id ? <ActivityIndicator color={palette.gold} /> : <Send size={16} color={palette.gold} />}
                </Pressable>
              ))}

              {convs.length === 0 && ppl.length === 0 ? (
                <T variant="caption" tone="tertiary" style={{ textAlign: "center", padding: spacing.xl }}>No chats or people match.</T>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = {
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: palette.mutedBg,
  },
};
