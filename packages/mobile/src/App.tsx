// Root component (spec §1.3). Renders from local state on launch, then reconciles
// in the background — the user never stares at a spinner because a tower dropped.
// On a real device, swap the keychain vault in here (setVault(new KeychainTokenVault()))
// before installAuth — kept in-memory by default so this stays import-safe in tests.
import { useEffect, type ReactElement } from "react";
import { Provider } from "react-redux";
import { store } from "./store/store";
import { RootNavigator } from "./navigation/RootNavigator";
import { installAuth } from "./api/client";
import { getVault } from "./auth/vault";

export function App(): ReactElement {
  useEffect(() => {
    installAuth(getVault()); // attach Bearer + 401-refresh-retry against the vault
  }, []);

  return (
    <Provider store={store}>
      <RootNavigator initial={{ name: "Login" }} />
    </Provider>
  );
}
