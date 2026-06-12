// Nuru Place portal (Pulse design, Contract Matrix W1). Gated on a session,
// then the shell renders the active screen: Dashboard + Curriculum CMS for
// Admin/SuperAdmin; cohort + reflection queue for every leader. Screens not
// yet rebuilt (W2–W4) show a clearly-labelled placeholder so the nav is the
// real product structure from day one.
import { useState, type ReactElement } from "react";
import { useAppSelector } from "./store/hooks";
import { DevLogin } from "./components/DevLogin";
import { PortalShell } from "./components/shell/PortalShell";
import { canSee, defaultScreen, NAV_SECTIONS, type ScreenId } from "./components/shell/nav";
import { Dashboard } from "./components/dashboard/Dashboard";
import { CohortTable } from "./components/CohortTable";
import { CurriculumAdmin } from "./components/curriculum/CurriculumAdmin";
import { VideoLibrary } from "./components/curriculum/VideoLibrary";
import { Members } from "./components/ops/Members";
import { ReflectionQueue } from "./components/ops/ReflectionQueue";
import { Attendance } from "./components/ops/Attendance";
import { Events } from "./components/ops/Events";
import { Announcements } from "./components/ops/Announcements";
import { Badges } from "./components/ops/Badges";
import { Certificates } from "./components/ops/Certificates";
import { Finance } from "./components/ops/Finance";
import { AuditLog } from "./components/ops/AuditLog";
const TITLES: Record<ScreenId, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.id, i.label])),
) as Record<ScreenId, string>;

export function App(): ReactElement {
  const { accessToken, role } = useAppSelector((s) => s.auth);
  const [screen, setScreen] = useState<ScreenId | null>(null);

  if (!accessToken) return <DevLogin />;

  const active: ScreenId = screen && canSee(role, screen) ? screen : defaultScreen(role);

  const body = ((): ReactElement => {
    switch (active) {
      case "dashboard":
        return <Dashboard />;
      case "curriculum":
        return <CurriculumAdmin />;
      case "videos":
        return <VideoLibrary />;
      case "cohort":
        return <CohortTable />;
      case "reviews":
        return <ReflectionQueue />;
      case "members":
        return <Members />;
      case "attendance":
        return <Attendance />;
      case "events":
        return <Events />;
      case "announcements":
        return <Announcements />;
      case "badges":
        return <Badges />;
      case "certificates":
        return <Certificates />;
      case "finance":
        return <Finance />;
      case "audit":
        return <AuditLog />;
    }
  })();

  return (
    <PortalShell active={active} onNavigate={setScreen} title={TITLES[active]}>
      {body}
    </PortalShell>
  );
}
