/**
 * Shared HTTP helpers for the S05 roadmap routers.
 */
import type { Response } from "express";
import { logger } from "../lib/logger";
import { RoadmapError } from "../services/student-roadmap-service";

/** { error: { code, message, details? } } for typed roadmap errors; generic 500 otherwise. */
export function sendRoadmapError(res: Response, error: unknown, context: string) {
  if (error instanceof RoadmapError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }
  logger.error(`Roadmap ${context} failed`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return res.status(500).json({ error: "Internal server error" });
}

export function validationFailure(res: Response, message: string, details?: Record<string, unknown>) {
  return res.status(400).json({
    error: { code: "ROADMAP_VALIDATION_ERROR", message, ...(details ? { details } : {}) },
  });
}

/** Deterministic JSON (sorted object keys) so package hashes ignore key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
