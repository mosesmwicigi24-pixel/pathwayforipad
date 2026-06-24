// Root component (spec §1.3). Renders from local state on launch, then reconciles
// in the background — the user never stares at a spinner because a tower dropped.
// On a real device, swap the keychain vault in here (setVault(new KeychainTokenVault()))
// before installAuth — kept in-memory by default so this stays import-safe in tests.
import { useEffect, useState, type ReactElement } from "react";
import { AppState, NativeModules, Platform, StatusBar, View } from "react-native";
import { Provider } from "react-redux";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { OfflineBanner } from "./components/OfflineBanner";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { store } from "./store/store";
import { RootNavigator } from "./navigation/RootNavigator";
import { configureApiBase, installAuth } from "./api/client";
import { apiBaseUrl } from "./config";
import { getVault, setVault } from "./auth/vault";
import { KeychainTokenVault } from "./auth/keychainTokenVault";
import { setLocalStore } from "./db/localStoreProvider";
import { AsyncStorageLocalStore } from "./db/asyncStorageLocalStore";
import type { KeyValueStore } from "./db/keyValueStore";
import { EncryptedKeyValueStore } from "./db/encryptedKeyValueStore";
import { createKeychainCipher } from "./db/keychainCipher";
import { getSyncEngine } from "./sync/engineProvider";
import { hydrateQueryCache } from "./api/query";
import { getConnectivity, setConnectivity } from "./net/connectivity";
import { NetInfoConnectivity, onReconnect } from "./net/netInfoConnectivity";
import { startSyncLifecycle } from "./sync/syncLifecycle";
import { startAnnouncementAlerts } from "./notifications/announcementAlerts";
import { AnnouncementToast } from "./components/AnnouncementToast";
import { palette } from "./theme/tokens";

// In dev, the JS bundle is served by Metro from the dev machine. Reuse that host
// for the API so a physical device reaches the backend on the same LAN address
// (a simulator/emulator yields localhost / 10.0.2.2, exactly the old defaults).
function metroDevHost(): string | undefined {
  const scriptURL = (NativeModules as { SourceCode?: { scriptURL?: string } }).SourceCode?.scriptURL;
  if (!scriptURL) return undefined;
  const match = /^[a-z]+:\/\/([^/:]+)/i.exec(scriptURL);
  return match?.[1];
}

export function App(): ReactElement {
  // Persistent login: decide the entry screen from the secure vault. A stored
  // token (kept across launches in the Keychain) resumes straight into the app;
  // the session ends only on explicit logout or a server-confirmed dead token
  // (handled in the API client). `null` = still reading the vault (brief splash).
  const [bootRoute, setBootRoute] = useState<"Login" | "Tabs" | null>(null);

  useEffect(() => {
    // Persist tokens in the OS secure enclave (§5.7) so login survives restarts —
    // MUST be installed before installAuth + the resume check below, or the app
    // falls back to the in-memory vault and forgets the session on every launch.
    setVault(new KeychainTokenVault());
    // env override → Metro host (real device LAN IP) → platform default.
    configureApiBase(apiBaseUrl(Platform.OS, metroDevHost()));
    setConnectivity(new NetInfoConnectivity()); // real online/offline detection
    installAuth(getVault()); // attach Bearer + 401-refresh-retry against the vault
    void hydrateQueryCache(); // restore last-known reads so screens show instantly + work offline (§1.7)

    void (async () => {
      const refresh = await getVault().getRefresh().catch(() => null);
      setBootRoute(refresh ? "Tabs" : "Login");
    })();

    let cancelled = false;
    let stopSync = (): void => {};
    let stopReconnect = (): void => {};
    // Announcement alerts: poll the feed while the app is alive and chime + buzz +
    // banner on anything new (no APNs needed under the current signing).
    const stopAlerts = startAnnouncementAlerts(AppState);

    // Encryption-at-rest (§5.7): seal the offline store under an AES-256 key in the
    // keychain. The cipher loads async, so the store + sync are wired only once it's
    // ready. If encryption is unavailable, fall back to plaintext so the app still
    // works offline (auth tokens stay in the keychain regardless).
    void (async () => {
      let kv: KeyValueStore = AsyncStorage;
      try {
        kv = new EncryptedKeyValueStore(AsyncStorage, await createKeychainCipher());
      } catch {
        kv = AsyncStorage;
      }
      if (cancelled) return;
      setLocalStore(new AsyncStorageLocalStore(kv)); // durable offline queue + cache
      // Reconcile on startup + on foreground, and the instant a connection returns.
      stopSync = startSyncLifecycle({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        appState: AppState,
      });
      stopReconnect = onReconnect(() => {
        void getSyncEngine().syncIfOnline(getConnectivity());
      });
    })();

    return () => {
      cancelled = true;
      stopSync();
      stopReconnect();
      stopAlerts();
    };
  }, []);

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        {/* Draw edge-to-edge (the app fills the whole screen, content behind the
            status bar) while keeping the system bars visible. The navy headers sit
            behind the status bar, so its icons (clock, wifi, battery) are light. */}
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        {/* The navigator fills the entire screen from the very top. */}
        <View style={{ flex: 1, backgroundColor: palette.coolPaper }}>
          {bootRoute ? <RootNavigator initialRoute={bootRoute} /> : null}
        </View>
        {/* Offline bar floats over the top (absolute, so it never reserves a strip
            that would push the header down); it clears the notch via the top inset
            and shows only when offline. */}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0 }} pointerEvents="box-none">
          <SafeAreaView edges={["top"]} pointerEvents="box-none">
            <OfflineBanner />
          </SafeAreaView>
        </View>
        {/* Heads-up banner for a freshly-arrived announcement (over everything). */}
        <AnnouncementToast />
      </SafeAreaProvider>
    </Provider>
  );
}
