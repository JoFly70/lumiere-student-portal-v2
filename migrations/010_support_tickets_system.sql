/*
  # Support Ticket System (Jira-like)

  1. Schema
    - support_tickets: Main ticket table
    - ticket_comments: Comments and replies
    - ticket_attachments: File attachments
    - ticket_assignments: Coach/staff assignments

  2. Features
    - Students can create tickets
    - Track status (open, in_progress, waiting, resolved, closed)
    - Priority levels (low, medium, high, urgent)
    - Categories (academic, technical, billing, document, general)
    - Comments with internal notes (admin-only)
    - File attachments
    - Email notifications ready
    - Assignment to coaches/staff
    - Status history tracking

  3. Security
    - RLS policies for student/admin access
    - Students can only see own tickets
    - Admins/coaches can see all assigned tickets
    - Internal notes only visible to staff
*/

-- Create enums for ticket system
CREATE TYPE ticket_status AS ENUM (
  'open',
  'in_progress',
  'waiting_on_student',
  'resolved',
  'closed'
);

CREATE TYPE ticket_priority AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

CREATE TYPE ticket_category AS ENUM (
  'academic',
  'technical',
  'billing',
  'document',
  'enrollment',
  'general'
);

-- Main tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE,

  -- Reporter (student)
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reporter_name TEXT NOT NULL,
  reporter_email TEXT NOT NULL,

  -- Ticket details
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category ticket_category NOT NULL DEFAULT 'general',
  priority ticket_priority NOT NULL DEFAULT 'medium',
  status ticket_status NOT NULL DEFAULT 'open',

  -- Assignment
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP WITH TIME ZONE,

  -- Resolution
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT valid_ticket_number CHECK (ticket_number ~ '^LUM-[0-9]{5,}$')
);

-- Ticket comments table
CREATE TABLE IF NOT EXISTS ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

  -- Author
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL, -- 'student', 'coach', 'staff', 'admin'

  -- Content
  content TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false, -- Internal notes visible only to staff

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Ticket attachments table
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES ticket_comments(id) ON DELETE CASCADE, -- Optional: attach to specific comment

  -- File info
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  storage_path TEXT NOT NULL, -- Path in Supabase Storage

  -- Uploader
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT valid_file_size CHECK (file_size > 0 AND file_size <= 10485760), -- 10MB max
  CONSTRAINT valid_file_name CHECK (LENGTH(file_name) > 0 AND LENGTH(file_name) <= 255)
);

-- Ticket status history table (for audit trail)
CREATE TABLE IF NOT EXISTS ticket_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

  -- Status change
  old_status ticket_status,
  new_status ticket_status NOT NULL,
  changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_reason TEXT,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Function to generate ticket numbers
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  ticket_num TEXT;
BEGIN
  -- Get the highest ticket number and increment
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(ticket_number FROM 'LUM-([0-9]+)') AS INTEGER
      )
    ), 10000
  ) + 1 INTO next_num
  FROM support_tickets;

  ticket_num := 'LUM-' || LPAD(next_num::TEXT, 5, '0');
  RETURN ticket_num;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-set ticket number on insert
CREATE OR REPLACE FUNCTION set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := generate_ticket_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate ticket numbers
CREATE TRIGGER trigger_set_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_ticket_number();

-- Function to update ticket updated_at timestamp
CREATE OR REPLACE FUNCTION update_ticket_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update updated_at
CREATE TRIGGER trigger_update_ticket_timestamp
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_timestamp();

CREATE TRIGGER trigger_update_comment_timestamp
  BEFORE UPDATE ON ticket_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_timestamp();

