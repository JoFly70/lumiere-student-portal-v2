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
  useMyProfile
} from "@/hooks/use-documents";
import type { StudentDocument } from "@shared/schema";

type DocumentCategory =
  | "academic"
  | "financial"
  | "identity"
  | "foreign_credentials"
  | "transfer_credits";

type DocumentStatus = "pending" | "verified" | "rejected";

const categoryConfig: Record<DocumentCategory, { label: string; icon: typeof FileText; color: string }> = {
  academic: { 
    label: "Academic Records", 
    icon: GraduationCap, 
    color: "text-blue-600 dark:text-blue-400" 
  },
  financial: { 
    label: "Financial Documents", 
    icon: DollarSign, 
    color: "text-green-600 dark:text-green-400" 
  },
  identity: { 
    label: "ID Verification", 
    icon: IdCard, 
    color: "text-purple-600 dark:text-purple-400" 
  },
  foreign_credentials: { 
    label: "Foreign Credential Validation", 
    icon: Globe, 
    color: "text-orange-600 dark:text-orange-400" 
  },
  transfer_credits: { 
    label: "Transfer Records", 
    icon: BookOpen, 
    color: "text-cyan-600 dark:text-cyan-400" 
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
  };
  return mapping[docType] || "academic";
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FileSpreadsheet;
  if (mimeType.includes("pdf")) return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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

export default function Documents() {
  const { toast } = useToast();
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
        title: "Profile not found",
        description: "Please complete your profile before uploading documents.",
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
          title: "File too large",
          description: `${file.name} exceeds the 10MB limit.`,
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

        const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
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
          storage_path: uploadUrlData.storagePath,
          url: uploadUrlData.publicUrl,
          visibility: 'student_staff',
          status: 'pending',
          required_for_enrollment: false,
        });

        setUploadProgress(Math.round(((i + 1) / validFiles.length) * 100));
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          variant: "destructive",
          title: "Upload failed",
          description: `Failed to upload ${file.name}`,
        });
      }
    }

    setUploadProgress(null);
    toast({
      title: "Upload complete",
      description: `${validFiles.length} file(s) uploaded successfully.`,
    });
  }, [activeTab, profile, generateUploadUrl, createDocument, toast]);

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
    if (!confirm(`Are you sure you want to delete "${name}"?`)) {
      return;
    }

    try {
      await deleteDocument.mutateAsync(id);
      toast({
        title: "Document deleted",
        description: `${name} has been removed.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: `Failed to delete ${name}`,
      });
    }
  };

  const handleDownload = (doc: StudentDocument) => {
    const link = document.createElement("a");
    link.href = doc.url;
    link.download = doc.file_name;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({
      title: "Download started",
      description: `Downloading ${doc.file_name}...`,
    });
  };

  const handlePreview = (doc: StudentDocument) => {
    setPreviewDocument(doc);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Document Management System</h1>
        <p className="text-muted-foreground mt-1">
          Upload, organize, and manage your academic and administrative documents
        </p>
      </div>

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
                      <div className={`p-2 rounded-lg ${
                        status === "verified" ? "bg-green-100 dark:bg-green-900/30" :
                        status === "pending" ? "bg-yellow-100 dark:bg-yellow-900/30" :
                        "bg-red-100 dark:bg-red-900/30"
                      }`}>
                        <StatusIcon className={`h-5 w-5 ${
                          status === "verified" ? "text-green-600 dark:text-green-400" :
                          status === "pending" ? "text-yellow-600 dark:text-yellow-400" :
                          "text-red-600 dark:text-red-400"
                        }`} />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{count}</p>
                        <p className="text-xs text-muted-foreground">{config.label}</p>
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
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{documents.length}</p>
                    <p className="text-xs text-muted-foreground">Total Documents</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Documents</CardTitle>
          <CardDescription>
            Drag and drop files or click to browse. Files are securely stored and can be accessed anytime.
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
                ? "border-primary bg-primary/5 scale-[1.02]" 
                : "border-muted-foreground/25 hover:border-muted-foreground/50"}
            `}
            data-testid="upload-zone"
          >
            {uploadProgress !== null ? (
              <div className="space-y-4">
                <div className="animate-pulse">
                  <Upload className="h-12 w-12 mx-auto text-primary mb-4" />
                </div>
                <p className="font-medium">Uploading files...</p>
                <Progress value={uploadProgress} className="max-w-xs mx-auto" />
                <p className="text-sm text-muted-foreground">{uploadProgress}% complete</p>
              </div>
            ) : (
              <>
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">Drag and drop files here</h3>
                <p className="text-sm text-muted-foreground mb-4">or click to browse your computer</p>
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
                <Button asChild data-testid="button-browse">
                  <label htmlFor="file-upload" className="cursor-pointer">
                    Browse Files
                  </label>
                </Button>
                <p className="text-xs text-muted-foreground mt-4">
                  Accepted: PDF, PNG, JPG, DOC, DOCX, XLS, XLSX (Max 10MB per file)
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
              <CardTitle>Document Library</CardTitle>
              <CardDescription>Browse and manage your uploaded documents</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-full sm:w-64"
                  data-testid="input-search"
                />
              </div>
              <Select value={selectedStatus} onValueChange={(v) => setSelectedStatus(v as DocumentStatus | "all")}>
                <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DocumentCategory | "all")}>
            <TabsList className="mb-4 flex-wrap h-auto gap-1">
              <TabsTrigger value="all" className="gap-2" data-testid="tab-all">
                All
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
                    <Icon className={`h-4 w-4 ${config.color}`} />
                    <span className="hidden sm:inline">{config.label}</span>
                    <Badge variant="secondary" className="ml-1">{categoryCounts[key] || 0}</Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value={activeTab} className="mt-0">
              {filteredDocuments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No documents found</p>
                  <p className="text-sm">Try adjusting your filters or upload new documents</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-4 text-sm font-semibold">Name</th>
                          <th className="text-left p-4 text-sm font-semibold hidden md:table-cell">Category</th>
                          <th className="text-left p-4 text-sm font-semibold hidden lg:table-cell">Type</th>
                          <th className="text-left p-4 text-sm font-semibold hidden sm:table-cell">Upload Date</th>
                          <th className="text-left p-4 text-sm font-semibold">Status</th>
                          <th className="text-right p-4 text-sm font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDocuments.map((doc) => {
                          const mimeType = doc.file_name.endsWith('.pdf') ? 'application/pdf' :
                            doc.file_name.match(/\.(jpg|jpeg|png|gif)$/i) ? 'image/jpeg' :
                            'application/octet-stream';
                          const FileIcon = getFileIcon(mimeType);
                          const category = mapDocTypeToCategory(doc.doc_type);
                          const catConfig = categoryConfig[category];
                          const CatIcon = catConfig.icon;
                          const statConfig = statusConfig[doc.status];
                          const fileSize = getFileSizeFromName(doc.file_name);

                          return (
                            <tr
                              key={doc.id}
                              className="border-b last:border-0 hover-elevate"
                              data-testid={`row-document-${doc.id}`}
                            >
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <FileIcon className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                                  <div className="min-w-0">
                                    <p className="font-medium truncate max-w-[200px] lg:max-w-[300px]">
                                      {doc.file_name}
                                    </p>
                                    {fileSize > 0 && (
                                      <p className="text-xs text-muted-foreground">
                                        {formatFileSize(fileSize)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="p-4 hidden md:table-cell">
                                <div className="flex items-center gap-2">
                                  <CatIcon className={`h-4 w-4 ${catConfig.color}`} />
                                  <span className="text-sm">{catConfig.label}</span>
                                </div>
                              </td>
                              <td className="p-4 hidden lg:table-cell">
                                <span className="text-sm text-muted-foreground">{doc.doc_type}</span>
                              </td>
                              <td className="p-4 hidden sm:table-cell">
                                <span className="text-sm text-muted-foreground">
                                  {new Date(doc.created_at).toLocaleDateString()}
                                </span>
                              </td>
                              <td className="p-4">
                                <Badge variant={statConfig.variant}>
                                  {statConfig.label}
                                </Badge>
                              </td>
                              <td className="p-4">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handlePreview(doc)}
                                    data-testid={`button-preview-${doc.id}`}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDownload(doc)}
                                    data-testid={`button-download-${doc.id}`}
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDelete(doc.id, doc.file_name)}
                                    data-testid={`button-delete-${doc.id}`}
                                    disabled={deleteDocument.isPending}
                                  >
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
            onClick={() => setPreviewDocument(null)}
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
                    {fileSize > 0 && `${formatFileSize(fileSize)} - `}
                    Uploaded {new Date(previewDocument.created_at).toLocaleDateString()}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPreviewDocument(null)}
                  data-testid="button-close-preview"
                >
                  <X className="h-5 w-5" />
                </Button>
              </CardHeader>
              <CardContent className="overflow-auto max-h-[calc(90vh-120px)]">
                {mimeType.startsWith("image/") ? (
                  <img
                    src={previewDocument.url}
                    alt={previewDocument.file_name}
                    className="max-w-full h-auto mx-auto rounded-lg"
                  />
                ) : mimeType === "application/pdf" ? (
                  <iframe
                    src={previewDocument.url}
                    className="w-full h-[70vh] rounded-lg"
                    title={previewDocument.file_name}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <p>Preview not available for this file type</p>
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
