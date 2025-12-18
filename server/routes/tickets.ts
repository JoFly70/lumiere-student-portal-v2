/**
 * Support Ticket System Routes
 * Jira-like ticketing for student support
 */

import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { asyncHandler } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { requireRole, requireOwnerOrAdmin } from '../middleware/rbac';
import { auditAuth, auditAdmin } from '../lib/audit';
import {
  sendTicketCreatedEmailToStaff,
  sendTicketStatusUpdateEmail,
  sendNewCommentEmail,
} from '../lib/email';

const router = Router();

// Validation schemas
const createTicketSchema = z.object({
  subject: z.string().min(5).max(200),
  description: z.string().min(10).max(5000),
  category: z.enum(['academic', 'technical', 'billing', 'document', 'enrollment', 'general']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  isInternal: z.boolean().default(false),
});

const updateTicketSchema = z.object({
  subject: z.string().min(5).max(200).optional(),
  description: z.string().min(10).max(5000).optional(),
  status: z.enum(['open', 'in_progress', 'waiting_on_student', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  resolutionNotes: z.string().max(2000).optional(),
});

/**
 * GET /api/tickets
 * List all tickets (filtered by user role)
 */
router.get('/', requireAuth, asyncHandler(async (req: any, res) => {
  const user = req.user;
  const {
    status,
    category,
    priority,
    search,
    assignedTo,
    limit = 50,
    offset = 0,
  } = req.query;

  try {
    let query = supabaseAdmin
      .from('support_tickets')
      .select(`
        *,
        ticket_comments(count),
        ticket_attachments(count)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    // Filter by status
    if (status) {
      query = query.eq('status', status);
    }

    // Filter by category
    if (category) {
      query = query.eq('category', category);
    }

    // Filter by priority
    if (priority) {
      query = query.eq('priority', priority);
    }

    // Filter by assigned user (admin only)
    if (assignedTo && ['admin', 'coach', 'staff'].includes(user.role)) {
      query = query.eq('assigned_to', assignedTo);
    }

    // Search in subject and description
    if (search) {
      query = query.textSearch('subject', search, { type: 'websearch' });
    }

    // Students only see their own tickets (enforced by RLS, but explicit here)
    if (user.role === 'student') {
      query = query.eq('reporter_id', user.id);
    }

    const { data: tickets, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch tickets', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch tickets' });
    }

    res.json({
      tickets,
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching tickets', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * GET /api/tickets/:id
 * Get ticket details with comments and attachments
 */
router.get('/:id', requireAuth, asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    const { data: ticket, error } = await supabaseAdmin
      .from('support_tickets')
      .select(`
        *,
        ticket_comments(*),
        ticket_attachments(*),
        ticket_status_history(*)
      `)
      .eq('id', id)
      .single();

    if (error || !ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Check access: students can only view their own tickets
    if (user.role === 'student' && ticket.reporter_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Filter out internal comments for students
    if (user.role === 'student') {
      ticket.ticket_comments = ticket.ticket_comments.filter(
        (comment: any) => !comment.is_internal
      );
    }

    res.json({ ticket });
  } catch (error: any) {
    logger.error('Error fetching ticket', { error: error.message, ticketId: id });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * POST /api/tickets
 * Create a new support ticket
 */
router.post('/', requireAuth, asyncHandler(async (req: any, res) => {
  const user = req.user;

  const validation = createTicketSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.error.errors,
    });
  }

  const { subject, description, category, priority } = validation.data;

  try {
    // Create ticket
    const { data: ticket, error } = await supabaseAdmin
      .from('support_tickets')
      .insert({
        reporter_id: user.id,
        reporter_name: user.name || user.email,
        reporter_email: user.email,
        subject,
        description,
        category,
        priority,
        status: 'open',
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create ticket', { error: error.message });
      return res.status(500).json({ error: 'Failed to create ticket' });
    }

    // Create initial comment (the description)
    await supabaseAdmin
      .from('ticket_comments')
      .insert({
        ticket_id: ticket.id,
        author_id: user.id,
        author_name: user.name || user.email,
        author_role: user.role,
        content: description,
        is_internal: false,
      });

    // Audit log
    await auditAuth(
      'system.maintenance_mode', // Using generic type for now
      user.id,
      `Created support ticket ${ticket.ticket_number}: ${subject}`,
      {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        category,
        priority,
      }
    );

    logger.info('Ticket created', {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      userId: user.id,
    });

    sendTicketCreatedEmailToStaff({
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      studentName: user.name || user.email,
      studentEmail: user.email,
    }).catch(err => logger.error('Failed to send ticket creation email', { error: err.message }));

    res.status(201).json({ ticket });
  } catch (error: any) {
    logger.error('Error creating ticket', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * PATCH /api/tickets/:id
 * Update ticket (status, assignment, etc.)
 * Admin/Staff only for most fields
 */
router.patch('/:id', requireAuth, asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const user = req.user;

  const validation = updateTicketSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.error.errors,
    });
  }

  const updates = validation.data;

  try {
    // Get current ticket
    const { data: currentTicket, error: fetchError } = await supabaseAdmin
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Access control
    const isStaff = ['admin', 'coach', 'staff'].includes(user.role);
    const isReporter = currentTicket.reporter_id === user.id;

    // Students can only update their own open tickets (limited fields)
    if (user.role === 'student') {
      if (!isReporter) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (currentTicket.status !== 'open' || currentTicket.assigned_to) {
        return res.status(403).json({ error: 'Cannot update assigned or non-open tickets' });
      }
      // Students can only update subject and description
      if (updates.status || updates.assignedTo !== undefined || updates.resolutionNotes) {
        return res.status(403).json({ error: 'Students cannot modify these fields' });
      }
    }

    // Build update object
    const updateData: any = {};
    if (updates.subject) updateData.subject = updates.subject;
    if (updates.description) updateData.description = updates.description;
    if (updates.priority) updateData.priority = updates.priority;

    // Staff-only updates
    if (isStaff) {
      if (updates.status) {
        updateData.status = updates.status;
        if (updates.status === 'resolved' || updates.status === 'closed') {
          updateData.resolved_at = new Date().toISOString();
          updateData.resolved_by = user.id;
          if (updates.resolutionNotes) {
            updateData.resolution_notes = updates.resolutionNotes;
          }
        }
      }
      if (updates.assignedTo !== undefined) {
        updateData.assigned_to = updates.assignedTo;
        updateData.assigned_at = updates.assignedTo ? new Date().toISOString() : null;
      }
    }

    // Update ticket
    const { data: updatedTicket, error: updateError } = await supabaseAdmin
      .from('support_tickets')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      logger.error('Failed to update ticket', { error: updateError.message });
      return res.status(500).json({ error: 'Failed to update ticket' });
    }

    // Audit log for staff actions
    if (isStaff && updates.status) {
      await auditAdmin(
        'admin.bulk_operation',
        user.id,
        currentTicket.reporter_id,
        `Changed ticket ${currentTicket.ticket_number} status: ${currentTicket.status} → ${updates.status}`,
        { ticketId: id, oldStatus: currentTicket.status, newStatus: updates.status }
      );
    }

    logger.info('Ticket updated', {
      ticketId: id,
      ticketNumber: currentTicket.ticket_number,
      userId: user.id,
      changes: Object.keys(updateData),
    });

    if (updates.status && updates.status !== currentTicket.status) {
      sendTicketStatusUpdateEmail(currentTicket.reporter_email, {
        ticketNumber: currentTicket.ticket_number,
        subject: currentTicket.subject,
        status: updates.status,
        studentName: currentTicket.reporter_name,
      }).catch(err => logger.error('Failed to send status update email', { error: err.message }));
    }

    res.json({ ticket: updatedTicket });
  } catch (error: any) {
    logger.error('Error updating ticket', { error: error.message, ticketId: id });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * POST /api/tickets/:id/comments
 * Add a comment to a ticket
 */
router.post('/:id/comments', requireAuth, asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const user = req.user;

  const validation = createCommentSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.error.errors,
    });
  }

  const { content, isInternal } = validation.data;

  try {
    // Verify ticket exists and user has access
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('support_tickets')
      .select('id, reporter_id, ticket_number, subject, reporter_name, reporter_email')
      .eq('id', id)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Check access
    const isStaff = ['admin', 'coach', 'staff'].includes(user.role);
    const isReporter = ticket.reporter_id === user.id;

    if (!isStaff && !isReporter) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only staff can create internal notes
    const shouldBeInternal = isInternal && isStaff;

    // Create comment
    const { data: comment, error: commentError } = await supabaseAdmin
      .from('ticket_comments')
      .insert({
        ticket_id: id,
        author_id: user.id,
        author_name: user.name || user.email,
        author_role: user.role,
        content,
        is_internal: shouldBeInternal,
      })
      .select()
      .single();

    if (commentError) {
      logger.error('Failed to create comment', { error: commentError.message });
      return res.status(500).json({ error: 'Failed to create comment' });
    }

    // Update ticket's updated_at timestamp
    await supabaseAdmin
      .from('support_tickets')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);

    logger.info('Comment added to ticket', {
      ticketId: id,
      commentId: comment.id,
      userId: user.id,
      isInternal: shouldBeInternal,
    });

    if (!shouldBeInternal) {
      if (isReporter && !isStaff) {
        sendNewCommentEmail(ticket.reporter_email, {
          ticketNumber: ticket.ticket_number,
          subject: ticket.subject,
          commentBy: user.name || user.email,
          comment: content,
          studentName: ticket.reporter_name,
        }, true).catch(err => logger.error('Failed to send comment email to staff', { error: err.message }));
      } else if (isStaff) {
        sendNewCommentEmail(ticket.reporter_email, {
          ticketNumber: ticket.ticket_number,
          subject: ticket.subject,
          commentBy: user.name || user.email,
          comment: content,
          studentName: ticket.reporter_name,
        }, false).catch(err => logger.error('Failed to send comment email to student', { error: err.message }));
      }
    }

    res.status(201).json({ comment });
  } catch (error: any) {
    logger.error('Error creating comment', { error: error.message, ticketId: id });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * GET /api/tickets/stats/summary
 * Get ticket statistics (for dashboard)
 * Staff only
 */
router.get('/stats/summary', requireRole(['admin', 'coach', 'staff']), asyncHandler(async (req: any, res) => {
  try {
    // Get counts by status
    const { data: statusCounts } = await supabaseAdmin
      .from('support_tickets')
      .select('status')
      .then(result => {
        const counts = {
          open: 0,
          in_progress: 0,
          waiting_on_student: 0,
          resolved: 0,
          closed: 0,
        };
        if (result.data) {
          result.data.forEach((ticket: any) => {
            counts[ticket.status as keyof typeof counts]++;
          });
        }
        return { data: counts };
      });

    // Get counts by category
    const { data: categoryCounts } = await supabaseAdmin
      .from('support_tickets')
      .select('category')
      .then(result => {
        const counts: Record<string, number> = {};
        if (result.data) {
          result.data.forEach((ticket: any) => {
            counts[ticket.category] = (counts[ticket.category] || 0) + 1;
          });
        }
        return { data: counts };
      });

    // Get average resolution time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: resolvedTickets } = await supabaseAdmin
      .from('support_tickets')
      .select('created_at, resolved_at')
      .in('status', ['resolved', 'closed'])
      .gte('resolved_at', thirtyDaysAgo.toISOString());

    let avgResolutionHours = 0;
    if (resolvedTickets && resolvedTickets.length > 0) {
      const totalHours = resolvedTickets.reduce((sum: number, ticket: any) => {
        const created = new Date(ticket.created_at);
        const resolved = new Date(ticket.resolved_at);
        const hours = (resolved.getTime() - created.getTime()) / (1000 * 60 * 60);
        return sum + hours;
      }, 0);
      avgResolutionHours = Math.round(totalHours / resolvedTickets.length);
    }

    res.json({
      stats: {
        byStatus: statusCounts,
        byCategory: categoryCounts,
        avgResolutionHours,
        resolvedLast30Days: resolvedTickets?.length || 0,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching ticket stats', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * POST /api/tickets/:ticketId/attachments/upload-url
 * Generate presigned upload URL for ticket attachment
 */
router.post('/:ticketId/attachments/upload-url', requireAuth, asyncHandler(async (req: any, res) => {
  const { ticketId } = req.params;
  const user = req.user;

  try {
    const schema = z.object({
      file_name: z.string().min(1).max(255),
      file_size: z.number().int().positive().max(10485760), // 10MB max
      file_type: z.string(),
    });

    const validated = schema.parse(req.body);

    // Verify user has access to this ticket
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('support_tickets')
      .select('id, reporter_id')
      .eq('id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Check authorization
    if (user.role === 'student' && ticket.reporter_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Generate unique storage path
    const fileExt = validated.file_name.split('.').pop();
    const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const storagePath = `tickets/${ticketId}/${uniqueFileName}`;

    // Generate presigned upload URL (valid for 5 minutes)
    const { data: uploadData, error: uploadError } = await supabaseAdmin
      .storage
      .from('documents')
      .createSignedUploadUrl(storagePath);

    if (uploadError || !uploadData) {
      logger.error('Failed to generate upload URL', { error: uploadError });
      return res.status(500).json({ error: 'Failed to generate upload URL' });
    }

    // Get public URL for the file
    const { data: { publicUrl } } = supabaseAdmin
      .storage
      .from('documents')
      .getPublicUrl(storagePath);

    res.json({
      uploadUrl: uploadData.signedUrl,
      storagePath,
      publicUrl,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Generate attachment upload URL error', {
      ticketId,
      error,
    });
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
}));

/**
 * POST /api/tickets/:ticketId/attachments
 * Create attachment record after successful upload
 */
router.post('/:ticketId/attachments', requireAuth, asyncHandler(async (req: any, res) => {
  const { ticketId } = req.params;
  const user = req.user;

  try {
    const schema = z.object({
      file_name: z.string(),
      file_size: z.number().int().positive(),
      file_type: z.string(),
      storage_path: z.string(),
      comment_id: z.string().uuid().optional().nullable(),
    });

    const validated = schema.parse(req.body);

    // Verify user has access to this ticket
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('support_tickets')
      .select('id, reporter_id')
      .eq('id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Check authorization
    if (user.role === 'student' && ticket.reporter_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create attachment record
    const { data: attachment, error } = await supabaseAdmin
      .from('ticket_attachments')
      .insert({
        ticket_id: ticketId,
        comment_id: validated.comment_id || null,
        file_name: validated.file_name,
        file_size: validated.file_size,
        file_type: validated.file_type,
        storage_path: validated.storage_path,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create attachment record', { error });
      return res.status(500).json({ error: 'Failed to create attachment' });
    }

    logger.info('Attachment created', {
      ticketId,
      attachmentId: attachment.id,
      uploadedBy: user.id,
    });

    res.status(201).json(attachment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Create attachment error', {
      ticketId,
      error,
    });
    res.status(500).json({ error: 'Failed to create attachment' });
  }
}));

/**
 * GET /api/tickets/:ticketId/attachments/:attachmentId/download-url
 * Get presigned download URL for attachment
 */
router.get('/:ticketId/attachments/:attachmentId/download-url', requireAuth, asyncHandler(async (req: any, res) => {
  const { ticketId, attachmentId } = req.params;
  const user = req.user;

  try {
    // Get attachment
    const { data: attachment, error: attachmentError } = await supabaseAdmin
      .from('ticket_attachments')
      .select('*, support_tickets!inner(reporter_id)')
      .eq('id', attachmentId)
      .eq('ticket_id', ticketId)
      .single();

    if (attachmentError || !attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Check authorization
    if (user.role === 'student' && attachment.support_tickets.reporter_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Generate presigned download URL (valid for 1 hour)
    const { data: downloadData, error: downloadError } = await supabaseAdmin
      .storage
      .from('documents')
      .createSignedUrl(attachment.storage_path, 3600);

    if (downloadError || !downloadData) {
      logger.error('Failed to generate download URL', { error: downloadError });
      return res.status(500).json({ error: 'Failed to generate download URL' });
    }

    res.json({
      downloadUrl: downloadData.signedUrl,
      fileName: attachment.file_name,
    });
  } catch (error) {
    logger.error('Generate attachment download URL error', {
      ticketId,
      attachmentId,
      error,
    });
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
}));

export default router;
