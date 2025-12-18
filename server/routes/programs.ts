import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

const degreeProgramSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  description: z.string().optional(),
  total_credits_required: z.number().int().positive().default(120),
  core_credits_required: z.number().int().positive().default(60),
  elective_credits_required: z.number().int().positive().default(60),
  is_active: z.boolean().default(true),
});

const courseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  credits: z.number().int().positive().default(3),
  description: z.string().optional(),
  url: z.string().url().optional().or(z.literal('')),
  est_completion_hours: z.number().int().positive().default(40),
  difficulty_level: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
  is_active: z.boolean().default(true),
});

const programCourseSchema = z.object({
  program_id: z.string().uuid(),
  course_id: z.string().uuid(),
  requirement_type: z.enum(['core', 'elective', 'prerequisite']).default('core'),
  semester_recommended: z.number().int().positive().default(1),
});

const enrollmentSchema = z.object({
  student_id: z.string().uuid(),
  program_id: z.string().uuid(),
  expected_completion_date: z.string().optional(),
  status: z.enum(['active', 'completed', 'withdrawn']).default('active'),
});

router.get('/programs', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('degree_programs')
      .select('*')
      .order('name');

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error fetching degree programs:', error);
    res.status(500).json({ error: 'Failed to fetch degree programs' });
  }
});

router.get('/programs/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('degree_programs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Program not found' });

    res.json(data);
  } catch (error) {
    console.error('Error fetching degree program:', error);
    res.status(500).json({ error: 'Failed to fetch degree program' });
  }
});

router.post('/programs', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const validatedData = degreeProgramSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('degree_programs')
      .insert(validatedData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating degree program:', error);
    res.status(500).json({ error: 'Failed to create degree program' });
  }
});

router.put('/programs/:id', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const validatedData = degreeProgramSchema.partial().parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('degree_programs')
      .update(validatedData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating degree program:', error);
    res.status(500).json({ error: 'Failed to update degree program' });
  }
});

router.delete('/programs/:id', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('degree_programs')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting degree program:', error);
    res.status(500).json({ error: 'Failed to delete degree program' });
  }
});

router.get('/courses', requireAuth, async (req, res) => {
  try {
    const { provider } = req.query;

    let query = supabaseAdmin.from('courses').select('*');

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { data, error } = await query.order('name');

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.get('/courses/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('courses')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Course not found' });

    res.json(data);
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

router.post('/courses', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const validatedData = courseSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('courses')
      .insert(validatedData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating course:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/courses/:id', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const validatedData = courseSchema.partial().parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('courses')
      .update(validatedData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating course:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.delete('/courses/:id', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('courses')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

router.get('/programs/:programId/courses', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('program_courses')
      .select(`
        *,
        course:courses(*)
      `)
      .eq('program_id', req.params.programId)
      .order('semester_recommended');

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error fetching program courses:', error);
    res.status(500).json({ error: 'Failed to fetch program courses' });
  }
});

router.post('/programs/:programId/courses', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const validatedData = programCourseSchema.parse({
      ...req.body,
      program_id: req.params.programId,
    });

    const { data, error } = await supabaseAdmin
      .from('program_courses')
      .insert(validatedData)
      .select(`
        *,
        course:courses(*)
      `)
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error adding course to program:', error);
    res.status(500).json({ error: 'Failed to add course to program' });
  }
});

router.delete('/programs/:programId/courses/:courseId', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('program_courses')
      .delete()
      .eq('program_id', req.params.programId)
      .eq('course_id', req.params.courseId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    console.error('Error removing course from program:', error);
    res.status(500).json({ error: 'Failed to remove course from program' });
  }
});

router.get('/enrollments', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    let query = supabaseAdmin
      .from('student_program_enrollments')
      .select(`
        *,
        program:degree_programs(*)
      `);

    if (user?.role !== 'admin' && user?.role !== 'staff') {
      query = query.eq('student_id', user?.id);
    }

    const { data, error } = await query.order('enrollment_date', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

router.post('/enrollments', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const validatedData = enrollmentSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('student_program_enrollments')
      .insert(validatedData)
      .select(`
        *,
        program:degree_programs(*)
      `)
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating enrollment:', error);
    res.status(500).json({ error: 'Failed to create enrollment' });
  }
});

router.put('/enrollments/:id', requireAuth, requireRole(['admin', 'staff']), async (req, res) => {
  try {
    const validatedData = enrollmentSchema.partial().parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('student_program_enrollments')
      .update(validatedData)
      .eq('id', req.params.id)
      .select(`
        *,
        program:degree_programs(*)
      `)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating enrollment:', error);
    res.status(500).json({ error: 'Failed to update enrollment' });
  }
});

export default router;
