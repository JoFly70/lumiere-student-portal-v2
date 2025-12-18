import { logger } from './logger';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

interface TicketCreatedData {
  ticketNumber: string;
  subject: string;
  category: string;
  priority: string;
  studentName: string;
  studentEmail: string;
}

interface TicketUpdatedData {
  ticketNumber: string;
  subject: string;
  status: string;
  studentName: string;
}

interface CommentAddedData {
  ticketNumber: string;
  subject: string;
  commentBy: string;
  comment: string;
  studentName: string;
}

const EMAIL_CONFIG = {
  enabled: process.env.EMAIL_ENABLED === 'true',
  from: process.env.EMAIL_FROM || 'noreply@lumiere.edu',
  adminEmail: process.env.ADMIN_EMAIL || 'support@lumiere.edu',
};

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!EMAIL_CONFIG.enabled) {
    logger.info('Email sending disabled - would send:', {
      to: options.to,
      subject: options.subject,
    });
    return true;
  }

  try {
    logger.info('Email would be sent (SMTP not configured):', {
      to: options.to,
      subject: options.subject,
      from: options.from || EMAIL_CONFIG.from,
    });

    return true;
  } catch (error) {
    logger.error('Email sending failed:', {
      error: error instanceof Error ? error.message : String(error),
      to: options.to,
      subject: options.subject,
    });
    return false;
  }
}

