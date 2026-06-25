// React Native entry. Registers the root component with the native runtime.
// The native ios/ and android/ projects (generated via the RN CLI) reference this.
import { AppRegistry } from "react-native";
import notifee from "@notifee/react-native";
import { App } from "./src/App";
import { name as appName } from "./app.json";

// Notifee requires a background-event handler registered at the top level so the OS
// can deliver notification events while the app is backgrounded/quit. A tap that
// cold-starts the app is routed in-app via notifee.getInitialNotification(); this
// handler just needs to exist (and we keep it side-effect-free).
notifee.onBackgroundEvent(async () => {
  // no-op: cold-start routing is handled by getInitialNotification() in the app
});

AppRegistry.registerComponent(appName, () => App);
