import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import {
  GraduationCap,
  BookOpen,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Search,
} from "lucide-react";

interface DegreeProgram {
  id: string;
  name: string;
  code: string;
  description: string;
  total_credits_required: number;
  core_credits_required: number;
  elective_credits_required: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Course {
  id: string;
  code: string;
  name: string;
  provider: string;
  credits: number;
  description: string;
  url: string;
  est_completion_hours: number;
  difficulty_level: 'beginner' | 'intermediate' | 'advanced';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function ProgramsManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchPrograms, setSearchPrograms] = useState("");
  const [searchCourses, setSearchCourses] = useState("");
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<DegreeProgram | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const [programForm, setProgramForm] = useState({
    name: "",
    code: "",
    description: "",
    total_credits_required: 120,
    core_credits_required: 60,
    elective_credits_required: 60,
    is_active: true,
  });

  const [courseForm, setCourseForm] = useState({
    code: "",
    name: "",
    provider: "Sophia",
    credits: 3,
    description: "",
    url: "",
    est_completion_hours: 40,
    difficulty_level: "intermediate" as 'beginner' | 'intermediate' | 'advanced',
    is_active: true,
  });

  const { data: programs, isLoading: loadingPrograms } = useQuery<DegreeProgram[]>({
    queryKey: ['programs'],
    queryFn: async () => apiRequest('/api/programs'),
  });

  const { data: courses, isLoading: loadingCourses } = useQuery<Course[]>({
    queryKey: ['courses'],
    queryFn: async () => apiRequest('/api/courses'),
  });

