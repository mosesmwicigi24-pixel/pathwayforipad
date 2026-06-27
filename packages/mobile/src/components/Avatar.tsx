// One avatar everywhere a person appears: shows the uploaded photo when present,
// else a deterministic colored circle with initials. Single source of truth so a
// member's profile photo (POST /me/avatar) shows consistently across the app.
import { type ReactElement } from "react";
import { Image, Text, View } from "react-native";
import { palette } from "../theme/tokens";
import { initials, avatarColor } from "../screens/chatInbox";
import { cdnImage } from "../util/cdnImage";

export function Avatar({
  uri,
  name,
  size = 40,
  ring,
}: {
  uri?: string | null | undefined;
  name?: string | null | undefined;
  size?: number;
  ring?: boolean;
}): ReactElement {
  const radius = size / 2;
  const border = ring ? { borderWidth: 2, borderColor: palette.gold } : null;
  if (uri) {
    return <Image source={{ uri: cdnImage(uri, { width: size, height: size }) }} style={[{ width: size, height: size, borderRadius: radius, backgroundColor: palette.tintBlue }, border]} resizeMode="cover" />;
  }
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: avatarColor(name ?? "?"), alignItems: "center", justifyContent: "center" }, border]}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: Math.round(size * 0.4) }}>{initials(name)}</Text>
    </View>
  );
}
