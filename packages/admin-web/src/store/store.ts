// Redux Toolkit store for the portal. The portal is online-only, so it has no
// offlineSlice (that lives in the mobile client, §1.3) — only session/user
// context and server-cache slices are added here as features land.
import { configureStore } from "@reduxjs/toolkit";
import { userReducer } from "./userSlice";

export const store = configureStore({
  reducer: {
    user: userReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
