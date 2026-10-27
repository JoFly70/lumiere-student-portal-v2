import { formatHalfUnits, HALF_UNITS_PER_CREDIT } from "@shared/high-school-contract";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CREDIT_STATUSES,
  PREVIEW_COURSES,
  STATUS_LABEL,
  areaTotals,
  creditsText,
  sumTotals,
  type PreviewSubject,
} from "@/lib/flight-deck-preview-data";
import { StatusSwatch } from "@/components/os/flight-deck-instruments";

/** Detail drawer for one subject: its courses and the half-credit arithmetic behind the strip. */
export function SubjectSheet({ subject, onClose }: { subject: PreviewSubject | null; onClose: () => void }) {
  const courses = subject ? PREVIEW_COURSES.filter((c) => subject.areas.some((a) => a.key === c.areaKey)) : [];
  const t = subject?.totals;
  return (
    <Sheet open={!!subject} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="fdp-sheet" data-testid="subject-sheet">
        {subject && t && (
          <>
            <SheetHeader className="fdp-sheet-head space-y-0 text-left">
              <SheetTitle className="fdp-sheet-title">{subject.label}</SheetTitle>
              <SheetDescription className="fdp-sheet-sub">
                {subject.areas.every((a) => a.kind === "elective") ? "Elective" : "Core"} requirement ·{" "}
                {creditsText(subject.requiredHalfUnits)} ({subject.requiredHalfUnits} half-units). Synthetic sample data.
              </SheetDescription>
            </SheetHeader>
            <div className="fdp-sheet-body">
              <section>
                <h3>Courses</h3>
                <div>
                  {courses.map((c) => (
                    <div key={c.key} className="fdp-course">
                      <StatusSwatch status={c.status} />
                      <div>
                        <div className="fdp-course-title">{c.title}</div>
                        <div className="fdp-course-status">{STATUS_LABEL[c.status]}</div>
                      </div>
                      <div className="fdp-course-hu tnum">
                        {c.halfUnits} half-{c.halfUnits === 1 ? "unit" : "units"}
                        <small>{creditsText(c.halfUnits)}</small>
                      </div>
                    </div>
                  ))}
                  {t.open > 0 && (
                    <div className="fdp-course">
                      <StatusSwatch status="open" />
                      <div>
                        <div className="fdp-course-title">Open slot</div>
                        <div className="fdp-course-status">Required, no course chosen yet</div>
                      </div>
                      <div className="fdp-course-hu tnum">
                        {t.open} half-{t.open === 1 ? "unit" : "units"}
                        <small>{creditsText(t.open)}</small>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h3>Half-credit math</h3>
                <div className="fdp-math tnum" data-testid="subject-math">
                  {CREDIT_STATUSES.map((s) => (
                    <div key={s} className="fdp-math-row">
                      <span>
                        <StatusSwatch status={s} />
                        {STATUS_LABEL[s]}
                      </span>
                      <span>{t[s]} half-units</span>
                    </div>
                  ))}
                  <div className="fdp-math-row total">
                    <span>Requirement</span>
                    <span>
                      {sumTotals(t)} half-units = {formatHalfUnits(sumTotals(t))} {sumTotals(t) === HALF_UNITS_PER_CREDIT ? "credit" : "credits"}
                    </span>
                  </div>
                </div>
                <p className="fdp-sheet-note" style={{ marginTop: 10 }}>
                  1 credit = {HALF_UNITS_PER_CREDIT} half-units, so a half-credit course counts as 1. Sums are exact whole numbers.
                </p>
              </section>

              {subject.areas.length > 1 && (
                <section>
                  <h3>Requirement areas</h3>
                  <div className="fdp-math tnum">
                    {subject.areas.map((a) => (
                      <div key={a.key} className="fdp-math-row">
                        <span>{a.label}</span>
                        <span>
                          {areaTotals(a).verified} of {a.requiredHalfUnits} verified
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <p className="fdp-sheet-note">
                Credit is official only after the awarding school records it against evidence. This sample screen never states official standing.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
