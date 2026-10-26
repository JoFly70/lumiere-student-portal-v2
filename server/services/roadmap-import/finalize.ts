import { type RoadmapContent, type RoadmapException } from "@shared/student-roadmap-contract";
import { parseRoadmapContent, validateRoadmapContent } from "@shared/student-roadmap-validation";
import { ExceptionCollector } from "./types";

/**
 * Every adapter ends here: the produced document must pass roadmapContentSchema
 * and the semantic validation. Conversion exceptions come first (in emission
 * order), then validation exceptions; keys are de-duplicated.
 */
export function finalizeContent(
  raw: unknown,
  conversionExceptions: readonly RoadmapException[],
): { content: RoadmapContent | null; exceptions: RoadmapException[] } {
  const collector = new ExceptionCollector();
  collector.addAll(conversionExceptions);
  const parsed = parseRoadmapContent(raw);
  collector.addAll(parsed.exceptions);
  if (parsed.content) collector.addAll(validateRoadmapContent(parsed.content));
  return { content: parsed.content, exceptions: collector.list };
}
