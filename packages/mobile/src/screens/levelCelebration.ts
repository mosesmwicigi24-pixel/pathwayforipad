// After a server-confirmed module completion, ask the (server-authoritative)
// pathway whether the module's level is now fully complete — the moment to show
// the certificate celebration (LevelCompleteScreen). The server owns level status
// (§1.1): a reflection-gated final module that's still pending review will NOT
// report "completed", so we only celebrate a genuinely finished level. Best-effort
// — any error just means no celebration this time.
import { NuruApi } from "../api/client";

export async function levelJustCompleted(levelNumber: number): Promise<boolean> {
  try {
    const pathway = await NuruApi.pathway();
    const lvl = pathway.levels.find((l) => l.level_number === levelNumber);
    return !!lvl && lvl.status === "completed";
  } catch {
    return false;
  }
}
