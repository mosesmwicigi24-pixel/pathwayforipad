// App-wide TokenVault singleton. Defaults to in-memory; the device entrypoint swaps
// in KeychainTokenVault via setVault() before installAuth().
import { InMemoryTokenVault, type TokenVault } from "./tokenVault";

let current: TokenVault = new InMemoryTokenVault();

export function getVault(): TokenVault {
  return current;
}
export function setVault(vault: TokenVault): void {
  current = vault;
}
