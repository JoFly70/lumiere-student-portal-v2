/** Academic Calendar for students (S30): their own dates only, export and subscription links; no scheduling. */
import React from "react";
import { CalendarWorkspace } from "@/components/s30/calendar/calendar-workspace";
import { useCalT } from "@/components/s30/calendar/calendar-parts";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";
import "@/styles/owner-cockpit.css";

export default function StudentCalendar() {
  const { tt } = useCalT();
  return (
    <div className="s27 occ" data-testid="cal-page">
      <div className="inner">
        <header className="deck-head">
          <div>
            <p className="eyebrow">{tt("cal.eyebrow")}</p>
            <h1 className="text-3xl">{tt("cal.student.title")}</h1>
            <p className="small mt-1 max-w-2xl">{tt("cal.student.subtitle")}</p>
          </div>
        </header>
        <CalendarWorkspace scope="student" />
      </div>
    </div>
  );
}
