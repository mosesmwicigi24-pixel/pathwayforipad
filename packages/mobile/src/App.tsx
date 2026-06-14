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
import { getSyncEngine } from "./sync/engineProvider";
import { getConnectivity } from "./net/connectivity";
import { startSyncLifecycle } from "./sync/syncLifecycle";

export function App(): ReactElement {
  useEffect(() => {
    configureApiBase(apiBaseUrl(Platform.OS)); // env override → platform default (Android 10.0.2.2)
    setLocalStore(new AsyncStorageLocalStore(AsyncStorage)); // durable offline queue + cache
    installAuth(getVault()); // attach Bearer + 401-refresh-retry against the vault
    // Reconcile on startup and whenever the app returns to the foreground.
    const stopSync = startSyncLifecycle({
      engine: getSyncEngine(),
      connectivity: getConnectivity(),
      appState: AppState,
    });
    return () => stopSync();
  }, []);

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    </Provider>
  );
}
