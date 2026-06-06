// Cohort table state — fetched via a thunk so components stay decoupled from the
// network. Scores/bands are server-authoritative; the client only renders them.
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { PortalApi, type CohortMember } from "../api/client";
import { errorMessage } from "../util/error";

export const fetchCohort = createAsyncThunk<
  { members: CohortMember[]; nextCursor: string | null; cellId: string },
  { cellId: string; band?: string },
  { rejectValue: string }
>("cohort/fetch", async ({ cellId, band }, { rejectWithValue }) => {
  try {
    const page = await PortalApi.cohort(cellId, band ? { band } : {});
    return { members: page.data, nextCursor: page.next_cursor, cellId };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "Could not load this cohort."));
  }
});

export interface CohortState {
  cellId: string;
  band: string;
  members: CohortMember[];
  nextCursor: string | null;
  status: "idle" | "loading" | "error";
  error: string | null;
}

const initialState: CohortState = {
  cellId: "",
  band: "",
  members: [],
  nextCursor: null,
  status: "idle",
  error: null,
};

const cohortSlice = createSlice({
  name: "cohort",
  initialState,
  reducers: {
    setCellId(state, action: { payload: string }) {
      state.cellId = action.payload;
    },
    setBand(state, action: { payload: string }) {
      state.band = action.payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchCohort.pending, (s) => {
      s.status = "loading";
      s.error = null;
    })
      .addCase(fetchCohort.fulfilled, (s, a) => {
        s.status = "idle";
        s.members = a.payload.members;
        s.nextCursor = a.payload.nextCursor;
      })
      .addCase(fetchCohort.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Could not load this cohort.";
        s.members = [];
      });
  },
});

export const { setCellId, setBand } = cohortSlice.actions;
export const cohortReducer = cohortSlice.reducer;
