/**
 * S32-B SA-16: the staff Students directory, Owner AI panel and High School Pathway screens render in French
 * (and unchanged in English). Rendered with react-dom/server; queries are answered from fixtures by key.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const NOW = Date.now();
const STUDENTS = [
  { id: "s-1", first_name: "Amélie", last_name: "Tremblay", status: "active", student_code: "LUM-001", email: "amelie@fixture.local", user_id: null },
];
const FACTS = [
  { studentId: "s-1", program: null, billing: { currency: "USD", agreedCents: 100000, netCents: 100000, paidCents: 0, balanceCents: 100000, overdue: true }, lastActivityAt: new Date(NOW - 3 * 86_400_000).toISOString() },
];

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: vi.fn((opts: { queryKey: readonly unknown[] }) => {
    const key = String(opts.queryKey[0]);
    if (key === "/api/students") return { isLoading: false, isError: false, data: { students: STUDENTS }, refetch: vi.fn() };
    if (key === "/api/admin/directory/students") return { isLoading: false, isError: false, data: { facts: FACTS }, refetch: vi.fn() };
    if (opts.queryKey[1] === "status") return { isLoading: false, isError: false, data: { mode: "unavailable", reason: "not_configured" }, refetch: vi.fn() };
    return { isLoading: false, isError: false, data: undefined, refetch: vi.fn() };
  }),
  useMutation: vi.fn(() => ({ isPending: false, isError: false, mutate: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() })),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({ user: { role: "staff" } }),
}));
vi.mock("@/hooks/use-tickets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-tickets")>()),
  useTickets: () => ({ data: { tickets: [] }, isLoading: false, isError: false }),
}));

import { I18nProvider, type Language } from "@/i18n";
import AdminStudents from "@/pages/admin-students";
import { OwnerAssistantPanel } from "@/components/owner-assistant/owner-assistant-panel";
import { HighSchoolWorkspace } from "@/pages/admin-student-high-school";
import { ProgramSection } from "@/components/admin/high-school/program-section";
import { GraduationSection } from "@/components/admin/high-school/graduation-section";
import { SearchResultsView } from "@/components/os/global-search";
import { relativeTime, studentStatusLabel, studentStatusText } from "@/components/admin/directory/directory-data";
import { hsx } from "@/components/admin/high-school/hs-i18n";
import { translate } from "@/i18n";
import { FIXTURE_DOCS, HS_STUDENT_ID, staffStateRich } from "./helpers/s11-hs-staff-fixtures";

const render = (lang: Language, el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(I18nProvider, { initialLanguage: lang },
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(Router, { ssrPath: "/admin/students" }, el))),
  );
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("S32-B SA-16 students directory", () => {
  it("renders French chrome and keeps student data as delivered", () => {
    const out = render("fr", React.createElement(AdminStudents));
    const t = text(out);
    expect(t).toContain("Portail du personnel · Étudiants");
    expect(t).toContain("1 étudiant");
    expect(t).toContain("Ouvrez un dossier pour voir tout ce qui concerne un étudiant au même endroit.");
    expect(t).toContain("Tout le monde");
    expect(t).toContain("Documents à examiner");
    expect(t).toContain("Afficher les étudiants de démonstration");
    expect(t).toContain("Paiement en retard");
    expect(t).toContain("Aucun programme pour l’instant");
    expect(t).toContain("Actif");
    expect(t).toContain("Dernière activité");
    expect(t).toContain("Amélie Tremblay");
    expect(out).toContain('placeholder="Nom, courriel ou code étudiant"');
    expect(out).toContain('aria-label="Ouvrir Amélie Tremblay"');
    for (const en of ["Staff Portal", "Everyone", "Show demo students", "Needs attention", "Documents to review", "Payment overdue", "Nothing waiting", "No program yet"]) {
      expect(t).not.toContain(en);
    }
  });

  it("is unchanged in English", () => {
    const t = text(render("en", React.createElement(AdminStudents)));
    expect(t).toContain("Staff Portal · Students");
    expect(t).toContain("1 student.");
    expect(t).toContain("Everyone");
    expect(t).toContain("Payment overdue");
  });

  it("helpers keep English defaults and translate on request", () => {
    expect(relativeTime(null)).toBe("No activity yet");
    expect(relativeTime(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe("2h ago");
    expect(relativeTime(new Date(NOW - 5 * 86_400_000).toISOString(), NOW, "fr")).toBe("Il y a 5 jours");
    expect(relativeTime(null, NOW, "fr")).toBe("Aucune activité pour le moment");
    expect(studentStatusLabel("lead")).toBe("Pre-enrollment");
    expect(studentStatusText("lead", "fr")).toBe("Préinscription");
    expect(studentStatusText("some_new_state", "fr")).toBe("Some new state");
  });
});

describe("S32-B SA-16 Owner AI panel", () => {
  it("renders French labels, reasons and suggestions", () => {
    const out = render("fr", React.createElement(OwnerAssistantPanel, { studentId: "s-1", studentLabel: "Amélie Tremblay" }));
    const t = text(out);
    expect(t).toContain("IA Lumière pour la direction");
    expect(t).toContain("Lit uniquement les dossiers enregistrés de Amélie Tremblay");
    expect(t).toContain(", les cite et ne modifie jamais rien.");
    expect(t).toContain("IA indisponible");
    expect(t).toContain("Aucune clé de fournisseur d’IA n’est configurée sur le serveur.");
    expect(t).toContain("Poser une question sur cet étudiant");
    expect(t).toContain("Rédiger une réponse à l’étudiant");
    expect(t).toContain("Pour cet étudiant, quels cours et quels documents nécessitent encore une action ?");
    expect(out).toContain('aria-label="Questions suggérées"');
    expect(out).toContain('<option value="fr" selected="">Français</option>');
    for (const en of ["Ask about this student", "Draft a reply", "AI unavailable", "Suggested questions"]) expect(text(out)).not.toContain(en);
  });

  it("stays English (and answers in English) by default", () => {
    const out = render("en", React.createElement(OwnerAssistantPanel, { studentId: "s-1" }));
    expect(text(out)).toContain("Lumière Owner AI");
    expect(text(out)).toContain("Ask about this student");
    expect(out).toContain('<option value="en" selected="">English</option>');
  });
});

describe("S32-B SA-16 high school pathway (staff)", () => {
  const state = staffStateRich();
  const view = (lang: Language, C: React.ComponentType<any>, props: Record<string, unknown>) =>
    text(render(lang, React.createElement(C, { state, studentId: HS_STUDENT_ID, isAdmin: true, docs: FIXTURE_DOCS, ...props })));

  it("workspace chrome, tabs, summary and governance notice are French", () => {
    const t = view("fr", HighSchoolWorkspace, { defaultTab: "program" });
    for (const fr of ["Retour au dossier étudiant", "Portail du personnel · Secondaire", "Parcours du secondaire", "Études antérieures", "Feuille de route", "Révisions et résultats", "Diplomation", "Tuteurs", "Activité", "Crédits officiellement obtenus", "Lumière planifie et coordonne."]) {
      expect(t).toContain(fr);
    }
    for (const en of ["Back to student file", "High school pathway", "Prior study", "Officially earned credit", "Lumière plans and coordinates"]) expect(t).not.toContain(en);
  });

  it("program and graduation sections translate headings, buttons, statuses and lib notices", () => {
    const program = view("fr", ProgramSection, { initialOpenForm: null });
    for (const fr of ["Programme du secondaire", "Historique des inscriptions", "Divulgation de l’établissement", "Importer un diplômé historique", "Modifier le programme", "Actif"]) expect(program).toContain(fr);
    for (const en of ["Enrollment history", "Institution disclosure", "Import a historical graduate"]) expect(program).not.toContain(en);
    const grad = view("fr", GraduationSection, { initialOpenForm: null });
    for (const fr of ["Admissibilité", "Remise du relevé de notes et du diplôme", "Autorisation financière", "Étape 1"]) expect(grad).toContain(fr);
    for (const en of ["Transcript and diploma delivery", "Financial clearance", "Step 1"]) expect(grad).not.toContain(en);
  });

  it("English output is unchanged", () => {
    const t = view("en", HighSchoolWorkspace, { defaultTab: "program" });
    expect(t).toContain("High school pathway");
    expect(t).toContain("Back to student file");
    expect(t).toContain("Officially earned credit");
  });

  it("hsx translates known logic-module output in French only", () => {
    expect(hsx("fr", "Only an administrator can publish the approved roadmap.")).toBe("Seul un administrateur peut publier la feuille de route approuvée.");
    expect(hsx("fr", "Add a note of at least 3 characters for the record.")).toBe("Ajoutez une note d’au moins 3 caractères pour le dossier.");
    expect(hsx("fr", "On hold")).toBe("En suspens");
    expect(hsx("fr", "Started Oct 26, 2026")).toBe("Débuté le 26 oct. 2026");
    expect(hsx("fr", "Spanish 1 (course title is data)")).toBe("Spanish 1 (course title is data)");
    expect(hsx("en", "On hold")).toBe("On hold");
  });
});

describe("S32-B SA-16 staff global search wording", () => {
  const base = { groups: [], active: 0, idPrefix: "gs", t: (k: string, v?: Record<string, string | number>) => translate("fr", k, v) };
  it("uses student-specific hints for staff only", () => {
    const staff = renderToStaticMarkup(React.createElement(SearchResultsView, { ...base, query: "", status: "idle", audience: "staff" }));
    expect(text(staff)).toContain("Saisissez au moins 2 caractères pour rechercher un étudiant.");
    const student = renderToStaticMarkup(React.createElement(SearchResultsView, { ...base, query: "", status: "idle" }));
    expect(text(student)).toContain("dans vos dossiers");
    const err = renderToStaticMarkup(React.createElement(SearchResultsView, { ...base, query: "abc", status: "error", audience: "staff" }));
    expect(text(err)).toContain("La recherche d’étudiants est indisponible pour le moment.");
  });
});
