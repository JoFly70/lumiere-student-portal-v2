import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Enrollment } from "@shared/schema";

const courseEditSchema = z.object({
  providerId: z.string().min(1, "Provider is required"),
  courseCode: z.string().min(1, "Course code is required"),
  title: z.string().min(1, "Course title is required"),
  credits: z.coerce.number().min(1).max(6),
  courseUrl: z.string().url().optional().or(z.literal("")),
  notes: z.string().optional(),
  status: z.enum(["todo", "in_progress", "completed", "dropped"]),
});

type CourseEditData = z.infer<typeof courseEditSchema>;

interface CourseEditDialogProps {
  enrollment: Enrollment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CourseEditDialog({ enrollment, open, onOpenChange }: CourseEditDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<CourseEditData>({
    resolver: zodResolver(courseEditSchema),
    defaultValues: {
      providerId: enrollment.providerId || "",
      courseCode: enrollment.courseCode || "",
      title: enrollment.title || "",
      credits: enrollment.credits || 3,
      courseUrl: enrollment.courseUrl || "",
      notes: enrollment.notes || "",
      status: enrollment.status || "todo",
    },
  });

  // Reset form when enrollment changes
  useEffect(() => {
    form.reset({
      providerId: enrollment.providerId || "",
      courseCode: enrollment.courseCode || "",
      title: enrollment.title || "",
      credits: enrollment.credits || 3,
      courseUrl: enrollment.courseUrl || "",
      notes: enrollment.notes || "",
      status: enrollment.status || "todo",
    });
  }, [enrollment, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: CourseEditData) => {
      return await apiRequest("PUT", `/api/enrollments/${enrollment.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrollments"] });
      toast({
        title: "Course updated",
        description: "The course has been updated successfully.",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update course",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CourseEditData) => {
    updateMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="dialog-edit-course">
        <DialogHeader>
          <DialogTitle>Edit Course</DialogTitle>
          <DialogDescription>
            Update the details for {enrollment.title}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="providerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-provider-edit">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sophia">Sophia</SelectItem>
                        <SelectItem value="study-com">Study.com</SelectItem>
                        <SelectItem value="ace">ACE</SelectItem>
                        <SelectItem value="umpi">UMPI</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="courseCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Course Code</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., SOC-1010" {...field} data-testid="input-course-code-edit" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Course Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Introduction to Sociology" {...field} data-testid="input-course-title-edit" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="credits"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Credits</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" max="6" {...field} data-testid="input-credits-edit" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status-edit">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="todo">To Do</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="dropped">Dropped</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="courseUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Course URL (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://..." {...field} data-testid="input-course-url-edit" />
                  </FormControl>
                  <FormDescription>
                    Link to the course page or enrollment page
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Add any notes about this course..." 
                      {...field} 
                      data-testid="input-notes-edit"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-submit-edit"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
