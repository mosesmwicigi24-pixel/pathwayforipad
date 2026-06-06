// Lightweight typed stack navigator (spec §1.3). Kept dependency-free so the app
// stays self-contained; in production this is the seam where @react-navigation/
// native-stack drops in — screens already consume the useNavigation() hook, so
// only this file changes.
import { createContext, useCallback, useContext, useMemo, useState, type ReactElement } from "react";
import { LoginScreen } from "../screens/LoginScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { ModuleScreen } from "../screens/ModuleScreen";
import { QuizScreen } from "../screens/QuizScreen";
import { GivingScreen } from "../screens/GivingScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { LevelCompleteScreen } from "../screens/LevelCompleteScreen";

export type Route =
  | { name: "Login" }
  | { name: "Home" }
  | { name: "Module"; moduleId: string }
  | { name: "Quiz"; moduleId: string }
  | { name: "Giving" }
  | { name: "Profile" }
  | { name: "LevelComplete" };

interface Navigation {
  route: Route;
  navigate: (r: Route) => void;
  goBack: () => void;
}

const NavContext = createContext<Navigation | null>(null);

export function useNavigation(): Navigation {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNavigation must be used within <RootNavigator>");
  return ctx;
}

function renderRoute(route: Route): ReactElement {
  switch (route.name) {
    case "Login":
      return <LoginScreen />;
    case "Home":
      return <HomeScreen />;
    case "Module":
      return <ModuleScreen moduleId={route.moduleId} />;
    case "Quiz":
      return <QuizScreen moduleId={route.moduleId} />;
    case "Giving":
      return <GivingScreen />;
    case "Profile":
      return <ProfileScreen />;
    case "LevelComplete":
      return <LevelCompleteScreen />;
  }
}

export function RootNavigator({ initial }: { initial: Route }): ReactElement {
  const [stack, setStack] = useState<Route[]>([initial]);
  const route = stack[stack.length - 1] ?? initial;

  const navigate = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const goBack = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const value = useMemo<Navigation>(() => ({ route, navigate, goBack }), [route, navigate, goBack]);

  return <NavContext.Provider value={value}>{renderRoute(route)}</NavContext.Provider>;
}
