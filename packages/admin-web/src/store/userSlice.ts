// Session/identity context for the portal (§1.3). Placeholder state shape; auth
// wiring (gateway-issued JWT) is added as features land.
import { createSlice } from "@reduxjs/toolkit";
import type { UserRole } from "@nuru/shared";

export interface UserState {
  userId: string | null;
  role: UserRole | null;
}

const initialState: UserState = { userId: null, role: null };

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {},
});

export const userReducer = userSlice.reducer;
