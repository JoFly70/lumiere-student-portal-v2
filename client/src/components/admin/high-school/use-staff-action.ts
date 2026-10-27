import { useState } from "react";
import { HsApiError, useHsMutation } from "@/lib/admin-high-school-api";
import type { StaffHighSchoolState } from "@shared/high-school-contract";

/** Wraps one staff mutation with a visible success/failure message. */
export function useStaffAction<V>(studentId: string, fn: (vars: V) => Promise<StaffHighSchoolState>, success: string) {
  const mutation = useHsMutation<V>(studentId, fn);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = (vars: V, onDone?: () => void) => {
    setMessage(null);
    mutation.mutate(vars, {
      onSuccess: () => {
        setMessage({ tone: "success", text: success });
        onDone?.();
      },
      onError: (err: unknown) => setMessage({ tone: "error", text: err instanceof HsApiError ? err.failure.message : "Something went wrong. Nothing was saved." }),
    });
  };
  return { run, pending: mutation.isPending, message };
}
