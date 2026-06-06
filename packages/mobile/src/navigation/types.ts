// Typed route params for @react-navigation (spec §1.3). The root native-stack
// hosts Login, the bottom-tab area, and the modal-ish learning flow; the tabs are
// the three primary destinations.
import type { NavigatorScreenParams } from "@react-navigation/native";

export type TabParamList = {
  Home: undefined;
  Giving: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Module: { moduleId: string };
  Quiz: { moduleId: string };
  LevelComplete: undefined;
};
