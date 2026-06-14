// Root component (spec §1.3). Renders from local state on launch, then reconciles
// in the background — the user never stares at a spinner because a tower dropped.
// On a real device, swap the keychain vault in here (setVault(new KeychainTokenVault()))
// before installAuth — kept in-memory by default so this stays import-safe in tests.
import { useEffect, type ReactElement } from "react";
import { AppState, Platform } from "react-native";
import { Provider } from "react-redux";
import { SafeAreaProvider } from "react-native-safe-area-context";
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

export function App(): ReactElement {
  useEffect(() => {
    configureApiBase(apiBaseUrl(Platform.OS)); // env override → platform default (Android 10.0.2.2)
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
        <RootNavigator />
      </SafeAreaProvider>
    </Provider>
  );
}
