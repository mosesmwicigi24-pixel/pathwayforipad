// Event-wall compose page (a chat/comment-style upload under an event): pick a
// photo and add a caption, then post to the gathering's wall. The image uploads
// straight to Cloudinary via the member-accessible chat-attachment sign flow;
// the post is created with POST /events/:id/posts (idempotent client_mutation_id).
import { useState, type ReactElement } from "react";
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";
import { ArrowLeft, Camera, ImagePlus, Send, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { getConnectivity } from "../net/connectivity";
import { invalidateQueries, errorMessage } from "../api/query";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";

type Picked = { uri: string; type: string; name: string };

export function EventPostComposeScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { eventId, title } = useRoute<RouteProp<RootStackParamList, "EventPostCompose">>().params;
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kb = useKeyboardInset();

  async function pick(fromCamera: boolean): Promise<void> {
    setErr(null);
    try {
      const result = fromCamera
        ? await launchCamera({ mediaType: "photo", quality: 0.8, saveToPhotos: false })
        : await launchImageLibrary({ mediaType: "photo", quality: 0.8, selectionLimit: 1 });
      const a = result.assets?.[0];
      if (!a?.uri) return; // cancelled
      setPhoto({ uri: a.uri, type: a.type ?? "image/jpeg", name: a.fileName ?? `photo-${Date.now()}.jpg` });
    } catch {
      setErr("Couldn't open your photos.");
    }
  }

  async function post(): Promise<void> {
    const body = caption.trim();
    if (!body && !photo) return;
    if (!(await getConnectivity().isOnline())) {
      setErr("You're offline — posting a photo needs a connection.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let imageUrl: string | null = null;
      if (photo) {
        const sign = await NuruApi.signChatAttachment({ content_type: photo.type, kind: "image" });
        const up = await NuruApi.uploadChatAttachment(sign, photo);
        imageUrl = up.secure_url;
      }
      await NuruApi.createEventPost(eventId, { post_id: uuidv4(), body: body || null, image_url: imageUrl, client_mutation_id: uuidv4() });
      invalidateQueries(`eventPosts:${eventId}`);
      nav.goBack();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canPost = !busy && (caption.trim().length > 0 || photo !== null);

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.backBtn}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="micro" tone="gold" style={{ letterSpacing: 1.4, fontWeight: "700" }}>SHARE A MOMENT</T>
          <T serif tone="onNavy" style={{ fontSize: 18 }} numberOfLines={1}>{title}</T>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Photo */}
        {photo ? (
          <View style={st.previewWrap}>
            <Image source={{ uri: photo.uri }} style={st.preview} resizeMode="cover" />
            <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setPhoto(null)} style={st.removeBtn}>
              <X size={16} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable accessibilityRole="button" onPress={() => void pick(false)} style={({ pressed }) => [st.pickTile, pressed && { opacity: 0.85 }]}>
              <ImagePlus size={22} color={palette.goldLo} />
              <T variant="caption" style={{ color: palette.ink600, fontWeight: "600", marginTop: 6 }}>Choose photo</T>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void pick(true)} style={({ pressed }) => [st.pickTile, pressed && { opacity: 0.85 }]}>
              <Camera size={22} color={palette.goldLo} />
              <T variant="caption" style={{ color: palette.ink600, fontWeight: "600", marginTop: 6 }}>Take photo</T>
            </Pressable>
          </View>
        )}

        {/* Caption */}
        <View style={[st.card, { marginTop: spacing.base }]}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Add a caption… what are you looking forward to?"
            placeholderTextColor={palette.ink400}
            multiline
            style={st.input}
          />
        </View>
        {err ? <T variant="caption" style={{ color: palette.error, marginTop: spacing.sm }}>{err}</T> : null}
      </ScrollView>

      <View style={[st.footer, { marginBottom: kb }]}>
        <Pressable accessibilityRole="button" onPress={() => void post()} disabled={!canPost} style={[st.postBtn, !canPost && { opacity: 0.5 }]}>
          <Send size={16} color="#fff" />
          <T variant="heading" style={{ color: "#fff" }}>{busy ? "Posting…" : "Post to the wall"}</T>
        </Pressable>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  pickTile: { flex: 1, height: 120, borderRadius: radii.card, borderWidth: 1.5, borderColor: palette.border, borderStyle: "dashed", backgroundColor: palette.white, alignItems: "center", justifyContent: "center" },
  previewWrap: { borderRadius: radii.card, overflow: "hidden", ...shadow.card },
  preview: { width: "100%", height: 260, backgroundColor: palette.mutedBg },
  removeBtn: { position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  input: { minHeight: 90, fontSize: 15, color: palette.ink, textAlignVertical: "top" },
  footer: { padding: spacing.base, backgroundColor: palette.white, borderTopWidth: 1, borderTopColor: palette.border },
  postBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radii.button, backgroundColor: palette.navyDeep },
} as const;
