import { Link, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import GraduateProgramReview from "@/components/admin/graduate-program-review";

/**
 * S12 — the Graduate programmes panel on its own page so staff (not only admins,
 * who also see it inside the student workspace) can work a student's master's
 * route. The API enforces staff/admin and the admin-only conferral itself.
 */
export default function AdminStudentGraduate() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href={`/admin/students/${encodeURIComponent(studentId)}/roadmap`} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to the student's roadmap
      </Link>
      <h1 className="sr-only">Graduate programmes</h1>
      {studentId ? <GraduateProgramReview studentId={studentId} /> : null}
    </div>
  );
}
