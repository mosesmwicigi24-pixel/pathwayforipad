// A global navigation ref so non-screen code (e.g. the announcement heads-up
// toast fired by the alert engine) can navigate without a hook/context. Attached
// to the NavigationContainer in RootNavigator.
import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./types.js";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Navigate from outside the React tree; a no-op until the container is ready. */
export function navigate<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
): void {
  if (navigationRef.isReady()) {
    // @ts-expect-error params typing is exact per-route; callers pass the right shape.
    navigationRef.navigate(name, params);
  }
}
