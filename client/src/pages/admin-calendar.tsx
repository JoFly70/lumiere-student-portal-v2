/** Academic Calendar for admin and staff (S30): every student's dates, scheduling, rescheduling, export and subscription links. */
import React, { useMemo } from "react";
import { CalendarWorkspace } from "@/components/s30/calendar/calendar-workspace";
import { useCalT, type StudentOption } from "@/components/s30/calendar/calendar-parts";
import { useControlCenter } from "@/lib/s27-queries";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";
import "@/styles/owner-cockpit.css";

export default function AdminCalendar() {
  const { tt } = useCalT();
  const cc = useControlCenter();
  const students = useMemo<StudentOption[]>(() => (cc.data?.students ?? []).map((s) => ({ studentId: s.studentId, name: s.name, code: s.code, isDemo: s.isDemo })), [cc.data]);
  return (
    <div className="s27 occ" data-testid="cal-page">
      <div className="inner">
        <header className="deck-head">
          <div>
            <p className="eyebrow">{tt("cal.eyebrow")}</p>
            <h1 className="text-3xl">{tt("cal.admin.title")}</h1>
            <p className="small mt-1 max-w-2xl">{tt("cal.admin.subtitle")}</p>
          </div>
        </header>
        <CalendarWorkspace scope="staff" students={students} />
      </div>
    </div>
  );
}
