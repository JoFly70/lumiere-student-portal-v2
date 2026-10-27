import { z } from "zod";

const courseFields = {
  providerId: z.string().min(1, "Provider is required"),
  courseCode: z.string().min(1, "Course code is required"),
  title: z.string().min(1, "Course title is required"),
  credits: z.coerce.number<number | string>().min(1).max(6),
  courseUrl: z.string().url().optional().or(z.literal("")),
  notes: z.string().optional(),
};

export const courseFormSchema = z.object({
  ...courseFields,
  // "completed" is recorded by staff, not self-reported.
  status: z.enum(["todo", "in_progress", "dropped"]).default("todo"),
});

export const courseEditSchema = z.object({
  ...courseFields,
  status: z.enum(["todo", "in_progress", "completed", "dropped"]),
});
