// Nuru Pathway Web Portal — router, rebuilt to the "Final Pathway Portal" Figma
// make (ZMEsnrOJCXXY7rHfTBautI). The shell (Layout) + nav are the real product
// structure; each inner page is rebuilt to the make and replaces its placeholder
// in a later phase (see docs / task list P4–P7).
import { type ReactElement } from "react";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { Layout } from "./components/shell/Layout";
import { Login } from "./components/pages/Login";
import { Dashboard } from "./components/pages/Dashboard";
import { CurriculumLevels } from "./components/pages/CurriculumLevels";
import { CmsCurriculum } from "./components/pages/CmsCurriculum";
import { Placeholder } from "./components/pages/Placeholder";

const ph = (title: string, phase: string): ReactElement => <Placeholder title={title} phase={phase} />;

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/preview/:moduleId", element: ph("Module Preview", "P6 — Curriculum") },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "curriculum-levels", element: <CurriculumLevels /> },
      { path: "cms", element: <CmsCurriculum /> },
      { path: "cms/level/:id", element: ph("CMS — Level Detail", "P6 — Curriculum") },
      { path: "level-detail", element: ph("CMS — Level Detail", "P6 — Curriculum") },
      { path: "quiz-builder", element: ph("Level Quiz Builder", "P6 — Curriculum") },
      { path: "video-library", element: ph("Video Library", "P6 — Curriculum") },
      { path: "cell-engagement", element: ph("Cell Engagement", "P7 — Operations") },
      { path: "cell-engagement/:cellId", element: ph("Cell Detail", "P7 — Operations") },
      { path: "members", element: ph("Members", "P7 — Operations") },
      { path: "member-profile", element: ph("Member Profile", "P7 — Operations") },
      { path: "reflection-queue", element: ph("Reflection Queue", "P7 — Operations") },
      { path: "events", element: ph("Events & Attendance", "P7 — Operations") },
      { path: "finance", element: ph("Finance", "P7 — Operations") },
      { path: "certificates", element: ph("Certificates & Badges", "P7 — Operations") },
      { path: "badges", element: ph("Badges Catalog", "P7 — Operations") },
      { path: "users", element: ph("System Users", "P4 — System") },
      { path: "roles", element: ph("Roles & Permissions", "P4 — System") },
      { path: "countries", element: ph("Countries", "P4 — System") },
      { path: "languages", element: ph("Languages", "P4 — System") },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App(): ReactElement {
  return <RouterProvider router={router} />;
}
