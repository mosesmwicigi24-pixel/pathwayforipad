// Root navigation (spec §1.3) on @react-navigation. A native-stack hosts Login,
// the bottom-tab area, and the learning flow (Lesson → Quiz) + the level-complete
// celebration. The tabs use our Figma-styled custom tab bar.
import { type ReactElement } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { RootStackParamList, TabParamList } from "./types.js";
import { BottomTabBar } from "./BottomTabBar.js";
import { LoginScreen } from "../screens/LoginScreen.js";
import { HomeScreen } from "../screens/HomeScreen.js";
import { ModuleScreen } from "../screens/ModuleScreen.js";
import { QuizScreen } from "../screens/QuizScreen.js";
import { GivingScreen } from "../screens/GivingScreen.js";
import { ProfileScreen } from "../screens/ProfileScreen.js";
import { LevelCompleteScreen } from "../screens/LevelCompleteScreen.js";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function Tabs(): ReactElement {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Giving" component={GivingScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator(): ReactElement {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Module" component={ModuleScreen} />
        <Stack.Screen name="Quiz" component={QuizScreen} />
        <Stack.Screen name="LevelComplete" component={LevelCompleteScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
