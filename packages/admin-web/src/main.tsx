// Admin web portal entry (spec §1.3). Online-only, read-optimised. Defining
// screen is the cohort table sorted ascending by engagement score — a single
// indexed query against the engagement_scores snapshot (§2.5), not a live compute.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store/store";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
