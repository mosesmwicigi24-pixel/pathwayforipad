// Root navigation (spec §1.3; Figma "Nuru Pathway app design") on @react-navigation.
// A native-stack hosts Login, the five-tab area, and the pushed flows: the learning
// path (Level → Lesson → Quiz → LevelComplete), the Give screen, and the calendar
// Event detail. The tabs use our Figma-styled custom tab bar.
import { type ReactElement } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { RootStackParamList, TabParamList } from "./types.js";
import { BottomTabBar } from "./BottomTabBar.js";
import { LoginScreen } from "../screens/LoginScreen.js";
import { HomeDashboardScreen } from "../screens/HomeDashboardScreen.js";
import { LevelsScreen } from "../screens/LevelsScreen.js";
import { LevelScreen } from "../screens/LevelScreen.js";
import { CalendarScreen } from "../screens/CalendarScreen.js";
import { EventDetailScreen } from "../screens/EventDetailScreen.js";
import { PortalScreen } from "../screens/PortalScreen.js";
import { ChatScreen } from "../screens/ChatScreen.js";
import { ModuleScreen } from "../screens/ModuleScreen.js";
import { QuizScreen } from "../screens/QuizScreen.js";
import { GivingScreen } from "../screens/GivingScreen.js";
import { LevelCompleteScreen } from "../screens/LevelCompleteScreen.js";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function Tabs(): ReactElement {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeDashboardScreen} />
      <Tab.Screen name="Levels" component={LevelsScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
      <Tab.Screen name="Portal" component={PortalScreen} />
      <Tab.Screen name="Chat" component={ChatScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator(): ReactElement {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Level" component={LevelScreen} />
        <Stack.Screen name="Module" component={ModuleScreen} />
        <Stack.Screen name="Quiz" component={QuizScreen} />
        <Stack.Screen name="LevelComplete" component={LevelCompleteScreen} />
        <Stack.Screen name="Giving" component={GivingScreen} />
        <Stack.Screen name="EventDetail" component={EventDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
