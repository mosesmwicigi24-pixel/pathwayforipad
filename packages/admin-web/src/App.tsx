// Nuru Pathway Web Portal — rebuilt to the Figma make (docs/WEB_PORTAL_DESIGN_SPEC.md).
// Gated on a session, then the navy shell renders the active screen. Screens are
// being rebuilt phase by phase (WP1–WP5); ones not yet rebuilt keep their working
// implementation, and brand-new screens show a clearly-labelled placeholder so the
// nav is the real product structure from day one.
import { useState, type ReactElement } from "react";
import { Hammer } from "lucide-react";
import { useAppSelector } from "./store/hooks";
import { DevLogin } from "./components/DevLogin";
import { PortalShell } from "./components/shell/PortalShell";
import { canSee, defaultScreen, SCREEN_TITLES, type ScreenId } from "./components/shell/nav";
import { Dashboard } from "./components/dashboard/Dashboard";
import { CohortTable } from "./components/CohortTable";
import { CurriculumAdmin } from "./components/curriculum/CurriculumAdmin";
import { CurriculumLevels } from "./components/curriculum/CurriculumLevels";
import { VideoLibrary } from "./components/curriculum/VideoLibrary";
import { GrowthContent } from "./components/curriculum/GrowthContent";
import { LevelDetail } from "./components/curriculum/LevelDetail";
import { Members } from "./components/ops/Members";
import { CohortEngagement } from "./components/ops/CohortEngagement";
import { ReflectionQueue } from "./components/ops/ReflectionQueue";
import { Attendance } from "./components/ops/Attendance";
import { Events } from "./components/ops/Events";
import { Announcements } from "./components/ops/Announcements";
import { Badges } from "./components/ops/Badges";
import { Certificates } from "./components/ops/Certificates";
import { Finance } from "./components/ops/Finance";
import { AuditLog } from "./components/ops/AuditLog";

function ComingSoon({ title, phase }: { title: string; phase: string }): ReactElement {
  return (
    <div className="nuru-card" style={{ padding: 32, maxWidth: 560, display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FDF5E5", color: "#8A6B1F", display: "grid", placeItems: "center" }}>
        <Hammer size={20} />
      </div>
      <div>
        <h2 className="type-section" style={{ fontSize: 20 }}>{title}</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginTop: 6 }}>
          This screen is being rebuilt to the new design in <strong>{phase}</strong>. Its data and
          actions are wired to the live backend and land in an upcoming pass.
        </p>
      </div>
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
      case "curriculum-levels":
        return <CurriculumLevels onOpenCms={() => setScreen("cms")} />;
      case "level-detail":
        return <LevelDetail />;
      case "cms":
      case "module-editor":
      case "quiz-builder":
        // One persistent hub instance backs the CMS sub-screens, so the selected
        // level/module carries across these nav items (level → module → quiz).
        return <CurriculumAdmin />;
      case "videos":
        return <VideoLibrary />;
      case "growth-content":
        return <GrowthContent />;
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
      case "cohort-engagement":
        return <CohortEngagement />;
      case "member-profile":
        return <ComingSoon title={SCREEN_TITLES[active]} phase="WP3 (Member Profile detail)" />;
    }
  })();

  return (
    <PortalShell active={active} onNavigate={setScreen} title={SCREEN_TITLES[active]}>
      {body}
    </PortalShell>
  );
}
