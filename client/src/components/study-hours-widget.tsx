import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Clock, Plus } from "lucide-react";

/**
 * Get Monday of current week
 */
function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format date as readable string
 */
function formatWeekRange(weekOf: Date): string {
  const start = new Date(weekOf);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
}

const studyHoursSchema = z.object({
  hoursStudied: z.number().min(0, "Hours must be positive").max(168, "Max 168 hours per week"),
  notes: z.string().optional(),
});

type StudyHoursForm = z.infer<typeof studyHoursSchema>;

interface WeeklyMetric {
  id: string;
  userId: string;
  weekOf: string;
  hoursStudied: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function StudyHoursWidget() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const weekStart = getWeekStart();
  const weekOfStr = formatDate(weekStart);

  // Fetch current week's metrics
  const { data: weeklyMetric, isLoading } = useQuery<WeeklyMetric | { hoursStudied: number }>({
    queryKey: ["/api/weekly-metrics", weekOfStr],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/weekly-metrics/${weekOfStr}`);
      return await response.json();
    },
  });

  const form = useForm<StudyHoursForm>({
    resolver: zodResolver(studyHoursSchema),
    defaultValues: {
      hoursStudied: 0,
      notes: '',
    },
  });

  // Update form when data loads
  useEffect(() => {
    if (weeklyMetric) {
      form.reset({
        hoursStudied: weeklyMetric.hoursStudied || 0,
        notes: (weeklyMetric && 'notes' in weeklyMetric) ? (weeklyMetric.notes || '') : '',
      });
    }
  }, [weeklyMetric, form]);

  const upsertMutation = useMutation({
    mutationFn: async (data: StudyHoursForm) => {
      const response = await apiRequest("POST", "/api/weekly-metrics", {
        weekOf: weekOfStr,
        hoursStudied: data.hoursStudied,
        notes: data.notes || null,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to update study hours" }));
        throw new Error(errorData.error || "Failed to update study hours");
      }

      return await response.json();
    },
    onSuccess: () => {
      // Invalidate the exact query key to refetch current week's data
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-metrics", weekOfStr] });
      toast({
        title: "Study Hours Updated",
        description: `Logged ${form.getValues('hoursStudied')} hours for the week of ${formatWeekRange(weekStart)}`,
      });
      setDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    upsertMutation.mutate(data);
  });

  const currentHours = weeklyMetric?.hoursStudied || 0;

  return (
    <>
      <Card data-testid="card-study-hours">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">This Week Study Hours</CardTitle>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setDialogOpen(true)}
            data-testid="button-log-hours"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div>
              <div className="text-2xl font-bold" data-testid="text-hours-current">
                {currentHours}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatWeekRange(weekStart)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-log-study-hours">
          <DialogHeader>
            <DialogTitle>Log Study Hours</DialogTitle>
            <DialogDescription>
              Track your study hours for the week of {formatWeekRange(weekStart)}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField
                control={form.control}
                name="hoursStudied"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hours Studied This Week</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={168}
                        step={0.5}
                        placeholder="0"
                        data-testid="input-hours-studied"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add any notes about your study session..."
                        rows={3}
                        data-testid="input-hours-notes"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={upsertMutation.isPending}
                  data-testid="button-save-hours"
                >
                  {upsertMutation.isPending ? "Saving..." : "Save Hours"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
