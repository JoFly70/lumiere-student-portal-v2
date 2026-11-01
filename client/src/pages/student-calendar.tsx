/** Academic Calendar for students (S30): their own dates only, export and subscription links; no scheduling. */
import React from "react";
import { Link } from "wouter";
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
        <p className="small mb-3 max-w-2xl" data-testid="cal-request-appointment">
          <Link className="link" href="/beyond#bd-sessions" data-testid="link-request-appointment">{tt("s32.cal.requestAppt")} →</Link>
          {" "}<span>{tt("s32.cal.requestApptHelp")}</span>
        </p>
        <CalendarWorkspace scope="student" />
      </div>
    </div>
  );
}
