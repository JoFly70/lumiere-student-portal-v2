/**
 * Staff billing (S19/S26/S27): /admin/students/:studentId/billing, admin + staff.
 * The page hosts the same BillingTab the Student file uses (installment management, evidence, receipts, history).
 * Uses the S18 ledger API; every action returns the refreshed view. No gateway, no card data.
 */
import React from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { StaffPage, StaffPageHeader } from "@/components/staff/staff-ui";
import { useAuth } from "@/lib/auth";
import { useDocuments } from "@/hooks/use-documents";
import { BillingTab } from "@/components/admin/file/billing-tab";

export default function AdminStudentBilling() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const documents = useDocuments(studentId || null);
  const student = useQuery<{ first_name?: string | null; last_name?: string | null; preferred_name?: string | null; student_code?: string | null }>({
    queryKey: [`/api/students/${encodeURIComponent(studentId)}`],
    enabled: !!studentId,
    retry: false,
  });
  const { user } = useAuth();
  const isAdmin = user?.role === "admin"; // the student file is admin-only; staff return to the billing lookup
  const first = student.data ? student.data.preferred_name || student.data.first_name || "" : "";
  const who = student.data ? [first, student.data.last_name].filter(Boolean).join(" ") : "";
  const back = (
    <Link href={isAdmin ? `/admin/students/${encodeURIComponent(studentId)}` : "/staff/billing"} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-back-workspace">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />{isAdmin ? "Student file" : "Student billing"}
    </Link>
  );
  return (
    <StaffPage testId="admin-student-billing" width="wide">
      <StaffPageHeader back={back} eyebrow="Billing" title={who ? `Billing · ${who}` : "Student billing"}
        description="The agreed price, adjustments, payment plan and confirmed payments. Only payments you confirm count as paid." testId="billing-header" />
      <BillingTab studentId={studentId} personName={first || who || "the student"} documents={documents.data ?? []} />
    </StaffPage>
  );
}
