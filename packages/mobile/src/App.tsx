// Root component (spec §1.3). Renders from local state on launch, then reconciles
// in the background — the user never stares at a spinner because a tower dropped.
// On a real device, swap the keychain vault in here (setVault(new KeychainTokenVault()))
// before installAuth — kept in-memory by default so this stays import-safe in tests.
import { useEffect, type ReactElement } from "react";
import { AppState, NativeModules, Platform, View } from "react-native";
import { Provider } from "react-redux";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { OfflineBanner } from "./components/OfflineBanner";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { store } from "./store/store";
import { RootNavigator } from "./navigation/RootNavigator";
import { configureApiBase, installAuth } from "./api/client";
import { apiBaseUrl } from "./config";
import { getVault } from "./auth/vault";
import { setLocalStore } from "./db/localStoreProvider";
import { AsyncStorageLocalStore } from "./db/asyncStorageLocalStore";
import type { KeyValueStore } from "./db/keyValueStore";
import { EncryptedKeyValueStore } from "./db/encryptedKeyValueStore";
import { createKeychainCipher } from "./db/keychainCipher";
import { getSyncEngine } from "./sync/engineProvider";
import { getConnectivity, setConnectivity } from "./net/connectivity";
import { NetInfoConnectivity, onReconnect } from "./net/netInfoConnectivity";
import { startSyncLifecycle } from "./sync/syncLifecycle";

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
  useEffect(() => {
    // env override → Metro host (real device LAN IP) → platform default.
    configureApiBase(apiBaseUrl(Platform.OS, metroDevHost()));
    setConnectivity(new NetInfoConnectivity()); // real online/offline detection
    installAuth(getVault()); // attach Bearer + 401-refresh-retry against the vault

    let cancelled = false;
    let stopSync = (): void => {};
    let stopReconnect = (): void => {};

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
    };
  }, []);

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        {/* Thin offline bar sits above the navigator (uses the top safe-area inset
            so it clears the notch) and the navigator fills the rest. */}
        <SafeAreaView edges={["top"]} style={{ flex: 0 }}>
          <OfflineBanner />
        </SafeAreaView>
        <View style={{ flex: 1 }}>
          <RootNavigator />
        </View>
      </SafeAreaProvider>
    </Provider>
  );
}