  const createProgram = useMutation({
    mutationFn: async (data: typeof programForm) => {
      return apiRequest('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      toast({ title: "Program created successfully" });
      setProgramDialogOpen(false);
      resetProgramForm();
    },
    onError: () => {
      toast({ title: "Failed to create program", variant: "destructive" });
    },
  });

  const updateProgram = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof programForm }) => {
      return apiRequest(`/api/programs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      toast({ title: "Program updated successfully" });
      setProgramDialogOpen(false);
      setEditingProgram(null);
      resetProgramForm();
    },
    onError: () => {
      toast({ title: "Failed to update program", variant: "destructive" });
    },
  });

  const deleteProgram = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/programs/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      toast({ title: "Program deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete program", variant: "destructive" });
    },
  });

  const createCourse = useMutation({
    mutationFn: async (data: typeof courseForm) => {
      return apiRequest('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      toast({ title: "Course created successfully" });
      setCourseDialogOpen(false);
      resetCourseForm();
    },
    onError: () => {
      toast({ title: "Failed to create course", variant: "destructive" });
    },
  });

  const updateCourse = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof courseForm }) => {
      return apiRequest(`/api/courses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      toast({ title: "Course updated successfully" });
      setCourseDialogOpen(false);
      setEditingCourse(null);
      resetCourseForm();
    },
    onError: () => {
      toast({ title: "Failed to update course", variant: "destructive" });
    },
  });

  const deleteCourse = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/courses/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      toast({ title: "Course deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete course", variant: "destructive" });
    },
  });

  const resetProgramForm = () => {
    setProgramForm({
      name: "",
      code: "",
      description: "",
      total_credits_required: 120,
      core_credits_required: 60,
      elective_credits_required: 60,
      is_active: true,
    });
  };

  const resetCourseForm = () => {
    setCourseForm({
      code: "",
      name: "",
      provider: "Sophia",
      credits: 3,
      description: "",
      url: "",
      est_completion_hours: 40,
      difficulty_level: "intermediate",
      is_active: true,
    });
  };

  const handleEditProgram = (program: DegreeProgram) => {
    setEditingProgram(program);
    setProgramForm({
      name: program.name,
      code: program.code,
      description: program.description,
      total_credits_required: program.total_credits_required,
      core_credits_required: program.core_credits_required,
      elective_credits_required: program.elective_credits_required,
      is_active: program.is_active,
    });
    setProgramDialogOpen(true);
  };

  const handleEditCourse = (course: Course) => {
    setEditingCourse(course);
    setCourseForm({
      code: course.code,
      name: course.name,
      provider: course.provider,
      credits: course.credits,
      description: course.description,
      url: course.url,
      est_completion_hours: course.est_completion_hours,
      difficulty_level: course.difficulty_level,
      is_active: course.is_active,
    });
    setCourseDialogOpen(true);
  };

  const handleSaveProgram = () => {
    if (editingProgram) {
      updateProgram.mutate({ id: editingProgram.id, data: programForm });
    } else {
      createProgram.mutate(programForm);
    }
  };

  const handleSaveCourse = () => {
    if (editingCourse) {
      updateCourse.mutate({ id: editingCourse.id, data: courseForm });
    } else {
      createCourse.mutate(courseForm);
    }
  };

  const filteredPrograms = programs?.filter(p =>
    p.name.toLowerCase().includes(searchPrograms.toLowerCase()) ||
    p.code.toLowerCase().includes(searchPrograms.toLowerCase())
  );

  const filteredCourses = courses?.filter(c =>
    c.name.toLowerCase().includes(searchCourses.toLowerCase()) ||
    c.code.toLowerCase().includes(searchCourses.toLowerCase())
  );

  return (
    <Tabs defaultValue="programs" className="space-y-4">
      <TabsList>
        <TabsTrigger value="programs">
          <GraduationCap className="w-4 h-4 mr-2" />
          Degree Programs
        </TabsTrigger>
        <TabsTrigger value="courses">
          <BookOpen className="w-4 h-4 mr-2" />
          Courses
        </TabsTrigger>
      </TabsList>

      <TabsContent value="programs" className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Degree Programs</CardTitle>
                <CardDescription>Manage degree programs and requirements</CardDescription>
              </div>
              <Dialog open={programDialogOpen} onOpenChange={(open) => {
                setProgramDialogOpen(open);
                if (!open) {
                  setEditingProgram(null);
                  resetProgramForm();
                }
              }}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Program
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingProgram ? 'Edit Program' : 'Create Program'}</DialogTitle>
                    <DialogDescription>
                      {editingProgram ? 'Update program details' : 'Add a new degree program'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name">Program Name</Label>
                        <Input
                          id="name"
                          value={programForm.name}
                          onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })}
                          placeholder="Bachelor of Science in Business"
                        />
                      </div>
                      <div>
                        <Label htmlFor="code">Program Code</Label>
                        <Input
                          id="code"
                          value={programForm.code}
                          onChange={(e) => setProgramForm({ ...programForm, code: e.target.value })}
                          placeholder="BS-BUS"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={programForm.description}
                        onChange={(e) => setProgramForm({ ...programForm, description: e.target.value })}
                        placeholder="Program description..."
                        rows={3}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="total_credits">Total Credits</Label>
                        <Input
                          id="total_credits"
                          type="number"
                          value={programForm.total_credits_required}
                          onChange={(e) => setProgramForm({ ...programForm, total_credits_required: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="core_credits">Core Credits</Label>
                        <Input
                          id="core_credits"
                          type="number"
                          value={programForm.core_credits_required}
                          onChange={(e) => setProgramForm({ ...programForm, core_credits_required: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="elective_credits">Elective Credits</Label>
                        <Input
                          id="elective_credits"
                          type="number"
                          value={programForm.elective_credits_required}
                          onChange={(e) => setProgramForm({ ...programForm, elective_credits_required: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="is_active"
                        checked={programForm.is_active}
                        onChange={(e) => setProgramForm({ ...programForm, is_active: e.target.checked })}
                        className="rounded"
                      />
                      <Label htmlFor="is_active">Active</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setProgramDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveProgram} disabled={createProgram.isPending || updateProgram.isPending}>
                      {(createProgram.isPending || updateProgram.isPending) && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Save
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search programs..."
                  value={searchPrograms}
                  onChange={(e) => setSearchPrograms(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            {loadingPrograms ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrograms?.map((program) => (
                    <TableRow key={program.id}>
                      <TableCell className="font-mono">{program.code}</TableCell>
                      <TableCell>{program.name}</TableCell>
                      <TableCell>{program.total_credits_required}</TableCell>
                      <TableCell>
                        <Badge variant={program.is_active ? "default" : "secondary"}>
                          {program.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEditProgram(program)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this program?')) {
                                deleteProgram.mutate(program.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="courses" className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Courses</CardTitle>
                <CardDescription>Manage course catalog</CardDescription>
              </div>
              <Dialog open={courseDialogOpen} onOpenChange={(open) => {
                setCourseDialogOpen(open);
                if (!open) {
                  setEditingCourse(null);
                  resetCourseForm();
                }
              }}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Course
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingCourse ? 'Edit Course' : 'Create Course'}</DialogTitle>
                    <DialogDescription>
                      {editingCourse ? 'Update course details' : 'Add a new course to the catalog'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="course_code">Course Code</Label>
                        <Input
                          id="course_code"
                          value={courseForm.code}
                          onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })}
                          placeholder="BUS101"
                        />
                      </div>
                      <div>
                        <Label htmlFor="course_provider">Provider</Label>
                        <Select value={courseForm.provider} onValueChange={(value) => setCourseForm({ ...courseForm, provider: value })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Sophia">Sophia</SelectItem>
                            <SelectItem value="Study.com">Study.com</SelectItem>
                            <SelectItem value="Coursera">Coursera</SelectItem>
                            <SelectItem value="UMPI">UMPI</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="course_name">Course Name</Label>
                      <Input
                        id="course_name"
                        value={courseForm.name}
                        onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })}
                        placeholder="Introduction to Business"
                      />
                    </div>
                    <div>
                      <Label htmlFor="course_description">Description</Label>
                      <Textarea
                        id="course_description"
                        value={courseForm.description}
                        onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                        placeholder="Course description..."
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label htmlFor="course_url">Course URL</Label>
                      <Input
                        id="course_url"
                        type="url"
                        value={courseForm.url}
                        onChange={(e) => setCourseForm({ ...courseForm, url: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="credits">Credits</Label>
                        <Input
                          id="credits"
                          type="number"
                          value={courseForm.credits}
                          onChange={(e) => setCourseForm({ ...courseForm, credits: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="est_hours">Est. Hours</Label>
                        <Input
                          id="est_hours"
                          type="number"
                          value={courseForm.est_completion_hours}
                          onChange={(e) => setCourseForm({ ...courseForm, est_completion_hours: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="difficulty">Difficulty</Label>
                        <Select value={courseForm.difficulty_level} onValueChange={(value: any) => setCourseForm({ ...courseForm, difficulty_level: value })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="beginner">Beginner</SelectItem>
                            <SelectItem value="intermediate">Intermediate</SelectItem>
                            <SelectItem value="advanced">Advanced</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="course_is_active"
                        checked={courseForm.is_active}
                        onChange={(e) => setCourseForm({ ...courseForm, is_active: e.target.checked })}
                        className="rounded"
                      />
                      <Label htmlFor="course_is_active">Active</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCourseDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveCourse} disabled={createCourse.isPending || updateCourse.isPending}>
                      {(createCourse.isPending || updateCourse.isPending) && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Save
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search courses..."
                  value={searchCourses}
                  onChange={(e) => setSearchCourses(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            {loadingCourses ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCourses?.map((course) => (
                    <TableRow key={course.id}>
                      <TableCell className="font-mono">{course.code}</TableCell>
                      <TableCell>{course.name}</TableCell>
                      <TableCell>{course.provider}</TableCell>
                      <TableCell>{course.credits}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{course.difficulty_level}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={course.is_active ? "default" : "secondary"}>
                          {course.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEditCourse(course)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this course?')) {
                                deleteCourse.mutate(course.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
