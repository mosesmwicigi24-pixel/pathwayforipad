// Root navigation (new design, Contract Matrix M1) on @react-navigation.
// A native-stack hosts Login, the five-tab area (Home · Pathway · Give ·
// Community · Profile), and the pushed flows: the learning path (Level →
// Lesson → Quiz → LevelComplete), the full calendar browse, and the Event
// detail. The tabs use our custom navy/gold tab bar.
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
import { ProfileScreen } from "../screens/ProfileScreen.js";
import { CommunityScreen } from "../screens/CommunityScreen.js";
import { ThreadScreen } from "../screens/ThreadScreen.js";
import { GiftsScreen } from "../screens/GiftsScreen.js";
import { PrayerJournalScreen } from "../screens/PrayerJournalScreen.js";
import { VerseLibraryScreen } from "../screens/VerseLibraryScreen.js";
import { NotificationsScreen } from "../screens/NotificationsScreen.js";
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
      <Tab.Screen name="Pathway" component={LevelsScreen} />
      <Tab.Screen name="Community" component={CommunityScreen} />
      <Tab.Screen name="Give" component={GivingScreen} />
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
        <Stack.Screen name="Level" component={LevelScreen} />
        <Stack.Screen name="Module" component={ModuleScreen} />
        <Stack.Screen name="Quiz" component={QuizScreen} />
        <Stack.Screen name="LevelComplete" component={LevelCompleteScreen} />
        <Stack.Screen name="Giving" component={GivingScreen} />
        <Stack.Screen name="Calendar" component={CalendarScreen} />
        <Stack.Screen name="Thread" component={ThreadScreen} />
        <Stack.Screen name="Gifts" component={GiftsScreen} />
        <Stack.Screen name="PrayerJournal" component={PrayerJournalScreen} />
        <Stack.Screen name="VerseLibrary" component={VerseLibraryScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="EventDetail" component={EventDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
