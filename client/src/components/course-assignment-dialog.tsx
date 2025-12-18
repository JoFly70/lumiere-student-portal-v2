import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BookPlus, CheckCircle2, Clock } from "lucide-react";
import type { CourseTemplate } from "@shared/schema";

interface AssignmentResponse {
  success: boolean;
  assigned: number;
  skipped: number;
  enrollments: any[];
}

export function CourseAssignmentDialog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<CourseTemplate[]>({
    queryKey: ["/api/templates"],
    enabled: open,
  });

  const selectedTemplate = templates?.find(t => t.id === selectedTemplateId);

  const assignMutation = useMutation({
    mutationFn: async (templateId: string): Promise<AssignmentResponse> => {
      const template = templates?.find(t => t.id === templateId);
      if (!template) {
        throw new Error("Template not found");
      }

      // Server derives user ID from auth token - no need to send it
      const response = await apiRequest("POST", "/api/assignments", {
        courses: template.courses
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to assign courses" }));
        throw new Error(errorData.error || "Failed to assign courses");
      }
      
      return await response.json();
    },
    onSuccess: (data: AssignmentResponse) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrollments"] });
      
      const skippedMessage = data.skipped > 0 
        ? ` (${data.skipped} already enrolled)`
        : "";
      
      toast({
        title: "Courses assigned successfully",
        description: `Added ${data.assigned} courses to your roadmap${skippedMessage}`,
      });
      
      setOpen(false);
      setSelectedTemplateId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign courses",
        variant: "destructive",
      });
    },
  });

  const handleAssign = () => {
    if (selectedTemplateId) {
      assignMutation.mutate(selectedTemplateId);
    }
  };

  const providerLabels: Record<string, string> = {
    "sophia": "Sophia",
    "study-com": "Study.com",
    "ace": "ACE",
    "umpi": "UMPI",
    "other": "Other",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-assign-template">
          <BookPlus className="w-4 h-4 mr-2" />
          Assign from Template
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh]" data-testid="dialog-assign-courses">
        <DialogHeader>
          <DialogTitle>Assign Courses from Template</DialogTitle>
          <DialogDescription>
            Select a pre-built course template to quickly add multiple courses to your roadmap.
            Courses will be added to your account with status set to To Do.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading templates...</div>
        ) : !templates || templates.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No templates available</div>
        ) : (
          <div className="space-y-4">
            {/* Template Selection */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Select Template</h3>
              <ScrollArea className="h-[200px] pr-4">
                <div className="space-y-2">
                  {templates.map((template) => (
                    <Card
                      key={template.id}
                      className={`cursor-pointer transition-colors ${
                        selectedTemplateId === template.id
                          ? "border-primary bg-accent"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() => setSelectedTemplateId(template.id)}
                      data-testid={`template-card-${template.id}`}
                    >
                      <CardHeader className="p-4 space-y-1">
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-base">
                            {template.name}
                            {template.isDefault && (
                              <Badge variant="secondary" className="ml-2">Default</Badge>
                            )}
                          </CardTitle>
                          {selectedTemplateId === template.id && (
                            <CheckCircle2 className="w-5 h-5 text-primary" />
                          )}
                        </div>
                        {template.description && (
                          <CardDescription className="text-xs">
                            {template.description}
                          </CardDescription>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <Badge variant="outline" className="text-xs">
                            {(template.courses as any[]).length} courses
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {(template.courses as any[]).reduce((sum: number, c: any) => sum + (c.credits || 0), 0)} credits
                          </Badge>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {selectedTemplate && (
              <>
                <Separator />

                {/* Course Preview */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">
                    Courses to Assign ({(selectedTemplate.courses as any[]).length})
                  </h3>
                  <ScrollArea className="h-[200px] pr-4">
                    <div className="space-y-2">
                      {(selectedTemplate.courses as any[]).map((course: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-start justify-between p-3 border rounded-lg"
                          data-testid={`preview-course-${idx}`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">
                                {providerLabels[course.providerId] || course.providerId}
                              </Badge>
                              <code className="text-xs font-mono">{course.courseCode}</code>
                            </div>
                            <p className="text-sm font-medium mt-1">{course.title}</p>
                          </div>
                          <div className="text-right ml-4">
                            <div className="text-sm font-semibold">{course.credits}</div>
                            <div className="text-xs text-muted-foreground">credits</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              setSelectedTemplateId(null);
            }}
            data-testid="button-cancel-assignment"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedTemplateId || assignMutation.isPending}
            data-testid="button-confirm-assignment"
          >
            {assignMutation.isPending ? (
              <>
                <Clock className="w-4 h-4 mr-2 animate-spin" />
                Assigning...
              </>
            ) : (
              <>Assign Courses</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
