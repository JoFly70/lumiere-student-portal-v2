import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Trash2, ExternalLink, GraduationCap, Building2, BookOpen, Save } from "lucide-react";
import { CourseEntryDialog } from "@/components/course-entry-dialog";
import { CourseEditDialog } from "@/components/course-edit-dialog";
import { CourseAssignmentDialog } from "@/components/course-assignment-dialog";
import { StudyHoursWidget } from "@/components/study-hours-widget";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Enrollment } from "@shared/schema";

const degreeOptions = [
  { value: "ba", label: "Bachelor of Arts (BA)" },
  { value: "bs", label: "Bachelor of Science (BS)" },
  { value: "bba", label: "Bachelor of Business Administration (BBA)" },
  { value: "bls", label: "Bachelor of Liberal Studies (BLS)" },
];

const majorOptions = [
  { value: "business_admin", label: "Business Administration" },
  { value: "management", label: "Management & Leadership" },
  { value: "accounting", label: "Accounting" },
  { value: "project_management", label: "Project Management" },
  { value: "info_systems", label: "Information Systems" },
  { value: "psychology", label: "Psychology" },
  { value: "english", label: "English" },
  { value: "history", label: "History" },
  { value: "political_science", label: "Political Science" },
  { value: "health_sciences", label: "Health Sciences" },
  { value: "applied_math", label: "Applied Mathematics" },
  { value: "computer_science", label: "Computer Science" },
];

const universityOptions = [
  { value: "umpi", label: "University of Maine at Presque Isle (UMPI)" },
  { value: "purdue_global", label: "Purdue University Global" },
  { value: "tesu", label: "Thomas Edison State University (NJ)" },
  { value: "wgu", label: "Western Governors University (WGU)" },
  { value: "peirce", label: "Peirce College" },
];

