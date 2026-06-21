// Nuru Pathway Web Portal — router, rebuilt to the "Final Pathway Portal" Figma
// make (ZMEsnrOJCXXY7rHfTBautI). The shell (Layout) + nav are the real product
// structure; each inner page is rebuilt to the make and replaces its placeholder
// in a later phase (see docs / task list P4–P7).
import { type ReactElement } from "react";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { Layout } from "./components/shell/Layout";
import { Login } from "./components/pages/Login";
import { ResetPassword } from "./components/pages/ResetPassword";
import { Dashboard } from "./components/pages/Dashboard";
import { CurriculumLevels } from "./components/pages/CurriculumLevels";
import { CmsCurriculum } from "./components/pages/CmsCurriculum";
import { LevelDetail } from "./components/pages/LevelDetail";
import { QuizBuilder } from "./components/pages/QuizBuilder";
import { VideoLibrary } from "./components/pages/VideoLibrary";
import { GrowthContent } from "./components/pages/GrowthContent";
import { ModulePreview } from "./components/pages/ModulePreview";
import { CellEngagement } from "./components/pages/CellEngagement";
import { CellDetail } from "./components/pages/CellDetail";
import { Members } from "./components/pages/Members";
import { ReflectionQueue } from "./components/pages/ReflectionQueue";
import { Chat } from "./components/pages/Chat";
import { Events } from "./components/pages/Events";
import { Finance } from "./components/pages/Finance";
import { Certificates } from "./components/pages/Certificates";
import { Badges } from "./components/pages/Badges";
import { MemberProfile } from "./components/pages/MemberProfile";
import { Profile } from "./components/pages/Profile";
import { Notifications } from "./components/pages/Notifications";
import { Users } from "./components/pages/Users";
import { Roles } from "./components/pages/Roles";
import { Congregations } from "./components/pages/Congregations";
import { Countries } from "./components/pages/Countries";
import { Languages } from "./components/pages/Languages";
import { NotificationsProvider } from "./components/notifications/NotificationsProvider";
const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "/preview/:moduleId", element: <ModulePreview /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "curriculum-levels", element: <CurriculumLevels /> },
      { path: "cms", element: <CmsCurriculum /> },
      { path: "cms/level/:id", element: <LevelDetail /> },
      { path: "level-detail", element: <LevelDetail /> },
      { path: "quiz-builder", element: <QuizBuilder /> },
      { path: "video-library", element: <VideoLibrary /> },
      { path: "content-studio", element: <GrowthContent /> },
      { path: "cell-engagement", element: <CellEngagement /> },
      { path: "cell-engagement/:cellId", element: <CellDetail /> },
      { path: "members", element: <Members /> },
      { path: "member-profile", element: <MemberProfile /> },
      { path: "profile", element: <Profile /> },
      { path: "notifications", element: <Notifications /> },
      { path: "reflection-queue", element: <ReflectionQueue /> },
      { path: "chat", element: <Chat /> },
      { path: "events", element: <Events /> },
      { path: "finance", element: <Finance /> },
      { path: "certificates", element: <Certificates /> },
      { path: "badges", element: <Badges /> },
      { path: "users", element: <Users /> },
      { path: "roles", element: <Roles /> },
      { path: "congregations", element: <Congregations /> },
      { path: "countries", element: <Countries /> },
      { path: "languages", element: <Languages /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App(): ReactElement {
  return (
    <NotificationsProvider>
      <RouterProvider router={router} />
    </NotificationsProvider>
  );
}
