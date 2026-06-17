// React hook over the NetInfo connectivity port (§1.7) — true while the device
// has no usable connection. Mirrors netInfoConnectivity's `reachable` rule so the
// banner and the sync engine agree on "online". If NetInfo can't be subscribed
// (e.g. an unusual host), we fail open (treat as online) so we never falsely warn.
import { useEffect, useState } from "react";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

function reachable(s: NetInfoState): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    try {
      return NetInfo.addEventListener((s) => setOffline(!reachable(s)));
    } catch {
      return undefined; // fail open — assume online
    }
  }, []);
  return offline;
}
