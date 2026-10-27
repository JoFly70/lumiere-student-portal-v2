/**
 * Academic Flight Deck: PREVIEW PROTOTYPE (S17).
 * Reachable only where components/os/prototype-gate allows it (dev, or VITE_ENABLE_PROTOTYPES="true").
 * Synthetic data only (lib/flight-deck-preview-data); no API calls, no auth, no persistence.
 * Visual patterns adapted from the Lumière ClientDesk design system; re-implemented for the Portal.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { CreditCard, FileText, Gauge, HelpCircle, School, User } from "lucide-react";
import { formatHalfUnits } from "@shared/high-school-contract";
import lumiereLogo from "@assets/Lumiere Logo_1762534146530.webp";
import { ThemeToggle } from "@/components/theme-toggle";
import { PrototypeBanner } from "@/components/os/prototype-banner";
import { CreditGauge } from "@/components/os/credit-gauge";
import {
  CoverageBars,
  FileStatus,
  MilestoneTimeline,
  NextActions,
  QuickLinks,
  StatusLegend,
  SubjectStrips,
  type ViewMode,
} from "@/components/os/flight-deck-instruments";
import { SubjectSheet } from "@/components/os/subject-sheet";
import { PREVIEW_PROGRAM, previewSubjects, totalsFor, type PreviewSubject } from "@/lib/flight-deck-preview-data";
import "@/styles/flight-deck-preview.css";

const RAIL = [
  { label: "Flight Deck preview", href: "/preview/flight-deck", icon: Gauge, current: true },
  { label: "High School", href: "/high-school", icon: School },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Support", href: "/support", icon: HelpCircle },
  { label: "Profile", href: "/profile", icon: User },
  { label: "Billing", href: "/billing", icon: CreditCard },
] as const;

const MODES: { id: ViewMode; label: string }[] = [
  { id: "verified", label: "Verified only" },
  { id: "projected", label: "Including planned" },
];

export default function FlightDeckPreview() {
  const [mode, setMode] = useState<ViewMode>("projected");
  const [open, setOpen] = useState<PreviewSubject | null>(null);

  const all = useMemo(() => totalsFor("all"), []);
  const core = useMemo(() => totalsFor("core"), []);
  const elective = useMemo(() => totalsFor("elective"), []);
  const subjects = useMemo(() => previewSubjects(), []);

  const shown = mode === "verified" ? all.verified : all.verified + all.in_progress + all.planned;
  const headline =
    mode === "verified"
      ? `${formatHalfUnits(all.verified)} of ${formatHalfUnits(PREVIEW_PROGRAM.requiredHalfUnits)} credits verified in this sample`
      : `${formatHalfUnits(shown)} credits verified, in progress or planned`;

  return (
    <div className="fdp" data-testid="flight-deck-preview">
      <nav className="fdp-rail" aria-label="Portal sections (preview)">
        <div className="fdp-rail-brand">
          <img src={lumiereLogo} alt="Lumière" />
        </div>
        {RAIL.map(({ label, href, icon: Icon, ...rest }) => (
          <Link key={href} href={href} aria-label={label} title={label} aria-current={"current" in rest && rest.current ? "page" : undefined}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <div className="fdp-main">
        <div className="fdp-head">
          <header className="fdp-top">
            <span className="fdp-top-brand">Lumière</span>
            <div className="fdp-crumbs">
              Student Portal <span aria-hidden="true">/</span> <b>Academic Flight Deck</b>
            </div>
            <span className="fdp-top-spacer" />
            <ThemeToggle className="h-11 w-11" />
          </header>
          <PrototypeBanner />
        </div>

        <main className="fdp-page" id="main-content">
          <div className="fdp-title-row">
            <div>
              <p className="fdp-eyebrow">Academic Flight Deck · preview</p>
              <h1 className="fdp-h1">Where your credits stand</h1>
              <p className="fdp-sub">
                {PREVIEW_PROGRAM.label}. Credits are counted in half-units, so a half-credit course is never rounded.
              </p>
            </div>
            <div className="fdp-seg" role="radiogroup" aria-label="Which credit to count" data-testid="mode-toggle">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  onClick={() => setMode(m.id)}
                  data-testid={`mode-${m.id}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fdp-grid">
            <section className="fdp-card fdp-span-8" aria-labelledby="hero-title">
              <div className="fdp-hero">
                <CreditGauge totals={all} mode={mode} />
                <div className="fdp-hero-copy">
                  <h2 id="hero-title" data-testid="hero-headline">{headline}</h2>
                  <p>Sample figures only. Credit becomes official when the awarding school records it.</p>
                  <StatusLegend totals={all} mode={mode} />
                  <p className="fdp-config" data-testid="program-config">
                    <b>Program configuration:</b> {formatHalfUnits(PREVIEW_PROGRAM.requiredHalfUnits)} credits ={" "}
                    {formatHalfUnits(PREVIEW_PROGRAM.coreHalfUnits)} core + {formatHalfUnits(PREVIEW_PROGRAM.electiveHalfUnits)} elective (
                    {PREVIEW_PROGRAM.requiredHalfUnits} = {PREVIEW_PROGRAM.coreHalfUnits} + {PREVIEW_PROGRAM.electiveHalfUnits} half-units). A setting of
                    this sample program, not a universal rule.
                  </p>
                </div>
              </div>
            </section>

            <section className="fdp-card fdp-span-4" aria-labelledby="cov-title">
              <div className="fdp-card-head">
                <h2 className="fdp-card-title" id="cov-title">Core and elective coverage</h2>
              </div>
              <div className="fdp-card-body">
                <CoverageBars core={core} elective={elective} mode={mode} />
              </div>
            </section>

            <section className="fdp-card fdp-span-8" aria-labelledby="subj-title">
              <div className="fdp-card-head" style={{ paddingBottom: 12 }}>
                <h2 className="fdp-card-title" id="subj-title">Subject areas</h2>
                <span className="fdp-card-note">One square = one half-unit. Select a subject for detail.</span>
              </div>
              <SubjectStrips subjects={subjects} mode={mode} onOpen={setOpen} />
            </section>

            <section className="fdp-card fdp-span-4" aria-labelledby="ms-title">
              <div className="fdp-card-head">
                <h2 className="fdp-card-title" id="ms-title">Milestones</h2>
                <span className="fdp-card-note">Sample dates</span>
              </div>
              <div className="fdp-card-body">
                <MilestoneTimeline />
              </div>
            </section>

            <section className="fdp-card fdp-span-8" aria-labelledby="next-title">
              <div className="fdp-card-head" style={{ paddingBottom: 8 }}>
                <h2 className="fdp-card-title" id="next-title">Next actions</h2>
                <span className="fdp-card-note">4 sample items</span>
              </div>
              <NextActions />
            </section>

            <section className="fdp-card fdp-span-4" aria-labelledby="file-title">
              <div className="fdp-card-head" style={{ paddingBottom: 8 }}>
                <h2 className="fdp-card-title" id="file-title">Your file</h2>
              </div>
              <FileStatus />
            </section>
          </div>

          <h2 className="fdp-section-label">Go to</h2>
          <QuickLinks />

          <p className="fdp-foot">
            Prototype for design review. Every number, date and status on this page is invented for illustration. Real progress comes from
            the Portal's own records and the awarding school; this page reads none of them.
          </p>
        </main>
      </div>

      <SubjectSheet subject={open} onClose={() => setOpen(null)} />
    </div>
  );
}
