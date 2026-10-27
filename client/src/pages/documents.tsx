import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Search,
  Filter,
  GraduationCap,
  DollarSign,
  IdCard,
  Globe,
  BookOpen,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileImage,
  FileSpreadsheet,
  MessageSquare,
  File,
  X,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useDocuments,
  useGenerateUploadUrl,
  useCreateDocument,
  useDeleteDocument,
  useMyProfile,
  fetchDocumentWithDownloadUrl
} from "@/hooks/use-documents";
import type { StudentDocument } from "@shared/schema";
import { Eyebrow, Pill, StudentSurface, buttonClass } from "@/components/student-progress/student-ui";
import { cn } from "@/lib/utils";
import { useT, type Language, type TranslationKey } from "@/i18n";
import { docTypeLabel } from "@/lib/document-type-labels";

type DocumentCategory =
  | "academic"
  | "financial"
  | "identity"
  | "foreign_credentials"
  | "transfer_credits"
  | "chat";

type DocumentStatus = "pending" | "verified" | "rejected";

const categoryConfig: Record<DocumentCategory, { label: string; short: string; icon: typeof FileText; color: string }> = {
  academic: { 
    label: "Academic Records",
    short: "Academic", 
    icon: GraduationCap, 
    color: "text-student-gold-ink" 
  },
  financial: { 
    label: "Financial Documents",
    short: "Financial", 
    icon: DollarSign, 
    color: "text-student-gold-ink" 
  },
  identity: { 
    label: "ID Verification",
    short: "ID", 
    icon: IdCard, 
    color: "text-student-gold-ink" 
  },
  foreign_credentials: { 
    label: "Foreign Credential Validation",
    short: "Foreign credentials", 
    icon: Globe, 
    color: "text-student-gold-ink" 
  },
  transfer_credits: { 
    label: "Transfer Records",
    short: "Transfer", 
    icon: BookOpen, 
    color: "text-student-gold-ink" 
  },
  chat: {
    label: "Chat attachments",
    short: "Chat",
    icon: MessageSquare,
    color: "text-student-gold-ink"
  },
};

const statusConfig: Record<DocumentStatus, { label: string; variant: "default" | "secondary" | "destructive"; icon: typeof CheckCircle2 }> = {
  pending: {
    label: "Pending Review",
    variant: "secondary",
    icon: Clock
  },
  verified: {
    label: "Verified",
    variant: "default",
    icon: CheckCircle2
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    icon: AlertCircle
  },
};

// Map frontend categories to backend doc_type enums
const categoryToDocType: Record<DocumentCategory, string> = {
  academic: "hs_transcript",
  financial: "other",
  identity: "id_gov",
  foreign_credentials: "foreign_eval",
  transfer_credits: "college_transcript",
  // Uploads from the Documents page never create chat attachments (those go through the chat flow).
  chat: "other",
};

// Map backend doc_type to frontend categories
function mapDocTypeToCategory(docType: string): DocumentCategory {
  const mapping: Record<string, DocumentCategory> = {
    "id_gov": "identity",
    "hs_diploma": "academic",
    "hs_transcript": "academic",
    "degree_certificate": "academic",
    "college_transcript": "transfer_credits",
    "foreign_eval": "foreign_credentials",
    "english_cert": "academic",
    "residency_doc": "identity",
    "consent_form": "identity",
    "other": "financial",
    "chat_attachment": "chat",
  };
  return mapping[docType] || "academic";
}

export { docTypeLabel };
const formatDocDate = (value: string, language: Language) => new Intl.DateTimeFormat(language, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

const STATUS_PILL: Record<DocumentStatus, string> = {
  verified: "border-2 border-student-gold-ink bg-student-card text-student-gold-ink",
  pending: "border-student-line-strong bg-student-card text-student-muted",
  rejected: "border-st-attention bg-st-attention-soft text-st-attention",
};
function DocStatusPill({ status }: { status: DocumentStatus }) {
  const { t } = useT();
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <Pill className={cn("font-semibold", STATUS_PILL[status])} icon={<Icon className="h-3.5 w-3.5" aria-hidden="true" />}>
      {t(`documents.statusLabel.${status}` as TranslationKey)}
    </Pill>
  );
}

const docMime = (fileName: string) => {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv": return "text/csv";
    case "txt": return "text/plain";
    case "jpg": case "jpeg": case "gif": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
};

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") return FileSpreadsheet;
  if (mimeType.includes("pdf") || mimeType.includes("wordprocessingml") || mimeType === "text/plain") return FileText;
  return File;
}

