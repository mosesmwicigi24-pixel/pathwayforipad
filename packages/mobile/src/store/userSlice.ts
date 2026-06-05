// userSlice (spec §1.3): session context. Tokens themselves live in the OS secure
// enclave (Keychain/Keystore, §5.7), never in this slice or plain storage.
import { createSlice } from "@reduxjs/toolkit";
import type { UserRole } from "@nuru/shared";

export interface UserState {
  userId: string | null;
  role: UserRole | null;
  currentLevel: number | null;
}

const initialState: UserState = { userId: null, role: null, currentLevel: null };

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {},
});

export const userReducer = userSlice.reducer;
