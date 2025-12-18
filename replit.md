# Lumiere Student Portal

## Overview
The Lumiere Student Portal is a comprehensive platform designed to track student degree progress, managing both transfer credits (Phase 1) and university residency requirements (Phase 2). Its primary purpose is to streamline the academic journey for students, providing tools for roadmap generation, financial planning, and profile management. The project aims to offer a robust, multi-role system that supports students, coaches, and administrators in managing degree progression efficiently.

## User Preferences
- I prefer simple language and clear explanations.
- I like functional programming paradigms where applicable.
- I want an iterative development process, with frequent updates and feedback loops.
- Please ask for my confirmation before making any major architectural changes or significant code refactors.
- When making changes, prioritize security and performance.
- Do not make changes to the `attached_assets/` folder.
- Do not make changes to the `SUPABASE_SETUP.md` file.

## System Architecture
The Lumiere Student Portal utilizes a modern web stack.

**UI/UX Decisions:**
- **Frontend Framework:** React 18 with Wouter for client-side routing.
- **Styling:** Tailwind CSS for utility-first styling.
- **Component Library:** shadcn/ui primitives with custom theming for a consistent look and feel.
- **Color Scheme:** Professional blue primary, muted grays, and semantic status colors.
- **Typography:** Inter for body text and JetBrains Mono for data/numbers.
- **Layout:** Features a sidebar navigation, card-based content, and a responsive grid system.
- **Dark Mode:** Full support with a theme toggle.
- **Public Landing Page:** A static HTML page at the root (`/`) with branding, login/signup modals, and redirection to the dashboard upon successful authentication.

**Technical Implementations:**
- **State Management:** React Query for efficient server state management.
- **Backend:** Express.js + Node for the API layer.
- **Database ORM:** Drizzle ORM for type-safe database interactions.
- **Authentication:** Supabase Auth integration with secure session token management, supporting email/password authentication and a demo mode. Role-based access control (student, coach, admin) is planned.
- **Demo Mode:** Full offline development support via `ALLOW_DEMO_MODE=true` environment flag. When enabled, all student operations (CRUD, contacts, English proof, photo uploads) use Drizzle ORM with in-memory storage instead of Supabase. Repository layer serializes Date objects to ISO strings to match production API contract. Audit logging automatically skips Supabase writes in demo mode. Photo uploads use base64 data URLs instead of Supabase Storage. Demo account: `demo@student.lumiere.app / demo123` (user_id: `fcad952c-adb6-45fb-8ea8-9ee1356a80dd`, student_code: `LUM-2024-001`).
- **Security:** Helmet for security headers (HSTS, secure cookies, CORS), Redis-backed rate limiting, and Sentry for error tracking.
- **Roadmap Generator:** A deterministic algorithm generates 120-credit degree plans, balancing provider and university courses while enforcing residency and upper-level credit minimums. It includes a financial calculator with duration-based pricing and payment scheduling.
- **Student Profile Management:** Comprehensive UI at `/profile` for managing identity, contact information, eligibility, and authorized contacts. Implemented with React Hook Form, shadcn Form components, and Zod validation, including conditional logic and data cleaning.
- **Production-Ready Infrastructure:** Includes structured logging with Winston, streaming compression (gzip/deflate), and health check endpoints.

**Feature Specifications:**
- **Phase 1 (Transfer Credits):** Tracking and mapping courses from providers like Sophia, Study.com, and ACE to UMPI distribution requirements, with automatic credit aggregation and distribution bucket tracking.
- **Phase 2 (UMPI Residency):** Enforcement of a minimum 30-credit residency and upper-level credit tracking (minimum 24 credits), with transition logic from Phase 1.
- **Requirement Engine:** Articulation matching with priority, greedy credit allocation, cap enforcement, residual gap calculation, and course recommendations.
- **Multi-Role System:** Distinct functionalities for Students (roadmap, documents, billing), Coaches (student monitoring, task management, credit approval), and Admins (mapping editor, catalog management, audit logs).
- **Flight Deck Dashboard (PRODUCTION-READY):** Student progress cockpit at `/flight-deck` providing real-time visibility into credits, pace, time-to-completion, and cost projections. All features implemented and E2E tested.
  - **Core Infrastructure (COMPLETE):** Deterministic calculation engine (`shared/flight-deck-engine.ts`) with real data integration from enrollments/metrics/financial data. Server-side orchestration service (`server/services/flight-deck-service.ts`) with 3-tier fallback strategy. Responsive 12-column grid layout with summary bar (4 key metrics). Demo mode fully supported.
  - **Visualizations (COMPLETE):** Four recharts-based charts in `client/src/components/flight-deck-charts.tsx`: Credits Donut Chart (3 segments with legend), Pace Gauge Chart (radial with dynamic color zones), Timeline Projection Chart (area chart with cumulative progression), Cost Breakdown Chart (donut with tuition/subscription breakdown). All charts accessible with role=img, aria-labels, and theme integration.
  - **Enhanced Insights (COMPLETE):** Structured insight system with Budget Watch (cost warnings), Milestones (progress celebrations), Next Best Actions (pace/credits/budget recommendations). Priority-based ranking with icon mapping to Lucide icons. All text emoji-free, ASCII-compliant.
  - **Accessibility (WCAG 2.1 AA COMPLIANT):** Interactive help popovers on all four core metrics (Credits, Pace, Time to Completion, Cost Breakdown) explaining data sources and calculations. Implemented with shadcn Popover components (Radix UI) for full keyboard accessibility: Tab navigation, Enter/Space to open, Escape to close, click-outside dismiss. All triggers have aria-labels, meet 44x44px hit target minimum, and include data-testid attributes for testing. E2E verified on desktop and mobile.
  - **Performance & Polish (COMPLETE):** React Query caching (5-min staleTime), React.memo optimization, validation helpers (validateNumber/Credits/Pace), error handling with retry logic, mobile responsiveness (tested iPhone 12 Pro), loading states with skeletons.
  - **E2E Validation (COMPLETE):** Comprehensive Playwright testing verified authentication, navigation, all cards/charts, accessibility (keyboard/mobile), ASCII compliance (0 non-ASCII characters), API/UI data parity. Production-ready.

## External Dependencies
- **Supabase:** Used for PostgreSQL database, authentication, and storage.
- **Stripe:** Planned for payment processing and billing (webhooks integrated).
- **Redis:** Used for distributed rate limiting (with in-memory fallback).
- **Sentry:** Integrated for error tracking.