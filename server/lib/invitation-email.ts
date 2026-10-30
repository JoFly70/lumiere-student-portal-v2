/**
 * Branded EN/FR student invitation email. The only personal value in it is the recipient address the admin typed;
 * the sign-up link carries the single-use invitation code (the same link the admin can copy once).
 */
import { escapeHtml } from "./support-notifications";

export type InvitationLanguage = "en" | "fr";

const COPY = {
  en: {
    subject: "Your invitation to the Lumière Student Portal",
    preheader: "Create your Lumière account with this personal link.",
    title: "Welcome to Lumière",
    intro: "You have been invited to create your account on the Lumière Student Portal, where you will follow your plan, documents and progress.",
    steps: ["Open the link below.", "Sign up with this exact email address: {email}", "Confirm your email address, then sign in."],
    cta: "Create my account",
    code: "Invitation code",
    expires: "This personal invitation can be used once and expires on {date}.",
    fallback: "If the button does not work, copy this link into your browser:",
    ignore: "If you were not expecting this invitation, you can ignore this email.",
    footer: "Lumière · Student Portal. This is an automated message; replies are not read. Questions? Use Support in the portal.",
  },
  fr: {
    subject: "Votre invitation au Portail étudiant Lumière",
    preheader: "Créez votre compte Lumière avec ce lien personnel.",
    title: "Bienvenue chez Lumière",
    intro: "Vous êtes invité(e) à créer votre compte sur le Portail étudiant Lumière, où vous suivrez votre plan, vos documents et votre progression.",
    steps: ["Ouvrez le lien ci-dessous.", "Inscrivez-vous avec cette adresse courriel exacte : {email}", "Confirmez votre adresse courriel, puis connectez-vous."],
    cta: "Créer mon compte",
    code: "Code d’invitation",
    expires: "Cette invitation personnelle est à usage unique et expire le {date}.",
    fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
    ignore: "Si vous n’attendiez pas cette invitation, vous pouvez ignorer ce courriel.",
    footer: "Lumière · Portail étudiant. Ce message est automatique ; les réponses ne sont pas lues. Une question ? Utilisez l’Assistance dans le portail.",
  },
} as const;

/** Sign-up link the login page consumes (?invite= opens the invitation tab; ?lang= selects the language). */
export function invitationSignupLink(appUrl: string, token: string, language: InvitationLanguage): string {
  return `${appUrl}/login?invite=${encodeURIComponent(token)}&lang=${language}`;
}

function formatExpiry(iso: string, language: InvitationLanguage): string {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(iso));
}

export function buildInvitationEmail(input: { email: string; token: string; expiresAt: string; appUrl: string; language: InvitationLanguage }) {
  const c = COPY[input.language];
  const link = invitationSignupLink(input.appUrl, input.token, input.language);
  const date = formatExpiry(input.expiresAt, input.language);
  const steps = c.steps.map((s) => s.replace("{email}", input.email));
  const e = escapeHtml;

  // Lumière palette: ink #1b1f27, ivory #f4f3ef, card #ffffff, gold #c29a4e, gold ink #74561b, muted #535a66.
  const html = `<!DOCTYPE html>
<html lang="${input.language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f3ef;color:#1b1f27;font-family:Georgia,'Times New Roman',serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(c.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4dfd3;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0f1522;padding:28px 32px;text-align:left;">
<div style="font-size:28px;letter-spacing:0.02em;color:#f4efe4;">Lumière</div>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c9b27f;margin-top:6px;">Student Portal</div>
</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 12px;font-size:26px;font-weight:normal;color:#10141c;">${e(c.title)}</h1>
<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#3a404b;">${e(c.intro)}</p>
<ol style="margin:0 0 24px;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#3a404b;">${steps.map((s) => `<li>${e(s)}</li>`).join("")}</ol>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#c29a4e;">
<a href="${e(link)}" style="display:inline-block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#1a1407;text-decoration:none;border-radius:10px;">${e(c.cta)}</a>
</td></tr></table>
<p style="margin:24px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#74561b;">${e(c.code)}</p>
<p style="margin:0 0 20px;font-family:'Courier New',monospace;font-size:13px;word-break:break-all;color:#1b1f27;">${e(input.token)}</p>
<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#535a66;">${e(c.expires.replace("{date}", date))}</p>
<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#535a66;">${e(c.fallback)}</p>
<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;word-break:break-all;"><a href="${e(link)}" style="color:#74561b;">${e(link)}</a></p>
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#535a66;">${e(c.ignore)}</p>
</td></tr>
<tr><td style="background:#fbfaf8;border-top:1px solid #efede7;padding:18px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#535a66;">${e(c.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [c.title, "", c.intro, "", ...steps.map((s, i) => `${i + 1}. ${s}`), "", `${c.cta}: ${link}`, `${c.code}: ${input.token}`, "", c.expires.replace("{date}", date), c.ignore, "", c.footer].join("\n");
  return { subject: c.subject, html, text, link };
}
