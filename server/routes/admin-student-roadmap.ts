/**
 * Staff API for the Lumière-assigned student roadmap (S05).
 *
 *   GET    /api/admin/students/:studentId/roadmap
 *   POST   /api/admin/students/:studentId/roadmap/imports            (.xlsx "workbook" or JSON package)
 *   PUT    /api/admin/students/:studentId/roadmap/draft
 *   POST   /api/admin/students/:studentId/roadmap/draft/acknowledge
 *   GET    /api/admin/students/:studentId/roadmap/draft/preview
 *   POST   /api/admin/students/:studentId/roadmap/draft/publish      (ADMIN only)
 *   POST   /api/admin/students/:studentId/roadmap/draft/discard
 *   POST   /api/admin/students/:studentId/roadmap/draft/from-published
 *
 * Middleware is applied per route (not router-wide) so mounting this router
 * at /api/admin does not intercept other /api/admin paths. Authentication is
 * the bearer token (requireAuth); there is no cookie session to forge, so no
 * separate CSRF token is used, matching the other admin routers.
 */
import crypto from "crypto";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { ConversionResult } from "@shared/student-roadmap-contract";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import type { StudentRoadmapService } from "../services/student-roadmap-service";
import { convertImportPackage, convertWorkbook, convertWorkbookPair } from "../services/roadmap-import";
import { canonicalJson, sendRoadmapError, validationFailure } from "./roadmap-http";
import { roadmapAudit } from "./roadmap-audit";

export interface AdminStudentRoadmapRouterDeps {
  readonly service: Pick<
    StudentRoadmapService,
    | "getAdminState"
    | "createDraftFromConversion"
    | "updateDraft"
    | "acknowledge"
    | "previewDraft"
    | "publish"
    | "discardDraft"
    | "draftFromPublished"
  >;
  readonly convertWorkbook: (buffer: Buffer, opts: { fileName: string | null }) => Promise<ConversionResult>;
  readonly convertImportPackage: (json: unknown) => ConversionResult;
  /** S07: master + companion execution workbook -> one conversion. Defaults to the real converter. */
  readonly convertWorkbookPair?: (
    master: Buffer,
    companion: Buffer,
    opts: { fileName: string | null; companionFileName: string | null },
  ) => Promise<ConversionResult>;
}

const studentIdSchema = z.string().trim().min(1).max(128);
const revisionSchema = z.number().int().min(0);

