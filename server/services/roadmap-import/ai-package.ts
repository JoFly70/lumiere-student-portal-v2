import {
  roadmapImportPackageSchema,
  type ConversionResult,
  type RoadmapException,
} from "@shared/student-roadmap-contract";
import { finalizeContent } from "./finalize";
import { ExceptionCollector } from "./types";

export const AI_PACKAGE_TEMPLATE_ID = "ai-package-v1";
const MAX_ISSUES = 50;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;

function emptySummary(generator: string | null): ConversionResult["summary"] {
  return { kind: "package", fileName: null, sheetsRead: [], rowsRead: 0, rowsConverted: 0, rowsSkipped: 0, generator };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Remove anything an AI may not assert: links to canonical credit records and
 * "approved" approvals are institutional decisions. They are dropped/downgraded
 * and flagged (AI_CREDIT_CLAIM_IGNORED), never trusted.
 */
function sanitizeContent(content: unknown, ex: ExceptionCollector): unknown {
  if (!isRecord(content) || !Array.isArray(content.items)) return content;
  const items = content.items.map((item) => {
    if (!isRecord(item)) return item;
    const copy: Record<string, unknown> = { ...item };
    const itemKey = typeof copy.key === "string" ? copy.key : undefined;
    if (copy.linkedCreditRecordId !== undefined && copy.linkedCreditRecordId !== null) {
      ex.add(
        "AI_CREDIT_CLAIM_IGNORED", "warning",
        `The package linked item "${itemKey ?? "?"}" to a canonical credit record. Only staff can link credit records; the link was removed.`,
        { itemKey, path: "linkedCreditRecordId" }, "link",
      );
    }
    copy.linkedCreditRecordId = null;
    const approval = copy.approval;
    if (isRecord(approval) && approval.status === "approved") {
      ex.add(
        "AI_CREDIT_CLAIM_IGNORED", "warning",
        `The package marked item "${itemKey ?? "?"}" as approved. An AI cannot record an institutional approval; it was set to pending.`,
        { itemKey, path: "approval" }, "approval",
      );
      copy.approval = { ...approval, status: "pending", required: true };
    }
    return copy;
  });
  return { ...content, items };
}

/** AI / script produced package -> draft content + review exceptions. Pure and deterministic. */
export function convertImportPackage(json: unknown): ConversionResult {
  const ex = new ExceptionCollector();
  let input = json;
  if (typeof input === "string") {
    if (input.length > MAX_PACKAGE_BYTES) {
      ex.add("PACKAGE_INVALID", "blocking", "The package is too large.", { path: "(root)" });
      return { templateId: AI_PACKAGE_TEMPLATE_ID, content: null, exceptions: ex.list, summary: emptySummary(null) };
    }
    try {
      input = JSON.parse(input);
    } catch {
      ex.add("PACKAGE_INVALID", "blocking", "The package is not valid JSON.", { path: "(root)" });
      return { templateId: AI_PACKAGE_TEMPLATE_ID, content: null, exceptions: ex.list, summary: emptySummary(null) };
    }
  }

  const parsed = roadmapImportPackageSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, MAX_ISSUES)) {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      ex.add("PACKAGE_INVALID", "blocking", `Package field ${path}: ${issue.message}`, { path });
    }
    return { templateId: AI_PACKAGE_TEMPLATE_ID, content: null, exceptions: ex.list, summary: emptySummary(null) };
  }
  const pkg = parsed.data;
  const generator = pkg.generator.model ? `${pkg.generator.name} (${pkg.generator.model})` : pkg.generator.name;

  const sanitized = sanitizeContent(pkg.content, ex);
  const afterSanitize = [...ex.list];
  const finalized = finalizeContent(sanitized, afterSanitize);
  const collector = new ExceptionCollector();
  collector.addAll(finalized.exceptions);

  const knownItems = new Set(finalized.content?.items.map((i) => i.key) ?? []);
  for (const a of pkg.itemAnnotations) {
    if (knownItems.size > 0 && !knownItems.has(a.itemKey)) continue; // annotation for an item that does not exist
    const low = a.confidence !== "high" || a.needsReview;
    if (low) {
      const why = a.needsReview ? "the generator asked for review" : `confidence is ${a.confidence}`;
      collector.add(
        "AI_LOW_CONFIDENCE", "warning",
        `${generator} is unsure about "${a.itemKey}" (${why})${a.rationale ? `: ${a.rationale}` : ""}. Check it before publishing.`,
        { itemKey: a.itemKey },
      );
    }
    if (a.conditionalAllocation) {
      collector.add(
        "CONDITIONAL_ALLOCATION", "warning",
        `"${a.itemKey}" has a conditional allocation noted by the generator: ${a.conditionalAllocation}. Confirm it is right; credit allocation is decided by Lumière, not the import.`,
        { itemKey: a.itemKey },
      );
    }
  }
  pkg.creditClaims.forEach((claim, i) => {
    collector.add(
      "AI_CREDIT_CLAIM_IGNORED", "warning",
      `Credit claim ignored (credit and acceptance come only from the verified academic record): ${claim.description.slice(0, 200)}`,
      { path: `creditClaims.${i}` },
    );
  });

  const itemCount = finalized.content?.items.length ?? 0;
  const rawItems = isRecordItems(sanitized);
  return {
    templateId: AI_PACKAGE_TEMPLATE_ID,
    content: finalized.content,
    exceptions: collector.list as RoadmapException[],
    summary: {
      kind: "package", fileName: null, sheetsRead: [], rowsRead: rawItems, rowsConverted: itemCount,
      rowsSkipped: Math.max(0, rawItems - itemCount), generator,
    },
  };
}

function isRecordItems(content: unknown): number {
  return isRecord(content) && Array.isArray(content.items) ? content.items.length : 0;
}