const providerColors: Record<string, string> = {
  "sophia": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  "study-com": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  "ace": "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  "umpi": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "other": "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

const providerNames: Record<string, string> = {
  "sophia": "Sophia",
  "study-com": "Study.com",
  "ace": "ACE",
  "umpi": "UMPI",
  "other": "Other",
};

const statusColors: Record<string, string> = {
  "todo": "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
  "in_progress": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "completed": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  "dropped": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const statusLabels: Record<string, string> = {
  "todo": "To Do",
  "in_progress": "In Progress",
  "completed": "Completed",
  "dropped": "Dropped",
};

export default function Roadmap() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingEnrollment, setEditingEnrollment] = useState<Enrollment | null>(null);
  
  const [degreeLevel, setDegreeLevel] = useState<string>("");
  const [major, setMajor] = useState<string>("");
  const [university, setUniversity] = useState<string>("");

  const { data: enrollments, isLoading } = useQuery<Enrollment[]>({
    queryKey: ["/api/enrollments"],
  });
  
  const handleSaveSelection = () => {
    toast({
      title: "Selection Saved",
      description: "Your degree program preferences have been saved.",
    });
  };

  const deleteMutation = useMutation({
    mutationFn: async (enrollmentId: string) => {
      return await apiRequest("DELETE", `/api/enrollments/${enrollmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrollments"] });
      toast({
        title: "Course deleted",
        description: "The course has been removed from your roadmap.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete course",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Are you sure you want to delete "${title}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  const groupedEnrollments = enrollments?.reduce((acc, enrollment: any) => {
    const providerKey = enrollment.provider?.key || "other";
    if (!acc[providerKey]) {
      acc[providerKey] = [];
    }
    acc[providerKey].push(enrollment);
    return acc;
  }, {} as Record<string, any[]>);

  const totalCredits = enrollments?.reduce((sum, e) => sum + (e.credits || 0), 0) || 0;
  const completedCredits = enrollments?.filter(e => e.status === "completed").reduce((sum, e) => sum + (e.credits || 0), 0) || 0;
  const inProgressCredits = enrollments?.filter(e => e.status === "in_progress").reduce((sum, e) => sum + (e.credits || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Degree Roadmap</h1>
          <p className="text-muted-foreground mt-1">Manage your degree progress and track your courses</p>
        </div>
        <div className="flex gap-2">
          <CourseAssignmentDialog />
          <CourseEntryDialog />
        </div>
      </div>

      <Card data-testid="card-program-selection">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Your Degree Plan</CardTitle>
          </div>
          <CardDescription>
            Select your target degree program to customize your roadmap
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                Degree Level
              </label>
              <Select value={degreeLevel} onValueChange={setDegreeLevel}>
                <SelectTrigger data-testid="select-degree-level">
                  <SelectValue placeholder="Select degree type" />
                </SelectTrigger>
                <SelectContent>
                  {degreeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                Major / Concentration
              </label>
              <Select value={major} onValueChange={setMajor}>
                <SelectTrigger data-testid="select-major">
                  <SelectValue placeholder="Select your major" />
                </SelectTrigger>
                <SelectContent>
                  {majorOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                University
              </label>
              <Select value={university} onValueChange={setUniversity}>
                <SelectTrigger data-testid="select-university">
                  <SelectValue placeholder="Select university" />
                </SelectTrigger>
                <SelectContent>
                  {universityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 flex flex-col justify-end">
              <Button 
                onClick={handleSaveSelection}
                className="w-full"
                disabled={!degreeLevel && !major && !university}
                data-testid="button-save-selection"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Selection
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Courses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-courses">{enrollments?.length || 0}</div>
            <p className="text-xs text-muted-foreground">{totalCredits} total credits</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-completed-courses">
              {enrollments?.filter(e => e.status === "completed").length || 0}
            </div>
            <p className="text-xs text-muted-foreground">{completedCredits} credits earned</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-inprogress-courses">
              {enrollments?.filter(e => e.status === "in_progress").length || 0}
            </div>
            <p className="text-xs text-muted-foreground">{inProgressCredits} credits underway</p>
          </CardContent>
        </Card>

        <StudyHoursWidget />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">Loading courses...</p>
          </CardContent>
        </Card>
      ) : enrollments && enrollments.length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedEnrollments || {}).map(([providerKey, courses]) => (
            <Card key={providerKey}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant="secondary" className={providerColors[providerKey]}>
                    {courses[0]?.provider?.name || providerNames[providerKey] || providerKey}
                  </Badge>
                  <span className="text-sm font-normal text-muted-foreground">
                    {courses.length} {courses.length === 1 ? "course" : "courses"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {courses.map((course) => (
                    <div
                      key={course.id}
                      className="flex items-start justify-between p-4 rounded-lg border hover-elevate"
                      data-testid={`card-course-${course.id}`}
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-semibold" data-testid={`text-course-code-${course.id}`}>
                            {course.courseCode || "N/A"}
                          </code>
                          <Badge variant="secondary" className={statusColors[course.status]}>
                            {statusLabels[course.status]}
                          </Badge>
                        </div>
                        <h4 className="font-medium" data-testid={`text-course-title-${course.id}`}>
                          {course.title}
                        </h4>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span data-testid={`text-credits-${course.id}`}>{course.credits} credits</span>
                          {course.courseUrl && (
                            <a
                              href={course.courseUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-primary hover:underline"
                              data-testid={`link-course-url-${course.id}`}
                            >
                              Course Link
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        {course.notes && (
                          <p className="text-sm text-muted-foreground mt-2" data-testid={`text-notes-${course.id}`}>
                            {course.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditingEnrollment(course)}
                          data-testid={`button-edit-${course.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(course.id, course.title)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${course.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <p className="text-muted-foreground">No courses added yet</p>
              <p className="text-sm text-muted-foreground">
                Click the "Add Course" button above to start building your roadmap
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {editingEnrollment && (
        <CourseEditDialog
          enrollment={editingEnrollment}
          open={!!editingEnrollment}
          onOpenChange={(open) => !open && setEditingEnrollment(null)}
        />
      )}
    </div>
  );
}
