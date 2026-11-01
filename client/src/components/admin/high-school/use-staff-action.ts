import { useState } from "react";
import { HsApiError, useHsMutation } from "@/lib/admin-high-school-api";
import { useHs } from "./hs-i18n";
import type { StaffHighSchoolState } from "@shared/high-school-contract";

/** Wraps one staff mutation with a visible success/failure message. */
export function useStaffAction<V>(studentId: string, fn: (vars: V) => Promise<StaffHighSchoolState>, success: string) {
  const { t, x } = useHs();
  const mutation = useHsMutation<V>(studentId, fn);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = (vars: V, onDone?: () => void) => {
    setMessage(null);
    mutation.mutate(vars, {
      onSuccess: () => {
        setMessage({ tone: "success", text: success });
        onDone?.();
      },
      onError: (err: unknown) => setMessage({ tone: "error", text: err instanceof HsApiError ? x(err.failure.message) : t("s32dir.hs.err.generic") }),
    });
  };
  return { run, pending: mutation.isPending, message };
}
