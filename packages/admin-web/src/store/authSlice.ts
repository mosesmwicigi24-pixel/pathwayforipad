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

export const login = createAsyncThunk<
  { accessToken: string; email: string; role: string | null },
  { email: string; password: string },
  { rejectValue: string }
>("auth/login", async ({ email, password }, { rejectWithValue }) => {
  try {
    const session = await PortalApi.login(email, password);
    setAccessToken(session.access_token);
    return { accessToken: session.access_token, email, role: decodeRole(session.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "Invalid email or password."));
  }
});

export interface AuthState {
  accessToken: string | null;
  email: string | null;
  role: string | null;
  status: "idle" | "loading" | "error";
  error: string | null;
}

const initialState: AuthState = { accessToken: null, email: null, role: null, status: "idle", error: null };

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    logout(state) {
      state.accessToken = null;
      state.email = null;
      state.role = null;
      setAccessToken(null);
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
        s.accessToken = a.payload.accessToken;
        s.email = a.payload.email;
        s.role = a.payload.role;
      })
      .addCase(login.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Login failed";
      });
  },
});

export const { logout } = authSlice.actions;
export const authReducer = authSlice.reducer;
