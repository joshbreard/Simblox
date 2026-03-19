import { create } from "zustand";
import type { SuccessCriteria, SweepConfig, SweepParam } from "./types";
import { EMPTY_CRITERIA } from "./types";

interface CriteriaState {
  nlInput: string;
  parsedCriteria: SuccessCriteria | null;
  confirmed: boolean;
  parsing: boolean;
  parseError: string | null;

  // Variable sweep
  sweepEnabled: boolean;
  sweepConfig: SweepConfig;

  setNlInput: (v: string) => void;
  setParsedCriteria: (c: SuccessCriteria | null) => void;
  confirmCriteria: () => void;
  setParsing: (v: boolean) => void;
  setParseError: (e: string | null) => void;
  setSweepEnabled: (v: boolean) => void;
  setSweepParam: (p: SweepParam) => void;
  setSweepMin: (v: number) => void;
  setSweepMax: (v: number) => void;
  reset: () => void;
}

const DEFAULT_SWEEP: SweepConfig = { param: "gravity", min: -15, max: -5 };

export const useCriteriaStore = create<CriteriaState>((set) => ({
  nlInput: "",
  parsedCriteria: null,
  confirmed: false,
  parsing: false,
  parseError: null,
  sweepEnabled: false,
  sweepConfig: { ...DEFAULT_SWEEP },

  setNlInput: (v) => set({ nlInput: v, confirmed: false, parsedCriteria: null, parseError: null }),
  setParsedCriteria: (c) => set({ parsedCriteria: c, parseError: null }),
  confirmCriteria: () => set({ confirmed: true }),
  setParsing: (v) => set({ parsing: v }),
  setParseError: (e) => set({ parseError: e, parsing: false }),
  setSweepEnabled: (v) => set({ sweepEnabled: v }),
  setSweepParam: (p) => set((s) => ({ sweepConfig: { ...s.sweepConfig, param: p } })),
  setSweepMin: (v) => set((s) => ({ sweepConfig: { ...s.sweepConfig, min: v } })),
  setSweepMax: (v) => set((s) => ({ sweepConfig: { ...s.sweepConfig, max: v } })),
  reset: () =>
    set({
      nlInput: "",
      parsedCriteria: null,
      confirmed: false,
      parsing: false,
      parseError: null,
      sweepEnabled: false,
      sweepConfig: { ...DEFAULT_SWEEP },
    }),
}));

export { EMPTY_CRITERIA };