/** Human file-kind key for DOCX/XLSX/CSV/TXT/PDF/images (used as a tooltip on the file icon). */
function fileKindKey(mimeType: string): TranslationKey {
  if (mimeType.startsWith("image/")) return "documents.fileKind.image";
  if (mimeType.includes("pdf")) return "documents.fileKind.pdf";
  if (mimeType.includes("wordprocessingml")) return "documents.fileKind.docx";
  if (mimeType.includes("spreadsheetml")) return "documents.fileKind.xlsx";
  if (mimeType === "text/csv") return "documents.fileKind.csv";
  if (mimeType === "text/plain") return "documents.fileKind.txt";
  return "documents.fileKind.other";
}

function formatFileSize(bytes: number, language: Language): string {
  const units = language === "fr" ? ["o", "Ko", "Mo"] : ["B", "KB", "MB"];
  const num = (n: number) => new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  if (bytes < 1024) return `${bytes} ${units[0]}`;
  if (bytes < 1024 * 1024) return `${num(bytes / 1024)} ${units[1]}`;
  return `${num(bytes / (1024 * 1024))} ${units[2]}`;
}

function getFileSizeFromName(fileName: string): number {
  const match = fileName.match(/\((\d+(?:\.\d+)?)\s*(KB|MB)\)/i);
  if (match) {
    const size = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    return unit === 'KB' ? size * 1024 : size * 1024 * 1024;
  }
  return 0;
}

/** Type label; chat attachments also show their file kind (Word, Excel, CSV...). */
function docTypeDisplay(doc: { doc_type: string; file_name: string }, t: (key: TranslationKey) => string): string {
  return doc.doc_type === "chat_attachment"
    ? `${docTypeLabel(doc.doc_type)} · ${t(fileKindKey(docMime(doc.file_name)))}`
    : docTypeLabel(doc.doc_type);
}