const updateDraftBody = z.object({ expectedDraftRevision: revisionSchema, content: z.unknown() }).strict();
const acknowledgeBody = z
  .object({
    expectedDraftRevision: revisionSchema,
    exceptionKeys: z.array(z.string().min(1).max(300)).min(1).max(500),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
const publishBody = z
  .object({ expectedDraftRevision: revisionSchema, expectedPublishedVersionId: z.string().uuid().nullable() })
  .strict();
const discardBody = z.object({ expectedDraftRevision: revisionSchema }).strict();

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_WORKBOOK_BYTES, files: 2 },
});

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function createAdminStudentRoadmapRouter(deps: AdminStudentRoadmapRouterDeps) {
  const router = Router();
  const staffOrAdmin = [requireAuth, requireRole(["staff", "admin"])];
  const adminOnly = [requireAuth, requireRole(["admin"])];

  /** Resolves :studentId, rejecting a query-string studentId. */
  const withStudent =
    (handler: (req: Request, res: Response, studentId: string) => Promise<unknown>, context: string): RequestHandler =>
    async (req, res) => {
      const parsed = studentIdSchema.safeParse(req.params.studentId);
      if (!parsed.success || Object.prototype.hasOwnProperty.call(req.query, "studentId")) {
        return validationFailure(res, "studentId must be a non-empty string of at most 128 characters");
      }
      try {
        await handler(req, res, parsed.data);
      } catch (error) {
        sendRoadmapError(res, error, context);
      }
    };

  const parseBody = <T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      validationFailure(res, "Invalid request body", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return null;
    }
    return parsed.data;
  };

  router.get(
    "/students/:studentId/roadmap",
    ...staffOrAdmin,
    withStudent(async (_req, res, studentId) => res.json(await deps.service.getAdminState(studentId)), "state"),
  );

  const acceptUpload = (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("multipart/form-data")) return next();
    upload.fields([{ name: "workbook", maxCount: 1 }, { name: "companion", maxCount: 1 }])(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const tooLarge = err.code === "LIMIT_FILE_SIZE";
        return res.status(tooLarge ? 413 : 400).json({
          error: {
            code: "ROADMAP_VALIDATION_ERROR",
            message: tooLarge ? "Each workbook must be 5 MB or smaller" : "Upload the master in the \"workbook\" field and, optionally, the execution workbook in the \"companion\" field",
          },
        });
      }
      return next(err);
    });
  };

  router.post(
    "/students/:studentId/roadmap/imports",
    ...staffOrAdmin,
    acceptUpload,
    withStudent(async (req, res, studentId) => {
      const replaceDraft = req.query.replaceDraft === "true";
      let conversion: ConversionResult;
      let fileSha256: string;
      let fileName: string | null = null;

      if (req.is("multipart/form-data")) {
        const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
        const file = files.workbook?.[0];
        const companion = files.companion?.[0];
        if (!file) return validationFailure(res, "Attach an .xlsx file in the \"workbook\" field");
        for (const f of companion ? [file, companion] : [file]) {
          if (!f.originalname.toLowerCase().endsWith(".xlsx")) {
            return validationFailure(res, "Only .xlsx workbooks are accepted");
          }
          // .xlsx is a zip container.
          if (f.buffer.length < 4 || f.buffer[0] !== 0x50 || f.buffer[1] !== 0x4b) {
            return validationFailure(res, "The file is not a valid .xlsx workbook");
          }
        }
        fileName = file.originalname.slice(0, 255);
        if (companion) {
          const companionName = companion.originalname.slice(0, 255);
          // Deterministic over both files so re-uploading the same pair is an idempotent replay.
          fileSha256 = sha256(`lumiere-workbook-pair/1\n${sha256(file.buffer)}\n${sha256(companion.buffer)}`);
          fileName = `${fileName} + ${companionName}`.slice(0, 255);
          conversion = await (deps.convertWorkbookPair ?? convertWorkbookPair)(file.buffer, companion.buffer, {
            fileName: file.originalname.slice(0, 255),
            companionFileName: companionName,
          });
        } else {
          fileSha256 = sha256(file.buffer);
          conversion = await deps.convertWorkbook(file.buffer, { fileName });
        }
      } else {
        const body: unknown = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
          return validationFailure(res, "Send a workbook (multipart) or a roadmap import package (JSON)");
        }
        fileSha256 = sha256(canonicalJson(body));
        conversion = deps.convertImportPackage(body);
      }

      const outcome = await deps.service.createDraftFromConversion(
        studentId,
        req.user!.id,
        { conversion, fileSha256, fileName },
        { replaceDraft },
      );
      roadmapAudit.imported(req, studentId, outcome, replaceDraft);
      return res.status(outcome.replay ? 200 : 201).json(outcome.state);
    }, "import"),
  );

  router.put(
    "/students/:studentId/roadmap/draft",
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(updateDraftBody, req, res);
      if (!body) return;
      const state = await deps.service.updateDraft(studentId, req.user!.id, body.expectedDraftRevision, body.content);
      roadmapAudit.draftUpdated(req, studentId, state);
      return res.json(state);
    }, "draft update"),
  );

  router.post(
    "/students/:studentId/roadmap/draft/acknowledge",
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(acknowledgeBody, req, res);
      if (!body) return;
      const state = await deps.service.acknowledge(studentId, req.user!.id, body.expectedDraftRevision, body.exceptionKeys, body.note ?? null);
      roadmapAudit.acknowledged(req, studentId, state, body.exceptionKeys.length);
      return res.json(state);
    }, "acknowledge"),
  );

  router.get(
    "/students/:studentId/roadmap/draft/preview",
    ...staffOrAdmin,
    withStudent(async (_req, res, studentId) => res.json(await deps.service.previewDraft(studentId)), "preview"),
  );

  router.post(
    "/students/:studentId/roadmap/draft/publish",
    ...adminOnly,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(publishBody, req, res);
      if (!body) return;
      const state = await deps.service
        .publish(studentId, req.user!.id, body.expectedDraftRevision, body.expectedPublishedVersionId)
        .catch((error: unknown) => {
          roadmapAudit.publishRejected(req, studentId, body.expectedDraftRevision, error);
          throw error;
        });
      roadmapAudit.published(req, studentId, state, body.expectedDraftRevision);
      return res.json(state);
    }, "publish"),
  );

  router.post(
    "/students/:studentId/roadmap/draft/discard",
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const body = parseBody(discardBody, req, res);
      if (!body) return;
      const state = await deps.service.discardDraft(studentId, req.user!.id, body.expectedDraftRevision);
      roadmapAudit.discarded(req, studentId, body.expectedDraftRevision);
      return res.json(state);
    }, "discard"),
  );

  router.post(
    "/students/:studentId/roadmap/draft/from-published",
    ...staffOrAdmin,
    withStudent(async (req, res, studentId) => {
      const state = await deps.service.draftFromPublished(studentId, req.user!.id);
      roadmapAudit.openedFromPublished(req, studentId, state);
      return res.json(state);
    }, "from-published"),
  );

  return router;
}

/** Production wiring; the service (and its database handle) load lazily on first request. */
export function createDefaultAdminStudentRoadmapRouter() {
  const loadService = async () => (await import("../services/student-roadmap-service.default")).defaultStudentRoadmapService;
  return createAdminStudentRoadmapRouter({
    service: {
      getAdminState: async (...a) => (await loadService()).getAdminState(...a),
      createDraftFromConversion: async (...a) => (await loadService()).createDraftFromConversion(...a),
      updateDraft: async (...a) => (await loadService()).updateDraft(...a),
      acknowledge: async (...a) => (await loadService()).acknowledge(...a),
      previewDraft: async (...a) => (await loadService()).previewDraft(...a),
      publish: async (...a) => (await loadService()).publish(...a),
      discardDraft: async (...a) => (await loadService()).discardDraft(...a),
      draftFromPublished: async (...a) => (await loadService()).draftFromPublished(...a),
    },
    convertWorkbook,
    convertImportPackage,
  });
}

export default createDefaultAdminStudentRoadmapRouter();
