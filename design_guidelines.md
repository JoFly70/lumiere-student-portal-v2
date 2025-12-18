# Lumiere Student Portal - Design Guidelines

## Design Approach
**System**: Material Design principles adapted for educational technology, drawing inspiration from modern academic platforms like Canvas and administrative interfaces like Linear for clean data presentation.

**Core Principles**:
- Clarity over decoration: Information hierarchy drives every layout decision
- Scannable content: Students should quickly grasp their progress status
- Professional confidence: Design conveys reliability and institutional trust

---

## Typography

**Font Stack**: 
- Primary: Inter (weights: 400, 500, 600, 700)
- Monospace: JetBrains Mono for data/numbers

**Hierarchy**:
- Page Headers: text-3xl font-bold
- Section Headers: text-xl font-semibold
- Subsections: text-lg font-medium
- Body: text-base font-normal
- Labels/Meta: text-sm font-medium
- Data Points: text-2xl font-bold (progress percentages, credits)

---

## Layout System

**Spacing Units**: Tailwind units of 4, 6, 8, and 12 for consistency
- Component padding: p-6 or p-8
- Section gaps: gap-6 or gap-8
- Page margins: px-4 md:px-8 lg:px-12

**Grid Structure**:
- Sidebar navigation: w-64 fixed left
- Main content: ml-64 with max-w-7xl container
- Dashboard cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3

---

## Component Library

### Navigation
**Sidebar** (fixed left, full height):
- Logo/branding at top (h-16)
- Navigation items with icons (Heroicons)
- Active state indicator (left border accent)
- User profile section at bottom

### Dashboard Cards
**Progress Summary Cards**:
- White background, rounded-lg, shadow-sm
- Header with icon + title (flex justify-between)
- Large number display (text-4xl font-bold) for key metrics
- Progress bars underneath (h-3 rounded-full)
- Footer with secondary stats (text-sm)

**Phase Overview Cards**:
- Two-column layout on desktop (Phase 1 | Phase 2)
- Status badges (inline-flex items-center px-3 py-1 rounded-full text-sm)
- Bulleted requirements lists
- Visual separator between phases

### Course Roadmap
**Table Layout**:
- Sticky header row (position: sticky top-0)
- Columns: Course Code | Title | Credits | Provider | Status | Actions
- Alternating row backgrounds for readability
- Status indicators: pills with distinct states (completed, in-progress, pending)
- Expandable rows for course details (chevron icon toggle)

**Provider Badges**: Small rounded pills showing Sophia/Study.com/ACE/UMPI

### Document Upload Panel
**Upload Zone**:
- Dashed border rectangle (border-2 border-dashed)
- Center-aligned icon and text
- "Drag & drop or click to browse" instruction
- File type restrictions displayed (text-xs)

**Document List**:
- Card-based list with file icon, name, size, upload date
- Download/delete action buttons (text-sm)
- Preview thumbnails for images

### Billing Screen
**Invoice Table**:
- Grid layout: Date | Description | Amount | Status | Actions
- Total row at bottom (font-semibold, border-t-2)
- Payment status badges (paid/pending/overdue)
- Download invoice button per row

**Account Summary Card**:
- Current balance (large display)
- Next payment due date
- Payment method on file
- "Make Payment" CTA button

### Admin Panel
**Control Cards**:
- Action-oriented cards with icon headers
- Descriptive text explaining each function
- Primary action button per card
- "Simulate Import" and "Recalculate Plan" as key actions

**Import Simulation Form**:
- File upload input
- Student selection dropdown
- Preview table of parsed data
- Confirm/cancel action buttons

---

## Key UI Patterns

**Progress Bars**: 
- Container: h-3 w-full rounded-full
- Fill: rounded-full transition-all duration-300
- Always show percentage label adjacent

**Data Tables**:
- Header: font-semibold text-sm uppercase tracking-wide
- Cells: py-4 px-6 with vertical borders
- Hover state on rows for interactivity
- Sorting indicators in headers (up/down arrows)

**Forms**:
- Label above input: text-sm font-medium mb-2
- Input fields: rounded-md border px-4 py-2.5
- Helper text below: text-xs
- Error states: red border with error message

**Buttons**:
- Primary: px-6 py-2.5 rounded-md font-medium
- Secondary: Similar sizing with border variant
- Icon buttons: p-2 rounded-md (for actions in tables)

---

## Responsive Behavior

- Mobile: Stack all cards vertically, collapse sidebar to hamburger menu
- Tablet: Two-column card layouts, persistent sidebar
- Desktop: Full three-column layouts, expanded sidebar

---

## Images

**No hero image** - This is a functional dashboard. Focus on data visualization and clarity.

**Icons**: Use Heroicons throughout for consistency
- Navigation items
- Card headers
- Status indicators
- File types
- Action buttons