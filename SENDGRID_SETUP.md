# SendGrid Email Configuration

Complete guide for setting up SendGrid for email notifications in the Lumiere Student Portal.

---

## 📧 What SendGrid Does

SendGrid handles email delivery for:
- Password reset emails
- Welcome emails for new users
- Support ticket notifications
- Document verification notifications
- Course assignment notifications
- Weekly progress reports

**Note:** Email functionality is OPTIONAL. The app works fine without it.

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Create SendGrid Account

1. Go to [https://sendgrid.com/](https://sendgrid.com/)
2. Click **"Start for Free"**
3. Fill in your information:
   - Email
   - Password
   - Company name: `Lumiere Portal` (or your company)
   - Website: Your website URL
4. Verify your email address

### Step 2: Create API Key

1. Log into [SendGrid Dashboard](https://app.sendgrid.com/)
2. Navigate to **Settings → API Keys** (left sidebar)
3. Click **"Create API Key"**
4. Configure API Key:
   - **Name:** `Lumiere Portal Production`
   - **API Key Permissions:** Choose `Full Access` (or `Restricted Access` with Mail Send permission)
5. Click **"Create & View"**
6. **IMPORTANT:** Copy the API key immediately - you'll only see it once!
7. Store it securely (you'll need it for environment variables)

### Step 3: Verify Sender Identity

SendGrid requires sender verification to prevent spam.

**Option A: Single Sender Verification (Easier - Recommended for Small Projects)**

1. Go to **Settings → Sender Authentication**
2. Click **"Verify a Single Sender"**
3. Fill in the form:
   - **From Name:** `Lumiere Student Portal`
   - **From Email Address:** `noreply@yourdomain.com` (use an email you control)
   - **Reply To:** `support@yourdomain.com` (or same as From Email)
   - **Company Address:** Your address
   - **City, State, Zip, Country:** Your location
4. Click **"Create"**
5. Check your email for verification link
6. Click the verification link
7. Done! You can now send from this email address

**Option B: Domain Authentication (Better for Production)**

1. Go to **Settings → Sender Authentication**
2. Click **"Authenticate Your Domain"**
3. Choose your DNS host (e.g., Cloudflare, GoDaddy, Namecheap)
4. Follow the instructions to add DNS records:
   - CNAME records for domain verification
   - DNS records for email authentication
5. Wait for verification (usually 24-48 hours)
6. Once verified, you can send from any email address at your domain

### Step 4: Add to Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select your backend service
3. Go to **"Environment"** tab
4. Add these environment variables:

```bash
# SendGrid API Key
SENDGRID_API_KEY=<paste_your_api_key_here>

# From Email (must match verified sender)
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# From Name (optional)
SENDGRID_FROM_NAME=Lumiere Student Portal
```

5. Click **"Save Changes"**
6. Render will automatically redeploy

### Step 5: Test Email Sending

1. Deploy your app
2. Try the "Forgot Password" feature
3. Check if you receive the email
4. Check SendGrid dashboard for email activity

---

## 📝 Environment Variables

Add these to your Render backend service:

```bash
# Required
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxx

# Required - Must match verified sender
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# Optional - Defaults to "Lumiere Student Portal"
SENDGRID_FROM_NAME=Lumiere Student Portal

# Optional - Where users can reply
SENDGRID_REPLY_TO=support@yourdomain.com
```

---

## 🎨 Email Templates

The app uses these email templates (built-in):

### 1. Welcome Email
Sent when: New user registers
Content:
- Welcome message
- Getting started guide
- Contact information

### 2. Password Reset Email
Sent when: User requests password reset
Content:
- Reset link (expires in 1 hour)
- Security notice
- Instructions

### 3. Support Ticket Created
Sent when: User submits a support ticket
Content:
- Ticket number
- Summary of request
- Expected response time

### 4. Support Ticket Updated
Sent when: Staff responds to ticket
Content:
- New response
- Link to ticket
- Update summary

### 5. Document Verification
Sent when: Document is verified/rejected
Content:
- Document status
- Next steps
- Staff notes (if any)

---

## 🔧 Customize Email Templates

Email templates are in: `server/lib/email.ts`

To customize:

1. Open `server/lib/email.ts`
2. Find the email template function (e.g., `sendWelcomeEmail`)
3. Modify the HTML content
4. Save and redeploy

Example:
```typescript
export async function sendWelcomeEmail(to: string, name: string) {
  const html = `
    <h1>Welcome to Lumiere, ${name}!</h1>
    <p>We're excited to have you on board.</p>
    <p><a href="https://yourdomain.com/dashboard">Get Started</a></p>
  `;

  return sendEmail({
    to,
    subject: 'Welcome to Lumiere Student Portal',
    html
  });
}
```

---

## 📊 Monitor Email Delivery

### SendGrid Dashboard

1. Go to [SendGrid Dashboard](https://app.sendgrid.com/)
2. Click **"Activity"** in the sidebar
3. View:
   - Emails sent
   - Delivery status
   - Opens and clicks
   - Bounces and spam reports

### Key Metrics

- **Delivered:** Successfully delivered to inbox
- **Opens:** Recipient opened the email
- **Clicks:** Recipient clicked a link
- **Bounced:** Email address invalid or mailbox full
- **Spam Reports:** Recipient marked as spam

### Email Logs

View detailed logs:
1. Go to **Activity → Email Activity**
2. Search by:
   - Recipient email
   - Subject
   - Date range
   - Status

---

## 🆘 Troubleshooting

### Emails Not Sending

**Problem:** No emails being delivered
**Solutions:**
1. Check `SENDGRID_API_KEY` is set correctly
2. Verify sender email is authenticated
3. Check Render logs for errors
4. Verify API key has Mail Send permissions
5. Check SendGrid activity dashboard for blocked emails

### Emails Going to Spam

**Problem:** Emails landing in spam folder
**Solutions:**
1. Complete domain authentication (not just single sender)
2. Set up SPF, DKIM, and DMARC records
3. Avoid spam trigger words in subject/content
4. Include unsubscribe link
5. Maintain good sender reputation

### "Sender not verified" Error

**Problem:** Error message about unverified sender
**Solutions:**
1. Complete single sender verification
2. Or complete domain authentication
3. Ensure `SENDGRID_FROM_EMAIL` matches verified email exactly
4. Check for typos in environment variable

### API Key Invalid Error

**Problem:** "Invalid API key" error
**Solutions:**
1. Regenerate API key in SendGrid dashboard
2. Ensure no extra spaces when copying
3. Verify key has correct permissions
4. Update environment variable in Render
5. Redeploy service

### Rate Limit Exceeded

**Problem:** "Too many requests" error
**Solutions:**
1. SendGrid free plan: 100 emails/day limit
2. Upgrade to paid plan for more
3. Implement email queuing
4. Add rate limiting to prevent abuse

---

## 💰 SendGrid Pricing

### Free Plan
- ✅ 100 emails/day forever
- ✅ Perfect for development/testing
- ✅ All core features included
- ⚠️ SendGrid branding in emails

### Essentials Plan ($19.95/month)
- ✅ 50,000 emails/month
- ✅ Remove SendGrid branding
- ✅ Email validation
- ✅ Better deliverability

### Pro Plan ($89.95/month)
- ✅ 100,000 emails/month
- ✅ Dedicated IP address
- ✅ Advanced statistics
- ✅ Priority support

**Recommendation:**
- **Development:** Free plan
- **Small Production:** Essentials plan
- **Large Production:** Pro plan

---

## 🔒 Security Best Practices

1. **API Key Management**
   - Never commit API keys to Git
   - Use environment variables only
   - Rotate keys periodically
   - Use restricted access (not Full Access) if possible

2. **Email Content**
   - Sanitize user input before including in emails
   - Use secure links (HTTPS only)
   - Include unsubscribe links
   - Add security warnings for sensitive actions

3. **Sender Verification**
   - Complete domain authentication for production
   - Use SPF, DKIM, and DMARC
   - Monitor sender reputation
   - Handle bounces properly

4. **Rate Limiting**
   - Implement rate limiting on password reset
   - Prevent email bombing
   - Queue emails if sending many
   - Monitor for abuse

---

## 🎯 Advanced Configuration

### Email Templates with Variables

Use SendGrid's template engine:

1. Create template in SendGrid Dashboard:
   - Go to **Email API → Dynamic Templates**
   - Click **"Create a Dynamic Template"**
   - Design your template with variables like `{{name}}`

2. Send using template:
```typescript
await sendEmail({
  to: 'user@example.com',
  templateId: 'd-1234567890abcdef',
  dynamicTemplateData: {
    name: 'John Doe',
    resetLink: 'https://...'
  }
});
```

### Track Opens and Clicks

Enable tracking in SendGrid:
1. Go to **Settings → Tracking**
2. Enable:
   - Open Tracking
   - Click Tracking
   - Subscription Tracking

### Unsubscribe Management

Add unsubscribe link:
```html
<p>
  <a href="{{unsubscribe_url}}">Unsubscribe</a> from these emails
</p>
```

### Email Attachments

Send files via email:
```typescript
await sendEmail({
  to: 'user@example.com',
  subject: 'Your Invoice',
  html: '<p>Please find your invoice attached.</p>',
  attachments: [
    {
      content: Buffer.from('PDF content').toString('base64'),
      filename: 'invoice.pdf',
      type: 'application/pdf'
    }
  ]
});
```

---

## ✅ Post-Setup Checklist

After configuring SendGrid:

- [ ] SendGrid account created
- [ ] API key generated and stored securely
- [ ] Sender email verified
- [ ] Environment variables added to Render
- [ ] Test email sent successfully
- [ ] Email appears in inbox (not spam)
- [ ] Dashboard shows successful delivery
- [ ] Domain authentication completed (optional)
- [ ] Email tracking enabled (optional)

---

## 🎯 Next Steps

After setting up SendGrid:

1. ✅ Test all email flows (welcome, password reset, etc.)
2. ✅ Customize email templates with your branding
3. ✅ Set up domain authentication for better deliverability
4. ✅ Configure unsubscribe management
5. ✅ Enable email tracking (opens/clicks)
6. ✅ Monitor delivery metrics
7. ✅ Set up email alerts for issues

---

## 🆘 Need Help?

- **SendGrid Documentation:** https://docs.sendgrid.com/
- **SendGrid Support:** https://support.sendgrid.com/
- **API Reference:** https://docs.sendgrid.com/api-reference
- **Status Page:** https://status.sendgrid.com/

---

## 💡 Pro Tips

1. **Test Mode:** Use SendGrid sandbox mode for testing
2. **Monitoring:** Set up alerts for bounce rates
3. **Templates:** Use dynamic templates for consistency
4. **Webhooks:** Get real-time delivery events
5. **Validation:** Use email validation API to verify addresses
6. **Compliance:** Include privacy policy and terms links

---

**Congratulations!** Your email system is now configured! 📧

Users will receive professional emails for all important notifications.
