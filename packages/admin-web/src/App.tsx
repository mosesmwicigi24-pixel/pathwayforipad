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
import { ReviewQueue } from "./components/ReviewQueue";
import { CurriculumAdmin } from "./components/curriculum/CurriculumAdmin";
import { VideoLibrary } from "./components/curriculum/VideoLibrary";
import { colors, card, font } from "./theme";

const TITLES: Record<ScreenId, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.id, i.label])),
) as Record<ScreenId, string>;

function ComingSoon(props: { label: string; phase: string }): ReactElement {
  return (
    <div style={{ ...card, maxWidth: 560 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: font.size.lg }}>{props.label}</h2>
      <p style={{ color: colors.textMuted, fontSize: font.size.base, margin: 0 }}>
        This screen ships in build phase {props.phase} of the design contract matrix. The backend API for it is
        already live.
      </p>
    </div>
  );
}

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
        return <ReviewQueue />;
      case "members":
        return <ComingSoon label="Members" phase="W3" />;
      case "attendance":
        return <ComingSoon label="Attendance" phase="W3" />;
      case "events":
        return <ComingSoon label="Events" phase="W3" />;
      case "announcements":
        return <ComingSoon label="Announcements" phase="W3" />;
      case "badges":
        return <ComingSoon label="Badges" phase="W4" />;
      case "certificates":
        return <ComingSoon label="Certificates" phase="W4" />;
      case "finance":
        return <ComingSoon label="Finance" phase="W4" />;
      case "audit":
        return <ComingSoon label="Audit Log" phase="W4" />;
    }
  })();

  return (
    <PortalShell active={active} onNavigate={setScreen} title={TITLES[active]}>
      {body}
    </PortalShell>
  );
}
