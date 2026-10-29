import { CheckCircle2 } from "lucide-react";
import { StaffPill } from "@/components/staff/staff-ui";
import { STAGE_LABEL, type ElectiveStage } from "@/lib/elective-stage";

const TONE = { requested: "neutral", lumiere_review: "gold", school_pending: "attention", approved: "seal", rejected: "urgent", applied: "seal" } as const;

export function StagePill({ stage }: { stage: ElectiveStage }) {
  return <StaffPill tone={TONE[stage]} testId={`stage-${stage}`} icon={stage === "applied" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : undefined}>{STAGE_LABEL[stage]}</StaffPill>;
}
