/** Preview / download of one document through the existing short-lived signed-URL endpoint. */
import React, { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import type { StudentDocument } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buttonClass } from "@/components/student-progress/student-ui";
import { fetchDocumentWithDownloadUrl } from "@/hooks/use-documents";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n";

const kindOf = (name: string): "pdf" | "image" | "other" => (/\.pdf$/i.test(name) ? "pdf" : /\.(png|jpe?g|webp|gif)$/i.test(name) ? "image" : "other");

export async function downloadDocument(doc: Pick<StudentDocument, "id" | "file_name">): Promise<void> {
  const { download_url } = await fetchDocumentWithDownloadUrl(doc.id);
  const link = document.createElement("a");
  link.href = download_url;
  link.download = doc.file_name;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function DocumentViewer({ doc, onClose }: { doc: StudentDocument | null; onClose: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!doc) return;
    let live = true;
    fetchDocumentWithDownloadUrl(doc.id).then((r) => live && setUrl(r.download_url)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = doc ? kindOf(doc.file_name) : "other";
  const download = async () => {
    if (!doc) return;
    try { await downloadDocument(doc); } catch { toast({ variant: "destructive", title: t("documents.toast.downloadFailed"), description: t("documents.toast.downloadFailedDetail", { name: doc.file_name }) }); }
  };
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="student-surface max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-4xl overflow-hidden p-4 sm:p-6" data-testid="library-viewer">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="break-all font-serif text-xl">{doc?.file_name}</DialogTitle>
          <DialogDescription>{t("ux.lib.viewer.note")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] overflow-auto">
          {failed ? (
            <p role="alert" className="py-10 text-center text-sm text-st-attention">{t("documents.toast.previewFailedDetail", { name: doc?.file_name ?? "" })}</p>
          ) : kind !== "other" && !url ? (
            <div className="flex justify-center py-12 text-student-muted"><Loader2 className="h-8 w-8 animate-spin" aria-label={t("cockpit.ops.loading")} /></div>
          ) : kind === "image" ? (
            <img src={url ?? undefined} alt={doc?.file_name} className="mx-auto h-auto max-w-full rounded-lg" />
          ) : kind === "pdf" ? (
            <iframe src={url ?? undefined} title={doc?.file_name} className="h-[64vh] w-full rounded-lg border border-student-line" />
          ) : (
            <div className="py-10 text-center text-student-muted"><FileText className="mx-auto mb-3 h-12 w-12 opacity-50" aria-hidden="true" /><p>{t("documents.noPreview")}</p></div>
          )}
        </div>
        <div className="flex justify-end">
          <button type="button" className={buttonClass.solid} onClick={() => void download()} data-testid="library-download"><Download className="h-4 w-4" aria-hidden="true" />{t("ux.lib.download")}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
