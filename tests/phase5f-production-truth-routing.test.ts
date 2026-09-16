import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("Phase 5F production truth and routing", () => {
  it("routes authenticated users by role and keeps auth pages out of the app shell", () => {
    const app = read("client/src/App.tsx");
    const login = read("client/src/pages/login.tsx");

    expect(app).toContain('user?.role === "admin"');
    expect(app).toContain('<Redirect to="/admin" />');
    expect(app).toContain('location === "/login"');
    expect(app).toContain('location === "/reset-password"');
    expect(app).toContain('location === "/auth/verify"');
    expect(app).toContain('requireRole="student"');
    expect(login).toContain("user?.role === 'admin' ? '/admin'");
  });

  it("uses role-aware sidebar navigation without querying a student profile for admins", () => {
    const sidebar = read("client/src/components/app-sidebar.tsx");

    expect(sidebar).toContain('title: "Admin Dashboard"');
    expect(sidebar).toContain('url: "/admin"');
    expect(sidebar).toContain('enabled: isStudent');
    expect(sidebar).toContain('user?.role === "admin" ? "Admin Portal" : "Student Portal"');
  });

  it("does not present sample admin activity or fake trend percentages", () => {
    const admin = read("client/src/pages/admin.tsx");

    for (const sample of [
      "John Doe",
      "Sarah Smith",
      "Mike Johnson",
      "+12% from last month",
      "+8% from last month",
      "+23% from last month",
      "+15% from last month",
    ]) {
      expect(admin).not.toContain(sample);
    }

    expect(admin).toContain("Activity feed not connected");
  });

  it("does not present hard-coded demo billing history as real billing data", () => {
    const billing = read("client/src/pages/billing.tsx");

    for (const sample of [
      "4242",
      "6199",
      "18799",
      "Sophia Subscription",
      "Monthly Coaching Fee",
      "2024-",
    ]) {
      expect(billing).not.toContain(sample);
    }

    expect(billing).toContain("Billing information is not connected yet");
    expect(billing).toContain("No sample transactions or estimated balances are shown");
  });

  it("distinguishes Programs load failures from an empty programs list", () => {
    const programs = read("client/src/components/programs-management.tsx");

    expect(programs).toContain("programsError");
    expect(programs).toContain("Programs could not be loaded");
    expect(programs).toContain("This is a system error, not an empty programs list.");
    expect(programs).toContain("refetchPrograms");
    expect(programs).toContain("Retry");
  });

  it("does not calculate Flight Deck projections before a real student record exists", () => {
    const flightDeck = read("client/src/pages/flight-deck.tsx");
    const profile = read("client/src/pages/student-profile.tsx");

    expect(flightDeck).toContain("fetchStudentRecordStatus");
    expect(flightDeck).toContain("studentRecordStatus === 'missing'");
    expect(flightDeck).toContain("enabled: studentRecordStatus === 'ready'");
    expect(flightDeck).toContain("Your Lumiere plan is not ready yet");
    expect(flightDeck).toContain("before progress, timeline, and cost projections can be shown");

    expect(profile).toContain("Student record not ready");
    expect(profile).toContain("Your Lumiere advisor must create your student record");
  });
});
