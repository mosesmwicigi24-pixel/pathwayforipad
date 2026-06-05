// Mobile Redux Toolkit store (spec §1.3): an offlineSlice that queues mutations
// and a userSlice for session context. Presentational components are decoupled
// from network state and read from this store.
import { configureStore } from "@reduxjs/toolkit";
import { offlineReducer } from "./offlineSlice";
import { userReducer } from "./userSlice";

export const store = configureStore({
  reducer: {
    offline: offlineReducer,
    user: userReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
