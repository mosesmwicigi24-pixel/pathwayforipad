// NetInfo-backed connectivity (spec §1.7) — the real device implementation of the
// ConnectivityPort. Plugged in via setConnectivity() on device; tests keep the
// ManualConnectivity default. `onReconnect` lets the app kick a sync the moment a
// connection returns (queued writes replay immediately, not just on next foreground).
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { ConnectivityPort } from "./connectivity.js";

function reachable(s: NetInfoState): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

export class NetInfoConnectivity implements ConnectivityPort {
  async isOnline(): Promise<boolean> {
    return reachable(await NetInfo.fetch());
  }
}

/** Subscribe to connectivity regained (offline→online). Returns an unsubscribe. */
export function onReconnect(handler: () => void): () => void {
  let wasOnline = true;
  return NetInfo.addEventListener((s) => {
    const online = reachable(s);
    if (online && !wasOnline) handler();
    wasOnline = online;
  });
}
