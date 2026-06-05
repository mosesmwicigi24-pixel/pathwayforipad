// Root component (spec §1.3). Renders from local state on launch, then reconciles
// in the background — the user never stares at a spinner because a tower dropped.
import { Text, View } from "react-native";
import { Provider } from "react-redux";
import { store } from "./store/store";

export function App(): JSX.Element {
  return (
    <Provider store={store}>
      <View>
        <Text>Nuru Place · Pathway</Text>
      </View>
    </Provider>
  );
}
