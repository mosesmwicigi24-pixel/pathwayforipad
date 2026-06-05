// React Native entry. Registers the root component with the native runtime.
// The native ios/ and android/ projects (generated via the RN CLI) reference this.
import { AppRegistry } from "react-native";
import { App } from "./src/App";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