export default function Documents() {
  const { toast } = useToast();
  const { t, language } = useT();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const { data: documentsData, isLoading: documentsLoading } = useDocuments(profile?.id || null);
  const generateUploadUrl = useGenerateUploadUrl(profile?.id || null);
  const createDocument = useCreateDocument(profile?.id || null);
  const deleteDocument = useDeleteDocument(profile?.id || null);

  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<DocumentStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DocumentCategory | "all">("all");
  const [previewDocument, setPreviewDocument] = useState<StudentDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const documents = documentsData || [];
  const isLoading = profileLoading || documentsLoading;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const processFiles = useCallback(async (files: FileList) => {
    if (!profile) {
      toast({
        variant: "destructive",
        title: t("documents.toast.noProfile"),
        description: t("documents.toast.noProfileDetail"),
      });
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    const validFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > maxSize) {
        toast({
          variant: "destructive",
          title: t("documents.toast.tooLarge"),
          description: t("documents.toast.tooLargeDetail", { name: file.name }),
        });
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    setUploadProgress(0);

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setUploadProgress(Math.round(((i + 0.5) / validFiles.length) * 100));

      try {
        const category = activeTab === "all" ? "academic" : activeTab;
        const docType = categoryToDocType[category];

        const uploadUrlData = await generateUploadUrl.mutateAsync({
          doc_type: docType,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
          student_code: profile.student_code,
        });

        const uploadResponse = await fetch(uploadUrlData.upload_url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload file to storage');
        }

        await createDocument.mutateAsync({
          doc_type: docType,
          file_name: file.name,
          storage_path: uploadUrlData.storage_path,
        });

        setUploadProgress(Math.round(((i + 1) / validFiles.length) * 100));
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          variant: "destructive",
          title: t("documents.toast.uploadFailed"),
          description: t("documents.toast.uploadFailedDetail", { name: file.name }),
        });
      }
    }

    setUploadProgress(null);
    toast({
      title: t("documents.toast.uploadDone"),
      description: t(validFiles.length === 1 ? "documents.toast.uploadDoneOne" : "documents.toast.uploadDoneMany", { count: validFiles.length }),
    });
  }, [activeTab, profile, generateUploadUrl, createDocument, toast, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t("documents.confirmDelete", { name }))) {
      return;
    }

    try {
      await deleteDocument.mutateAsync(id);
      toast({
        title: t("documents.toast.deleted"),
        description: t("documents.toast.deletedDetail", { name }),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("documents.toast.deleteFailed"),
        description: t("documents.toast.deleteFailedDetail", { name }),
      });
    }
  };

  const handleDownload = async (doc: StudentDocument) => {
    try {
      // Signed URL from the authenticated document endpoint.
      const { download_url } = await fetchDocumentWithDownloadUrl(doc.id);
      const link = document.createElement("a");
      link.href = download_url;
      link.download = doc.file_name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast({
        title: t("documents.toast.downloadStarted"),
        description: t("documents.toast.downloadStartedDetail", { name: doc.file_name }),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("documents.toast.downloadFailed"),
        description: t("documents.toast.downloadFailedDetail", { name: doc.file_name }),
      });
    }
  };

  const handlePreview = async (doc: StudentDocument) => {
    setPreviewDocument(doc);
    setPreviewUrl(null);
    try {
      const { download_url } = await fetchDocumentWithDownloadUrl(doc.id);
      setPreviewUrl(download_url);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("documents.toast.previewFailed"),
        description: t("documents.toast.previewFailedDetail", { name: doc.file_name }),
      });
    }
  };

  const filteredDocuments = documents.filter(doc => {
    const docCategory = mapDocTypeToCategory(doc.doc_type);
    if (activeTab !== "all" && docCategory !== activeTab) return false;
    if (selectedStatus !== "all" && doc.status !== selectedStatus) return false;
    if (searchQuery && !doc.file_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const getCategoryCounts = () => {
    const counts: Record<string, number> = { all: documents.length };
    Object.keys(categoryConfig).forEach(cat => {
      counts[cat] = documents.filter(d => mapDocTypeToCategory(d.doc_type) === cat).length;
    });
    return counts;
  };

  const getStatusCounts = () => {
    return {
      pending: documents.filter(d => d.status === "pending").length,
      verified: documents.filter(d => d.status === "verified").length,
      rejected: documents.filter(d => d.status === "rejected").length,
    };
  };

  const categoryCounts = getCategoryCounts();
  const statusCounts = getStatusCounts();

  return (
    <StudentSurface testId="page-documents">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-3">
        <Eyebrow>{t("nav.file")}</Eyebrow>
        <h1 className="font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-5xl" data-testid="text-page-title">{t("documents.pageTitle")}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-student-muted">
          {t("documents.intro")}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {isLoading ? (
          <Card className="col-span-2">
            <CardContent className="p-4 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : (
          <>
            {Object.entries(statusCounts).map(([status, count]) => {
              const config = statusConfig[status as DocumentStatus];
              const StatusIcon = config.icon;
              return (
                <Card
                  key={status}
                  className="hover-elevate cursor-pointer"
                  onClick={() => setSelectedStatus(selectedStatus === status ? "all" : status as DocumentStatus)}
                  data-testid={`card-status-${status}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-student-gold-soft">
                        <StatusIcon className="h-5 w-5 text-student-gold-ink" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="font-serif text-3xl text-student-ink">{count}</p>
                        <p className="text-xs text-muted-foreground">{t(`documents.statusLabel.${status}` as TranslationKey)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <Card
              className="hover-elevate cursor-pointer col-span-2"
              onClick={() => setSelectedStatus("all")}
              data-testid="card-status-total"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-student-gold-soft">
                    <FileText className="h-5 w-5 text-student-gold-ink" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-serif text-3xl text-student-ink">{documents.length}</p>
                    <p className="text-xs text-muted-foreground">{t("documents.total")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-2xl font-normal">{t("documents.uploadTitle")}</CardTitle>
          <CardDescription>
            {t("documents.uploadHelp")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200
              ${isDragging 
                ? "border-student-gold-ink bg-student-gold-soft" 
                : "border-muted-foreground/25 hover:border-muted-foreground/50"}
            `}
            data-testid="upload-zone"
          >
            {uploadProgress !== null ? (
              <div className="space-y-4">
                <div className="animate-pulse">
                  <Upload className="h-12 w-12 mx-auto text-student-gold-ink mb-4" />
                </div>
                <p className="font-medium">{t("documents.uploading")}</p>
                <Progress value={uploadProgress} className="max-w-xs mx-auto" />
                <p className="text-sm text-muted-foreground">{t("documents.progress", { percent: uploadProgress })}</p>
              </div>
            ) : (
              <>
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="font-semibold mb-2">{t("documents.dropHere")}</p>
                <p className="text-sm text-muted-foreground mb-4">{t("documents.orBrowse")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  id="file-upload"
                  className="hidden"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                  onChange={handleFileSelect}
                  data-testid="input-file-upload"
                />
                <label htmlFor="file-upload" className={cn(buttonClass.solid, "cursor-pointer")} data-testid="button-browse">
                  {t("documents.browse")}
                </label>
                <p className="text-xs text-muted-foreground mt-4">
                  {t("documents.accepted")}
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="font-serif text-2xl font-normal">{t("documents.libraryTitle")}</CardTitle>
              <CardDescription>{t("documents.libraryHelp")}</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("documents.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-full sm:w-64"
                  data-testid="input-search"
                />
              </div>
              <Select value={selectedStatus} onValueChange={(v) => setSelectedStatus(v as DocumentStatus | "all")}>
                <SelectTrigger className="w-full sm:w-40" aria-label={t("support.filterByStatus")} data-testid="select-status-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("common.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("documents.allStatuses")}</SelectItem>
                  <SelectItem value="pending">{t("documents.statusLabel.pending")}</SelectItem>
                  <SelectItem value="verified">{t("documents.statusLabel.verified")}</SelectItem>
                  <SelectItem value="rejected">{t("documents.statusLabel.rejected")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DocumentCategory | "all")}>
            <TabsList className="mb-4 flex-wrap h-auto gap-1">
              <TabsTrigger value="all" className="gap-2" data-testid="tab-all">
                {t("common.all")}
                <Badge variant="secondary" className="ml-1">{categoryCounts.all}</Badge>
              </TabsTrigger>
              {Object.entries(categoryConfig).map(([key, config]) => {
                const Icon = config.icon;
                return (
                  <TabsTrigger 
                    key={key} 
                    value={key} 
                    className="gap-2"
                    data-testid={`tab-${key}`}
                  >
                    <Icon className={`h-4 w-4 ${config.color}`} aria-hidden="true" />
                    <span className="sm:hidden">{t(`documents.cat.${key}.short` as TranslationKey)}</span>
                    <span className="hidden sm:inline">{t(`documents.cat.${key}.label` as TranslationKey)}</span>
                    <Badge variant="secondary" className="ml-1">{categoryCounts[key] || 0}</Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value={activeTab} className="mt-0">
              {activeTab === "chat" && (
                <p className="mb-3 text-sm text-student-muted" data-testid="chat-attachments-note">{t("documents.chatAttachmentNote")}</p>
              )}
              {filteredDocuments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">{t("documents.noneFound")}</p>
                  <p className="text-sm">{t("documents.noneFoundHelp")}</p>
                </div>
              ) : (
                <>
                <ul className="space-y-3 md:hidden" data-testid="document-cards">
                  {filteredDocuments.map((doc) => {
                    const FileIcon = getFileIcon(docMime(doc.file_name));
                    return (
                      <li key={doc.id} className="rounded-xl border border-student-line bg-student-card p-3" data-testid={`card-document-${doc.id}`}>
                        <div className="flex items-start gap-3">
                          <FileIcon className="mt-0.5 h-7 w-7 shrink-0 text-student-muted" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-medium text-student-ink">{doc.file_name}</p>
                            <p className="text-sm text-student-muted">{docTypeDisplay(doc, t)} · {formatDocDate(doc.created_at, language)}</p>
                            <div className="mt-2"><DocStatusPill status={doc.status as DocumentStatus} /></div>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2 border-t border-student-line pt-2">
                          <button type="button" className={cn(buttonClass.outline, "flex-1 px-2")} onClick={() => handlePreview(doc)} aria-label={t("documents.previewFile", { name: doc.file_name })} data-testid={`card-preview-${doc.id}`}><Eye className="h-4 w-4" aria-hidden="true" />{t("common.view")}</button>
                          <button type="button" className={cn(buttonClass.outline, "flex-1 px-2")} onClick={() => handleDownload(doc)} aria-label={t("documents.downloadFile", { name: doc.file_name })} data-testid={`card-download-${doc.id}`}><Download className="h-4 w-4" aria-hidden="true" />{t("common.download")}</button>
                          <button type="button" className={cn(buttonClass.outline, "px-3")} onClick={() => handleDelete(doc.id, doc.file_name)} aria-label={t("documents.deleteFile", { name: doc.file_name })} disabled={deleteDocument.isPending} data-testid={`card-delete-${doc.id}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="hidden overflow-hidden rounded-lg border md:block">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-4 text-sm font-semibold">{t("documents.col.name")}</th>
                          <th className="text-left p-4 text-sm font-semibold">{t("documents.col.type")}</th>
                          <th className="text-left p-4 text-sm font-semibold hidden lg:table-cell">{t("documents.col.uploaded")}</th>
                          <th className="text-left p-4 text-sm font-semibold">{t("common.status")}</th>
                          <th className="text-right p-4 text-sm font-semibold">{t("documents.col.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDocuments.map((doc) => {
                          const FileIcon = getFileIcon(docMime(doc.file_name));
                          const fileSize = getFileSizeFromName(doc.file_name);

                          return (
                            <tr
                              key={doc.id}
                              className="border-b last:border-0 hover-elevate"
                              data-testid={`row-document-${doc.id}`}
                            >
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <FileIcon className="h-8 w-8 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                                  <div className="min-w-0">
                                    <p className="font-medium truncate max-w-[200px] lg:max-w-[300px]">
                                      {doc.file_name}
                                    </p>
                                    {fileSize > 0 && (
                                      <p className="text-xs text-muted-foreground">
                                        {formatFileSize(fileSize, language)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="p-4">
                                <span className="text-sm">{docTypeDisplay(doc, t)}</span>
                              </td>
                              <td className="p-4 hidden lg:table-cell">
                                <span className="text-sm text-muted-foreground">{formatDocDate(doc.created_at, language)}</span>
                              </td>
                              <td className="p-4">
                                <DocStatusPill status={doc.status as DocumentStatus} />
                              </td>
                              <td className="p-4">
                                <div className="flex justify-end gap-1">
                                  <Button variant="ghost" size="icon" onClick={() => handlePreview(doc)} aria-label={t("documents.previewFile", { name: doc.file_name })} data-testid={`button-preview-${doc.id}`}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleDownload(doc)} aria-label={t("documents.downloadFile", { name: doc.file_name })} data-testid={`button-download-${doc.id}`}>
                                    <Download className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleDelete(doc.id, doc.file_name)} aria-label={t("documents.deleteFile", { name: doc.file_name })} data-testid={`button-delete-${doc.id}`} disabled={deleteDocument.isPending}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {previewDocument && (() => {
        const mimeType = previewDocument.file_name.endsWith('.pdf') ? 'application/pdf' :
          previewDocument.file_name.match(/\.(jpg|jpeg|png|gif)$/i) ? 'image/jpeg' : 'application/octet-stream';
        const fileSize = getFileSizeFromName(previewDocument.file_name);

        return (
          <div
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setPreviewDocument(null); setPreviewUrl(null); }}
            data-testid="modal-preview"
          >
            <Card
              className="w-full max-w-4xl max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate">{previewDocument.file_name}</CardTitle>
                  <CardDescription>
                    {fileSize > 0 && `${formatFileSize(fileSize, language)} - `}
                    {t("documents.uploadedOn", { date: formatDocDate(previewDocument.created_at, language) })}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setPreviewDocument(null); setPreviewUrl(null); }}
                  aria-label={t("documents.closePreview")}
                  data-testid="button-close-preview"
                >
                  <X className="h-5 w-5" />
                </Button>
              </CardHeader>
              <CardContent className="overflow-auto max-h-[calc(90vh-120px)]">
                {!previewUrl && (mimeType.startsWith("image/") || mimeType === "application/pdf") ? (
                  <div className="flex justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : mimeType.startsWith("image/") ? (
                  <img
                    src={previewUrl ?? undefined}
                    alt={previewDocument.file_name}
                    className="max-w-full h-auto mx-auto rounded-lg"
                  />
                ) : mimeType === "application/pdf" ? (
                  <iframe
                    src={previewUrl ?? undefined}
                    className="w-full h-[70vh] rounded-lg"
                    title={previewDocument.file_name}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <p>{t("documents.noPreview")}</p>
                    <Button
                      className="mt-4"
                      onClick={() => handleDownload(previewDocument)}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download to View
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })()}
    </div>
    </StudentSurface>
  );
}

function getDocumentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("transcript")) return "Transcript";
  if (lower.includes("receipt")) return "Receipt";
  if (lower.includes("invoice")) return "Invoice";
  if (lower.includes("agreement")) return "Agreement";
  if (lower.includes("license") || lower.includes("id")) return "Government ID";
  if (lower.includes("diploma")) return "Diploma";
  if (lower.includes("certificate")) return "Certificate";
  if (lower.includes("evaluation")) return "Credential Evaluation";
  if (lower.includes("recommendation")) return "Credit Recommendation";
  if (lower.includes("progress")) return "Progress Report";
  return "Document";
}
