// Home (spec §1.3). Renders the cached level/module list from the local store on
// launch, then a background sync reconciles — no spinner on a dropped tower.
import { useEffect, useState, type ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";
import { InMemoryLocalStore } from "../db/inMemoryLocalStore";
import type { SyncRow } from "../db/localStore";

// In a full build this comes from the app-wide store/sync provider; kept local
// here so the screen renders standalone.
const store = new InMemoryLocalStore();

export function HomeScreen(): ReactElement {
  const nav = useNavigation();
  const [modules, setModules] = useState<SyncRow[]>([]);

  useEffect(() => {
    void store.cacheList("modules").then(setModules);
  }, []);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: "600" }}>Your pathway</Text>
        <Pressable accessibilityRole="button" onPress={() => nav.navigate({ name: "Giving" })}>
          <Text style={{ color: "#2563eb" }}>Give</Text>
        </Pressable>
      </View>
      <FlatList
        data={modules}
        keyExtractor={(m) => String(m.module_id)}
        ListEmptyComponent={<Text style={{ color: "#6b7280" }}>No modules cached yet — pull to sync.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate({ name: "Module", moduleId: String(item.module_id) })}
            style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: "#e5e7eb" }}
          >
            <Text style={{ fontSize: 16 }}>{String(item.title ?? "Module")}</Text>
            {item.locked ? <Text style={{ color: "#9ca3af" }}>Locked</Text> : null}
          </Pressable>
        )}
      />
    </View>
  );
}
