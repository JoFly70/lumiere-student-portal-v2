/**
 * Actions the graduate views can invoke. Views never fetch: the page injects the
 * live implementation (use-graduate-program.ts); tests and screenshot pages
 * render from fixtures with the inert default. Each action resolves only after
 * the server answered 2xx, and rejects with the server's message otherwise.
 */
import React, { createContext, useContext } from "react";
import type { StudentProgress, StudentThesisPlan } from "@shared/graduate-program-contract";

export interface GraduateActions {
  setSubjectProgress(programId: string, subjectId: string, progress: StudentProgress): Promise<void>;
  saveThesisPlan(programId: string, plan: StudentThesisPlan): Promise<void>;
}

const unavailable = () => Promise.reject(new Error("This action is not available in preview."));

export const INERT_GRADUATE_ACTIONS: GraduateActions = {
  setSubjectProgress: unavailable,
  saveThesisPlan: unavailable,
};

const Ctx = createContext<GraduateActions>(INERT_GRADUATE_ACTIONS);

export function GraduateActionsProvider({ value, children }: { value: GraduateActions; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGraduateActions(): GraduateActions {
  return useContext(Ctx);
}
