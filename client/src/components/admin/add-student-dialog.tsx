import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { apiRequest } from "@/lib/queryClient";
import { useT } from "@/i18n";
import { adminStudentWorkspacePath } from "@/pages/admin-student-workspace-presentation";
import { INVITATIONS_KEY, issueInvitation, type InvitationLanguage, type IssuedInvitation } from "./invitations-api";
import { IssuedInvitationNotice } from "./issued-invitation-notice";

export interface NewStudentForm {
  first_name: string;
  last_name: string;
  email: string;
  dob: string;
  phone_primary: string;
  residency: "us" | "foreign";
  address_country: string;
  address_line1: string;
}

export const EMPTY_NEW_STUDENT: NewStudentForm = {
  first_name: "", last_name: "", email: "", dob: "", phone_primary: "", residency: "us", address_country: "US", address_line1: "",
};

/** Body for POST /api/students: every key insertStudentSchema requires; nothing else is invented. user_id is never sent. */
export function newStudentPayload(f: NewStudentForm) {
  const nullFields = [
    "middle_name", "preferred_name", "sex", "gov_id_type", "gov_id_number", "photo_url", "hs_path", "hs_country", "hs_school", "hs_year",
    "hs_doc_url", "phone_secondary", "timezone", "address_state", "address_city", "address_postal", "address_line2", "target_degree",
    "target_major", "start_term", "prior_credits_est", "target_pace", "consent_signature",
  ];
  return {
    ...Object.fromEntries(nullFields.map((k) => [k, null])),
    status: "lead",
    first_name: f.first_name.trim(),
    last_name: f.last_name.trim(),
    email: f.email.trim().toLowerCase(),
    dob: f.dob,
    phone_primary: f.phone_primary.trim(),
    residency: f.residency,
    address_country: f.address_country.trim(),
    address_line1: f.address_line1.trim(),
    hs_completion: false,
  };
}

export const newStudentComplete = (f: NewStudentForm) =>
  [f.first_name, f.last_name, f.email, f.dob, f.phone_primary, f.address_country, f.address_line1].every((v) => v.trim().length > 0);

function parsedBody(error: unknown): { text: string; code?: string; existingStudentId?: string | null } {
  const body = (error instanceof Error ? error.message : String(error)).replace(/^\d+:\s*/, "");
  try {
    const e = JSON.parse(body);
    const text = typeof e?.error === "string" ? e.error : e?.error?.message ? String(e.error.message) : body;
    return { text, code: typeof e?.code === "string" ? e.code : undefined, existingStudentId: typeof e?.existingStudentId === "string" ? e.existingStudentId : null };
  } catch { /* plain text */ }
  return { text: body };
}

function message(error: unknown, fallback = "Could not create the student"): string {
  return parsedBody(error).text || fallback;
}

