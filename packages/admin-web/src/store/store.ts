// Redux Toolkit store for the portal. The portal is online-only, so it has no
// offlineSlice (that lives in the mobile client, §1.3) — only session/user
// context and server-cache slices are added here as features land.
import { configureStore } from "@reduxjs/toolkit";
import { userReducer } from "./userSlice";
import { authReducer, logout } from "./authSlice";
import { cohortReducer } from "./cohortSlice";
import { setOnSessionExpired } from "../api/client";

export const store = configureStore({
  reducer: {
    user: userReducer,
    auth: authReducer,
    cohort: cohortReducer,
  },
});

// When the refresh token itself is dead (not a one-off 401), the api client signals
// expiry → return the UI to /login. Single-flight refresh in the client means a
// transient 401 is recovered silently and never reaches here.
setOnSessionExpired(() => {
  store.dispatch(logout());
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
