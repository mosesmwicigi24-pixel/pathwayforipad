// Auth state for the portal. The access token lives in Redux memory only (never
// localStorage) and is mirrored into the axios client. DEV login only — production
// uses the gateway-issued session.
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { PortalApi, setAccessToken } from "../api/client";
import { errorMessage } from "../util/error";
import { decodeRole } from "../util/jwt";

export const devLogin = createAsyncThunk<
  { accessToken: string; email: string; role: string | null },
  string,
  { rejectValue: string }
>("auth/devLogin", async (email, { rejectWithValue }) => {
  try {
    const session = await PortalApi.devLogin(email);
    setAccessToken(session.access_token); // axios sends it on every call
    return { accessToken: session.access_token, email, role: decodeRole(session.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "Login failed — check the email is seeded (pnpm db:seed:dev)."));
  }
});

// Resolves to a session, OR a `mfaToken` challenge when the account has 2FA on
// (then the UI collects a code and dispatches completeMfa).
export const login = createAsyncThunk<
  { accessToken: string; email: string; role: string | null } | { mfaToken: string; email: string },
  { email: string; password: string },
  { rejectValue: string }
>("auth/login", async ({ email, password }, { rejectWithValue }) => {
  try {
    const res = await PortalApi.login(email, password);
    if ("mfa_required" in res) return { mfaToken: res.mfa_token, email };
    setAccessToken(res.access_token);
    return { accessToken: res.access_token, email, role: decodeRole(res.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "Invalid email or password."));
  }
});

export const completeMfa = createAsyncThunk<
  { accessToken: string; email: string; role: string | null },
  { mfaToken: string; email: string; code: string },
  { rejectValue: string }
>("auth/completeMfa", async ({ mfaToken, email, code }, { rejectWithValue }) => {
  try {
    const session = await PortalApi.loginCompleteMfa(mfaToken, code);
    setAccessToken(session.access_token);
    return { accessToken: session.access_token, email, role: decodeRole(session.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "That code didn't match. Try again or use a recovery code."));
  }
});

export interface AuthState {
  accessToken: string | null;
  email: string | null;
  role: string | null;
  status: "idle" | "loading" | "error";
  error: string | null;
  /** Set when password sign-in returns a 2FA challenge; cleared once completed. */
  mfaToken: string | null;
}

const initialState: AuthState = { accessToken: null, email: null, role: null, status: "idle", error: null, mfaToken: null };

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    logout(state) {
      state.accessToken = null;
      state.email = null;
      state.role = null;
      state.mfaToken = null;
      setAccessToken(null);
    },
    cancelMfa(state) {
      state.mfaToken = null;
      state.status = "idle";
      state.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(devLogin.pending, (s) => {
      s.status = "loading";
      s.error = null;
    })
      .addCase(devLogin.fulfilled, (s, a) => {
        s.status = "idle";
        s.accessToken = a.payload.accessToken;
        s.email = a.payload.email;
        s.role = a.payload.role;
      })
      .addCase(devLogin.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Login failed";
      })
      .addCase(login.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(login.fulfilled, (s, a) => {
        s.status = "idle";
        if ("mfaToken" in a.payload) {
          s.mfaToken = a.payload.mfaToken; // hold for the code step
          s.email = a.payload.email;
        } else {
          s.accessToken = a.payload.accessToken;
          s.email = a.payload.email;
          s.role = a.payload.role;
        }
      })
      .addCase(login.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Login failed";
      })
      .addCase(completeMfa.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(completeMfa.fulfilled, (s, a) => {
        s.status = "idle";
        s.mfaToken = null;
        s.accessToken = a.payload.accessToken;
        s.email = a.payload.email;
        s.role = a.payload.role;
      })
      .addCase(completeMfa.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Verification failed";
      });
  },
});

export const { logout, cancelMfa } = authSlice.actions;
export const authReducer = authSlice.reducer;
