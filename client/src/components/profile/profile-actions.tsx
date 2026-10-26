/**
 * Actions the profile views can invoke. Views never fetch: the page injects
 * the live implementation (use-student-profile.ts); tests and screenshot
 * pages render from fixtures with the default (inert) actions.
 */
import React, { createContext, useContext } from "react";
import type {
  CreateIdentityCorrection,
  StudentContactInput,
  StudentSelfServiceUpdate,
} from "@shared/student-profile-contract";

export interface ProfileActions {
  /** PUT /api/students/:studentId (self-service fields only). */
  saveSelfService(update: StudentSelfServiceUpdate): Promise<void>;
  submitCorrection(input: CreateIdentityCorrection): Promise<void>;
  withdrawCorrection(requestId: string): Promise<void>;
  addContact(input: StudentContactInput): Promise<void>;
  updateContact(contactId: string, patch: Partial<StudentContactInput>): Promise<void>;
  deleteContact(contactId: string): Promise<void>;
  /** Called after a photo upload the server accepted (2xx). */
  refresh(): void;
}

const unavailable = () => Promise.reject(new Error("This action is not available in preview."));

export const INERT_PROFILE_ACTIONS: ProfileActions = {
  saveSelfService: unavailable,
  submitCorrection: unavailable,
  withdrawCorrection: unavailable,
  addContact: unavailable,
  updateContact: unavailable,
  deleteContact: unavailable,
  refresh: () => undefined,
};

const Ctx = createContext<ProfileActions>(INERT_PROFILE_ACTIONS);

export function ProfileActionsProvider({ value, children }: { value: ProfileActions; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfileActions(): ProfileActions {
  return useContext(Ctx);
}
