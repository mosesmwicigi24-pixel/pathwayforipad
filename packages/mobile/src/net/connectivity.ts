// Connectivity port (spec §1.7) — injectable so the sync engine drains when online
// and queues when offline, and tests can flip state. A NetInfo-backed impl
// (@react-native-community/netinfo) plugs in on device; ManualConnectivity backs tests.
export interface ConnectivityPort {
  isOnline(): Promise<boolean>;
}

export class ManualConnectivity implements ConnectivityPort {
  constructor(private online = true) {}
  setOnline(value: boolean): void {
    this.online = value;
  }
  isOnline(): Promise<boolean> {
    return Promise.resolve(this.online);
  }
}

// App-wide connectivity singleton (swap a NetInfo-backed impl in on device).
let current: ConnectivityPort = new ManualConnectivity(true);
export function getConnectivity(): ConnectivityPort {
  return current;
}
export function setConnectivity(conn: ConnectivityPort): void {
  current = conn;
}

// Money is never queued offline (§5.6) — these domains are blocked from the
// offline mutation queue and the giving flow hard-blocks when offline.
export const MONEY_DOMAINS = new Set(["giving", "transactions", "financial", "purchase"]);

/** Hard-block the giving flow when offline (§5.6). Throws if there's no connection. */
export async function assertOnlineForGiving(conn: ConnectivityPort): Promise<void> {
  if (!(await conn.isOnline())) {
    throw new Error("Giving requires a connection — financial intent is never queued offline (§5.6).");
  }
}