export function AddStudentDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewStudentForm>(EMPTY_NEW_STUDENT);
  const [error, setError] = useState<{ text: string; existingStudentId?: string | null; duplicate?: boolean } | null>(null);
  const { t } = useT();
  const [invite, setInvite] = useState(false);
  const [language, setLanguage] = useState<InvitationLanguage>("fr");
  const [done, setDone] = useState<{ studentId: string; invitation: IssuedInvitation | null; inviteError: string | null } | null>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const set = (key: keyof NewStudentForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const close = () => { setOpen(false); setDone(null); setForm(EMPTY_NEW_STUDENT); setInvite(false); };
  const openWorkspace = (id: string) => { close(); setLocation(adminStudentWorkspacePath(id)); };

  const create = useMutation({
    mutationFn: async () => {
      const student: { id: string } = await (await apiRequest("POST", "/api/students", newStudentPayload(form))).json();
      if (!invite) return { studentId: student.id, invitation: null, inviteError: null };
      try {
        return { studentId: student.id, invitation: await issueInvitation({ email: form.email.trim().toLowerCase(), language, sendEmail: true }), inviteError: null };
      } catch (e) {
        // The record exists either way; the invitation can be issued again from Administration > Invitations.
        return { studentId: student.id, invitation: null, inviteError: message(e, t("sa.inv.genericError")) };
      }
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/students"] });
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
      if (!invite) return openWorkspace(result.studentId);
      setDone(result);
    },
    onError: (e) => {
      const p = parsedBody(e);
      // Duplicate email: a clear message plus a link to the existing record (the endpoint is staff/admin only).
      if (p.code === "STUDENT_EMAIL_EXISTS") return setError({ text: p.existingStudentId ? t("sa.add.duplicate") : t("sa.add.duplicateNoLink"), existingStudentId: p.existingStudentId, duplicate: true });
      setError({ text: p.text || t("sa.add.createFailed") });
    },
  });

  const field = (id: string, label: string, key: keyof NewStudentForm, type = "text") => (
    <div className="space-y-1">
      <label className={staffLabel} htmlFor={`new-student-${id}`}>{label}</label>
      <Input id={`new-student-${id}`} type={type} className={staffField} value={form[key]} onChange={set(key)} />
    </div>
  );

  return (
    <>
      <Button type="button" className={staffBtn.primary} onClick={() => { setError(null); setDone(null); setOpen(true); }} data-testid="button-add-student"><UserPlus className="h-4 w-4" aria-hidden="true" />{t("sa.add.button")}</Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{done ? t("sa.add.titleDone") : t("sa.add.button")}</DialogTitle>
            <DialogDescription>
              {done
                ? t("sa.add.descDone")
                : t("sa.add.descForm", { status: t("sa.add.statusLead") })}
            </DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="space-y-4" data-testid="add-student-done">
              {done.invitation ? <IssuedInvitationNotice invitation={done.invitation} language={language} /> : null}
              {done.inviteError ? <p role="alert" className="text-sm text-st-urgent">{t("sa.add.inviteFailed", { error: done.inviteError })}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" className={staffBtn.outline} onClick={close}>{t("sa.add.close")}</Button>
                <Button type="button" className={staffBtn.primary} onClick={() => openWorkspace(done.studentId)} data-testid="button-open-new-student">{t("sa.add.openFile")}</Button>
              </DialogFooter>
            </div>
          ) : (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (newStudentComplete(form)) create.mutate(); }}>
            {field("first", t("sa.add.firstName"), "first_name")}
            {field("last", t("sa.add.lastName"), "last_name")}
            <div className="sm:col-span-2">{field("email", t("sa.add.email"), "email", "email")}</div>
            {field("dob", t("sa.add.dob"), "dob", "date")}
            {field("phone", t("sa.add.phone"), "phone_primary", "tel")}
            <div className="space-y-1">
              <label className={staffLabel} htmlFor="new-student-residency">{t("sa.add.residency")}</label>
              <select id="new-student-residency" className={staffField} value={form.residency} onChange={set("residency")}>
                <option value="us">{t("sa.add.residencyUs")}</option>
                <option value="foreign">{t("sa.add.residencyForeign")}</option>
              </select>
            </div>
            {field("country", t("sa.add.country"), "address_country")}
            <div className="sm:col-span-2">{field("address", t("sa.add.address"), "address_line1")}</div>
            <fieldset className="space-y-2 rounded-xl border border-student-line bg-student-bg/60 p-3 sm:col-span-2">
              <label className="flex items-start gap-2 text-sm text-student-ink">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--s-gold-ink))]" checked={invite} onChange={(e) => setInvite(e.target.checked)} data-testid="checkbox-add-student-invite" />
                <span>{t("sa.add.invite")}</span>
              </label>
              {invite ? (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <label className={staffLabel} htmlFor="new-student-invite-lang">{t("sa.add.emailLanguage")}</label>
                  <select id="new-student-invite-lang" className={`${staffField} w-auto`} value={language} onChange={(e) => setLanguage(e.target.value as InvitationLanguage)}>
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </div>
              ) : null}
            </fieldset>
            {error ? (
              <p role="alert" className="text-sm text-st-urgent sm:col-span-2" data-testid="add-student-error" data-code={error.duplicate ? "STUDENT_EMAIL_EXISTS" : undefined}>
                {error.existingStudentId ? (
                  <Link href={adminStudentWorkspacePath(error.existingStudentId)} className="font-semibold underline underline-offset-4" onClick={close} data-testid="link-existing-student">{error.text}</Link>
                ) : error.text}
              </p>
            ) : null}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" className={staffBtn.outline} onClick={close}>{t("sa.add.cancel")}</Button>
              <Button type="submit" className={staffBtn.primary} disabled={!newStudentComplete(form) || create.isPending} data-testid="button-add-student-submit">{create.isPending ? t("sa.add.creating") : invite ? t("sa.add.createInvite") : t("sa.add.create")}</Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
