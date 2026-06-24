// Notification bell with a live unread COUNT badge. Tapping opens the
// Notification center, where each item marks itself read and deep-links to what
// it references. Shared so every screen's bell shows the same count.
import { type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { Bell } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useNotifications } from "../api/hooks";
import { palette } from "../theme/tokens";
import { T } from "../theme/components";

export function NotificationBell(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data } = useNotifications();
  const unread = data?.unread ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      onPress={() => nav.navigate("Notifications")}
      style={({ pressed }) => [s.btn, pressed && { transform: [{ scale: 0.95 }] }]}
    >
      <Bell size={20} color={palette.onNavy} strokeWidth={1.8} />
      {unread > 0 ? (
        <View style={s.badge}>
          <T variant="micro" style={{ color: palette.navy, fontWeight: "800", fontSize: 10 }}>{unread > 9 ? "9+" : String(unread)}</T>
        </View>
      ) : null}
    </Pressable>
  );
}

const s = {
  btn: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: palette.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
    borderWidth: 2, borderColor: palette.navy,
  },
} as const;