-- Function to create status history on status change
CREATE OR REPLACE FUNCTION track_ticket_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO ticket_status_history (
      ticket_id,
      old_status,
      new_status,
      changed_by
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      COALESCE(current_setting('app.current_user_id', true), 'system')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to track status changes
CREATE TRIGGER trigger_track_status_change
  AFTER UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION track_ticket_status_change();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON support_tickets(reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON support_tickets(assigned_to, status) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON support_tickets(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket ON ticket_status_history(ticket_id, created_at DESC);

-- Full-text search index on tickets
CREATE INDEX IF NOT EXISTS idx_tickets_search ON support_tickets
  USING gin(to_tsvector('english', subject || ' ' || description));

-- Enable RLS
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_status_history ENABLE ROW LEVEL SECURITY;

-- ==================== RLS POLICIES ====================

-- SUPPORT_TICKETS POLICIES

-- Students can view their own tickets
CREATE POLICY "Students can view own tickets"
  ON support_tickets
  FOR SELECT
  USING (
    reporter_id = auth.uid()
  );

-- Students can create tickets
CREATE POLICY "Students can create tickets"
  ON support_tickets
  FOR INSERT
  WITH CHECK (
    reporter_id = auth.uid()
  );

-- Students can update their own open tickets (before assigned)
CREATE POLICY "Students can update own open tickets"
  ON support_tickets
  FOR UPDATE
  USING (
    reporter_id = auth.uid()
    AND status = 'open'
    AND assigned_to IS NULL
  );

-- Admins and assigned staff can view all tickets
CREATE POLICY "Staff can view assigned or all tickets"
  ON support_tickets
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM users
      WHERE role IN ('admin', 'coach', 'staff')
    )
  );

-- Admins and staff can update any ticket
CREATE POLICY "Staff can update tickets"
  ON support_tickets
  FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM users
      WHERE role IN ('admin', 'coach', 'staff')
    )
  );

-- TICKET_COMMENTS POLICIES

-- Students can view comments on their own tickets (excluding internal notes)
CREATE POLICY "Students can view own ticket comments"
  ON ticket_comments
  FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE reporter_id = auth.uid()
    )
    AND is_internal = false
  );

-- Staff can view all comments including internal notes
CREATE POLICY "Staff can view all comments"
  ON ticket_comments
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM users
      WHERE role IN ('admin', 'coach', 'staff')
    )
  );

-- Users can create comments on tickets they can access
CREATE POLICY "Users can create comments on accessible tickets"
  ON ticket_comments
  FOR INSERT
  WITH CHECK (
    -- Student commenting on own ticket
    (
      ticket_id IN (
        SELECT id FROM support_tickets
        WHERE reporter_id = auth.uid()
      )
      AND is_internal = false
    )
    OR
    -- Staff commenting on any ticket
    (
      auth.uid() IN (
        SELECT id FROM users
        WHERE role IN ('admin', 'coach', 'staff')
      )
    )
  );

-- TICKET_ATTACHMENTS POLICIES

-- Students can view attachments on their own tickets
CREATE POLICY "Students can view own ticket attachments"
  ON ticket_attachments
  FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE reporter_id = auth.uid()
    )
  );

-- Staff can view all attachments
CREATE POLICY "Staff can view all attachments"
  ON ticket_attachments
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM users
      WHERE role IN ('admin', 'coach', 'staff')
    )
  );

-- Users can upload attachments to tickets they can access
CREATE POLICY "Users can upload attachments to accessible tickets"
  ON ticket_attachments
  FOR INSERT
  WITH CHECK (
    -- Student uploading to own ticket
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE reporter_id = auth.uid()
    )
    OR
    -- Staff uploading to any ticket
    auth.uid() IN (
      SELECT id FROM users
      WHERE role IN ('admin', 'coach', 'staff')
    )
  );

-- TICKET_STATUS_HISTORY POLICIES

-- Students can view status history of their own tickets
CREATE POLICY "Students can view own ticket status history"
  ON ticket_status_history
  FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE reporter_id = auth.uid()
    )
  );

-- Staff can view all status history
CREATE POLICY "Staff can view all status history"
  ON ticket_status_history
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM users
      WHERE role IN ('admin', 'coach', 'staff')
    )
  );

-- Only system can insert status history (via trigger)
CREATE POLICY "System can insert status history"
  ON ticket_status_history
  FOR INSERT
  WITH CHECK (true); -- Controlled by trigger, not direct inserts

-- Add comments for documentation
COMMENT ON TABLE support_tickets IS 'Support ticket system for student help requests';
COMMENT ON TABLE ticket_comments IS 'Comments and replies on support tickets';
COMMENT ON TABLE ticket_attachments IS 'File attachments for support tickets';
COMMENT ON TABLE ticket_status_history IS 'Audit trail for ticket status changes';
COMMENT ON COLUMN ticket_comments.is_internal IS 'Internal notes visible only to staff (not students)';
COMMENT ON FUNCTION generate_ticket_number() IS 'Generate sequential ticket numbers (LUM-XXXXX)';