function getEmailTemplate(body: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 8px 8px 0 0;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
          }
          .content {
            background: #ffffff;
            padding: 30px;
            border: 1px solid #e0e0e0;
            border-top: none;
          }
          .footer {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 0 0 8px 8px;
            text-align: center;
            font-size: 12px;
            color: #666;
          }
          .button {
            display: inline-block;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
          }
          .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .badge.high { background: #fee; color: #c00; }
          .badge.medium { background: #ffeaa7; color: #d63031; }
          .badge.low { background: #dfe6e9; color: #2d3436; }
          .info-box {
            background: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #667eea;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Lumiere Portal</h1>
        </div>
        <div class="content">
          ${body}
        </div>
        <div class="footer">
          <p>This is an automated message from Lumiere Student Portal.</p>
          <p>Please do not reply to this email.</p>
        </div>
      </body>
    </html>
  `;
}

export async function sendTicketCreatedEmailToStaff(data: TicketCreatedData): Promise<boolean> {
  const priorityBadge = `<span class="badge ${data.priority.toLowerCase()}">${data.priority}</span>`;

  const body = `
    <h2>New Support Ticket Created</h2>
    <p>A new support ticket has been submitted and requires attention.</p>

    <div class="info-box">
      <p><strong>Ticket Number:</strong> ${data.ticketNumber}</p>
      <p><strong>Subject:</strong> ${data.subject}</p>
      <p><strong>Category:</strong> ${data.category}</p>
      <p><strong>Priority:</strong> ${priorityBadge}</p>
      <p><strong>Student:</strong> ${data.studentName} (${data.studentEmail})</p>
    </div>

    <a href="${process.env.APP_URL || 'http://localhost:5000'}/admin/tickets/${data.ticketNumber}" class="button">
      View Ticket
    </a>
  `;

  return sendEmail({
    to: EMAIL_CONFIG.adminEmail,
    subject: `New Ticket: ${data.ticketNumber} - ${data.subject}`,
    html: getEmailTemplate(body),
  });
}

export async function sendTicketStatusUpdateEmail(
  to: string,
  data: TicketUpdatedData
): Promise<boolean> {
  const statusColors: Record<string, string> = {
    open: '#3498db',
    'in-progress': '#f39c12',
    resolved: '#2ecc71',
    closed: '#95a5a6',
  };

  const statusColor = statusColors[data.status] || '#95a5a6';

  const body = `
    <h2>Ticket Status Updated</h2>
    <p>Hello ${data.studentName},</p>
    <p>Your support ticket status has been updated.</p>

    <div class="info-box">
      <p><strong>Ticket Number:</strong> ${data.ticketNumber}</p>
      <p><strong>Subject:</strong> ${data.subject}</p>
      <p><strong>New Status:</strong> <span style="color: ${statusColor}; font-weight: 600;">${data.status.toUpperCase()}</span></p>
    </div>

    <a href="${process.env.APP_URL || 'http://localhost:5000'}/support" class="button">
      View Ticket
    </a>

    <p style="margin-top: 30px;">If you have any questions, please reply to your ticket in the portal.</p>
  `;

  return sendEmail({
    to,
    subject: `Ticket Update: ${data.ticketNumber} - ${data.subject}`,
    html: getEmailTemplate(body),
  });
}

export async function sendNewCommentEmail(
  to: string,
  data: CommentAddedData,
  isStaff: boolean = false
): Promise<boolean> {
  const body = `
    <h2>New Comment on Your Ticket</h2>
    <p>Hello ${data.studentName},</p>
    <p>${data.commentBy} has added a comment to your ticket.</p>

    <div class="info-box">
      <p><strong>Ticket Number:</strong> ${data.ticketNumber}</p>
      <p><strong>Subject:</strong> ${data.subject}</p>
      <p><strong>Comment by:</strong> ${data.commentBy}</p>
    </div>

    <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <p style="margin: 0;">${data.comment}</p>
    </div>

    <a href="${process.env.APP_URL || 'http://localhost:5000'}/${isStaff ? 'admin' : ''}/support" class="button">
      View Ticket
    </a>
  `;

  return sendEmail({
    to,
    subject: `New Comment: ${data.ticketNumber} - ${data.subject}`,
    html: getEmailTemplate(body),
  });
}

export async function sendWelcomeEmail(to: string, name: string): Promise<boolean> {
  const body = `
    <h2>Welcome to Lumiere Portal!</h2>
    <p>Hello ${name},</p>
    <p>Thank you for creating your account. We're excited to have you join the Lumiere community!</p>

    <div class="info-box">
      <p><strong>What's Next?</strong></p>
      <ul style="margin: 10px 0; padding-left: 20px;">
        <li>Complete your student profile</li>
        <li>Explore available degree programs</li>
        <li>View your course roadmap</li>
        <li>Track your progress with Flight Deck</li>
      </ul>
    </div>

    <a href="${process.env.APP_URL || 'http://localhost:5000'}/dashboard" class="button">
      Go to Dashboard
    </a>

    <p style="margin-top: 30px;">If you have any questions, our support team is here to help.</p>
  `;

  return sendEmail({
    to,
    subject: 'Welcome to Lumiere Portal',
    html: getEmailTemplate(body),
  });
}

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<boolean> {
  const body = `
    <h2>Password Reset Request</h2>
    <p>We received a request to reset your password.</p>
    <p>Click the button below to create a new password:</p>

    <a href="${resetLink}" class="button">
      Reset Password
    </a>

    <p style="margin-top: 30px; color: #666;">
      If you didn't request this, you can safely ignore this email.
      Your password will remain unchanged.
    </p>

    <p style="margin-top: 20px; font-size: 12px; color: #999;">
      This link will expire in 24 hours.
    </p>
  `;

  return sendEmail({
    to,
    subject: 'Password Reset Request - Lumiere Portal',
    html: getEmailTemplate(body),
  });
}

export async function sendEnrollmentNotification(
  to: string,
  studentName: string,
  programName: string
): Promise<boolean> {
  const body = `
    <h2>Program Enrollment Confirmation</h2>
    <p>Hello ${studentName},</p>
    <p>You have been successfully enrolled in a new degree program.</p>

    <div class="info-box">
      <p><strong>Program:</strong> ${programName}</p>
      <p><strong>Status:</strong> <span style="color: #2ecc71; font-weight: 600;">ACTIVE</span></p>
    </div>

    <a href="${process.env.APP_URL || 'http://localhost:5000'}/roadmap" class="button">
      View Your Roadmap
    </a>

    <p style="margin-top: 30px;">
      Your personalized course roadmap is now available.
      Visit your dashboard to get started!
    </p>
  `;

  return sendEmail({
    to,
    subject: `Program Enrollment: ${programName}`,
    html: getEmailTemplate(body),
  });
}
