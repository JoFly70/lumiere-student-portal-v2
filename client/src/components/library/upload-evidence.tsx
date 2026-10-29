/** Upload evidence into a library category (and optionally a course shelf) through the existing signed-upload flow. */
import React, { useId, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buttonClass } from "@/components/student-progress/student-ui";
import { useCreateDocument, useGenerateUploadUrl } from "@/hooks/use-documents";
import { useToast } from "@/hooks/use-toast";
import { DOCUMENT_ACCEPT_ATTR, checkDocumentFile, resolveDocumentMime } from "@/lib/document-upload-policy";
import { UPLOAD_CATEGORIES, UPLOAD_DOC_TYPE, buildDocumentNotes } from "@/lib/library-model";
import { useT, type TranslationKey } from "@/i18n";

const field = "min-h-[44px] w-full rounded-lg border border-student-line-strong bg-student-card px-3 text-sm text-student-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink";

export function UploadEvidence({
  open, onOpenChange, profile, courses, defaultCategory = "coursework", defaultCourse = "",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profile: { id: string; student_code: string } | null | undefined;
  courses: readonly { key: string; title: string }[];
  defaultCategory?: (typeof UPLOAD_CATEGORIES)[number];
  defaultCourse?: string;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useGenerateUploadUrl(profile?.id ?? null);
  const createDocument = useCreateDocument(profile?.id ?? null);
  const [category, setCategory] = useState<(typeof UPLOAD_CATEGORIES)[number]>(defaultCategory);
  const [course, setCourse] = useState(defaultCourse);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => { if (open) { setCategory(defaultCategory); setCourse(defaultCourse); setNote(""); setFile(null); setError(null); } }, [open, defaultCategory, defaultCourse]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !profile || busy) return;
    const problem = checkDocumentFile(file);
    if (problem) { setError(t(problem === "tooLarge" ? "documents.toast.tooLargeDetail" : "documents.toast.badTypeDetail", { name: file.name })); return; }
    setBusy(true);
    setError(null);
    try {
      const docType = UPLOAD_DOC_TYPE[category];
      const mime = resolveDocumentMime(file);
      const up = await generateUploadUrl.mutateAsync({ doc_type: docType, file_name: file.name, file_size: file.size, mime_type: mime, student_code: profile.student_code });
      const put = await fetch(up.upload_url, { method: "PUT", body: file, headers: { "Content-Type": mime } });
      if (!put.ok) throw new Error("storage");
      await createDocument.mutateAsync({ doc_type: docType, file_name: file.name, storage_path: up.storage_path, notes: buildDocumentNotes(course || null, note) });
      toast({ title: t("documents.toast.uploadDone"), description: t("documents.toast.uploadDoneOne", { count: 1 }) });
      onOpenChange(false);
    } catch {
      setError(t("documents.toast.uploadFailedDetail", { name: file.name }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg" data-testid="library-upload">
        <DialogHeader className="text-left">
          <DialogTitle className="font-serif text-2xl">{t("ux.lib.upload.title")}</DialogTitle>
          <DialogDescription>{t("ux.lib.upload.intro")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div>
            <label htmlFor={`${uid}-cat`} className="mb-1 block text-sm font-medium text-student-ink">{t("ux.lib.upload.category")}</label>
            <select id={`${uid}-cat`} className={field} value={category} onChange={(e) => setCategory(e.target.value as typeof category)} data-testid="upload-category">
              {UPLOAD_CATEGORIES.map((c) => <option key={c} value={c}>{t(`ux.lib.cat.${c}` as TranslationKey)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-course`} className="mb-1 block text-sm font-medium text-student-ink">{t("ux.lib.upload.course")}</label>
            <select id={`${uid}-course`} className={field} value={course} onChange={(e) => setCourse(e.target.value)} data-testid="upload-course">
              <option value="">{t("ux.lib.upload.noCourse")}</option>
              {courses.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-note`} className="mb-1 block text-sm font-medium text-student-ink">{t("ux.lib.upload.note")}</label>
            <input id={`${uid}-note`} className={field} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${uid}-file`} className="mb-1 block text-sm font-medium text-student-ink">{t("ux.lib.upload.file")}</label>
            <input ref={fileRef} id={`${uid}-file`} type="file" accept={DOCUMENT_ACCEPT_ATTR} className={cn(field, "py-2")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="upload-file" />
            <p className="mt-1 text-xs text-student-muted">{t("ux.lib.upload.hint")}</p>
          </div>
          {error && <p role="alert" className="text-sm text-st-attention">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonClass.solid} aria-disabled={!file || busy} disabled={!file || busy || !profile} data-testid="upload-submit">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {busy ? t("documents.uploading") : t("ux.lib.upload.submit")}
            </button>
            <button type="button" className={buttonClass.outline} onClick={() => onOpenChange(false)} disabled={busy}>{t("hs.subjects.cancel")}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
