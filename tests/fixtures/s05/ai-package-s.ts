/**
 * AI-produced package fixture (format lumiere-roadmap-package/1) for scenario S.
 * Synthetic: generator and model names are invented. It carries medium/low
 * confidence annotations, conditional allocations and credit claims. Credit claims
 * must NEVER be applied (AI_CREDIT_CLAIM_IGNORED).
 */
import { ROADMAP_IMPORT_PACKAGE_FORMAT, type RoadmapImportPackage } from "../../../shared/student-roadmap-contract";
import { scenarioSSpec } from "./scenario-s";
import { toRoadmapContent } from "./builders";

export const aiPackageScenarioS: RoadmapImportPackage = {
  format: ROADMAP_IMPORT_PACKAGE_FORMAT,
  generator: { name: "Synthetic Planning Assistant", model: "synthetic-model-1", preparedAt: "2026-10-20" },
  content: toRoadmapContent(scenarioSSpec),
  itemAnnotations: [
    { itemKey: "s-eng-101", confidence: "high", needsReview: false },
    {
      itemKey: "s-cs-101-alt",
      confidence: "medium",
      needsReview: true,
      rationale: "Provider equivalence was inferred from the course title only.",
      conditionalAllocation: "Applies only if CIS-110 is not accepted toward the programming requirement.",
    },
    {
      itemKey: "s-db-220",
      confidence: "medium",
      needsReview: false,
      rationale: "Assumed the foreign database course will not be accepted.",
      conditionalAllocation: "Needed only if the prior database credit is not accepted.",
    },
    {
      itemKey: "s-networks-240",
      confidence: "low",
      needsReview: true,
      rationale: "Course code was read from a low-quality screenshot.",
    },
  ],
  creditClaims: [
    { description: "Student reportedly has 30 credits accepted from Greenfield College; apply them to general education." },
    { description: "Associate degree awarded in 2019 (stated in an email, not documented)." },
  ],
};

export const aiPackageScenarioSExpectations = {
  templateId: "ai-package-v1",
  itemCount: 12,
  /** Exact counts per code; annotated items with confidence below high or needsReview each raise one warning. */
  exceptionCodes: {
    AI_LOW_CONFIDENCE: 3,
    AI_CREDIT_CLAIM_IGNORED: 2,
    CONDITIONAL_ALLOCATION: 2,
  },
  lowConfidenceItemKeys: ["s-cs-101-alt", "s-db-220", "s-networks-240"],
  conditionalItemKeys: ["s-cs-101-alt", "s-db-220"],
  forbiddenSeverities: ["blocking"],
  /** The claims must have no effect on the foundation or on any item. */
  creditClaimsApplied: false,
} as const;
