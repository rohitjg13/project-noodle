# CLAUDE.md — Project Noodle

## Project Overview

**Noodle** is a SvelteKit full-stack web application for managing college course timetables and elective (UWE) preferences. It supports three user roles — student, CR (class representative), and super_admin — with Google OAuth authentication, drag-and-drop schedule editing, conflict detection, and a CR notification system.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit v2 + Svelte 5 (runes mode) |
| Language | TypeScript 5 (strict mode) |
| Styling | Tailwind CSS v4 (Vite plugin) |
| Database | PostgreSQL (self-hosted) |
| ORM | Drizzle ORM |
| Auth | Better Auth (minimal build) + Google OAuth |
| Build | Vite 7 |
| Data | xlsx library for Excel/XLSX parsing |

---

## Repository Structure

```
src/
├── lib/
│   ├── server/
│   │   ├── auth.ts              # Better Auth instance (Google OAuth, role field)
│   │   └── db/
│   │       ├── index.ts         # Drizzle PostgreSQL client
│   │       ├── schema.ts        # Main app schema (preferences, schedules, constraints)
│   │       ├── auth.schema.ts   # Better Auth tables (users, sessions, accounts)
│   │       └── app.schema.ts    # Batches, CR assignments, notifications
│   ├── data/
│   │   └── *.xlsx               # Master timetable spreadsheet (source of truth)
│   ├── types.ts                 # Shared types, parsing utils, conflict detection
│   ├── auth-client.ts           # Client-side Better Auth instance
│   └── index.ts                 # Library barrel (currently empty)
├── routes/
│   ├── +layout.svelte           # Root layout (CSS imports)
│   ├── +layout.server.ts        # Session load for all routes
│   ├── +page.svelte             # Main dashboard (~1000+ lines, student + CR views)
│   ├── +page.server.ts          # Dashboard data loading
│   ├── login/                   # Google OAuth sign-in page
│   ├── admin/                   # Super admin CR assignment + XLSX sync
│   ├── auth/signout/            # Sign-out endpoint
│   └── api/
│       ├── auth/[...all]/       # Better Auth catch-all handler
│       ├── student/preferences/ # GET/POST preferences; /lock endpoint
│       ├── cr/schedule/         # GET/POST/DELETE schedule overrides
│       ├── cr/demand/           # GET UWE demand stats (role-scoped)
│       ├── cr/constraints/      # GET/POST/DELETE professor unavailability
│       ├── cr/notify/           # POST notify other CRs
│       ├── timetable/           # GET parsed XLSX timetable data
│       └── notifications/       # GET/DELETE user notifications
static/                          # favicon.svg, robots.txt
drizzle.config.ts                # Drizzle ORM config
svelte.config.js                 # SvelteKit config (runes mode, adapter-auto)
vite.config.ts                   # Vite plugins (tailwindcss, sveltekit)
```

---

## Development Setup

### Prerequisites

- Node.js (engine-strict is enabled — check `.npmrc` and `package.json` for required version)
- PostgreSQL database

### Environment Variables

Copy `.env.example` to `.env` and populate all values:

```env
DATABASE_URL="postgres://user:password@host:port/db-name"
ORIGIN=""                    # Full base URL, e.g. http://localhost:5173 (required for OAuth)
BETTER_AUTH_SECRET=""        # 32+ char random string
GOOGLE_CLIENT_ID=""          # From Google Cloud Console
GOOGLE_CLIENT_SECRET=""      # From Google Cloud Console
```

All environment variables are loaded via `$env/dynamic/private` (runtime, not bundled).

### First-time Setup

```bash
npm install
npm run db:push          # Apply schema to database
# Add XLSX file to src/lib/data/ (timetable source)
npm run dev              # Start dev server at localhost:5173
```

### Common Dev Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run preview          # Preview production build
npm run check            # Type-check (svelte-check)
npm run check:watch      # Type-check in watch mode
npm run db:push          # Apply schema changes directly to DB
npm run db:generate      # Generate migration files
npm run db:migrate       # Run pending migrations
npm run db:studio        # Open Drizzle Studio (visual DB editor)
npm run auth:schema      # Regenerate auth.schema.ts from Better Auth config
```

---

## Key Conventions

### Svelte 5 Runes

Runes mode is enabled globally (`svelte.config.js`). Use the new Svelte 5 syntax:

```ts
// State
let count = $state(0);

// Derived
let doubled = $derived(count * 2);

// Effects
$effect(() => { console.log(count); });

// Props
let { name }: { name: string } = $props();
```

Do **not** use the legacy `export let` syntax for props or `$:` reactive statements.

### TypeScript

- Strict mode is enabled — no implicit `any`, null checks enforced
- `moduleResolution: bundler` — use bare specifiers and SvelteKit path aliases (`$lib/...`)
- All API responses should be typed (return `json(typedData)`)

### Authentication & Authorization

The session is resolved in `src/hooks.server.ts` and exposed via `locals.user`.

Standard auth guard pattern used in every API route:

```ts
// Unauthorized (not logged in)
if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

// Forbidden (wrong role)
if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
  return json({ error: 'Forbidden' }, { status: 403 });
}
```

**Roles:**
- `student` — Can view timetable, set/lock elective preferences
- `cr` — Can move courses, view demand, manage constraints, notify peers
- `super_admin` — All CR permissions plus batch management and XLSX sync

### Database Patterns

- Schema files live in `src/lib/server/db/`; never import DB from client code
- Always use Drizzle's typed query builder; avoid raw SQL unless necessary
- Composite unique keys are used for upserts (e.g., schedule overrides keyed on `courseCode|component|originalDay`)
- Cascading deletes are set on foreign keys — be careful when deleting parent records
- Timestamps use `.$onUpdate(() => new Date())` for auto-updates

**Schema change workflow:**

```bash
# 1. Edit src/lib/server/db/schema.ts (or auth.schema.ts / app.schema.ts)
# 2. Generate migration
npm run db:generate
# 3. Review the generated file in drizzle/
# 4. Apply to database
npm run db:push
```

### API Route Conventions

- All API routes use SvelteKit's `+server.ts` pattern
- Return `json(data)` from `@sveltejs/kit` (not `Response`)
- Errors return `json({ error: 'message' }, { status: NNN })`
- Batch-scoped data: CRs only see data for batches they are assigned to; super_admin sees all

### Styling

- Dark mode only design — no light theme
- CSS variables defined in `src/routes/layout.css`:
  - `--bg: #0a0a0a` (background)
  - `--fg: #e8e8e8` (foreground text)
  - `--muted: #888` (secondary text)
  - `--border: #222` (borders)
  - `--surface: #111` (card backgrounds)
  - `--accent: #fff` (highlights)
- Fonts: `--font-mono: JetBrains Mono` (UI), `--font-serif: Instrument Serif` (branding)
- Use Tailwind utilities for layout/spacing; use CSS variables for theme colors

---

## Domain Logic

### Timetable & XLSX

- The master timetable lives as an Excel file in `src/lib/data/`
- Parsed at runtime by `GET /api/timetable` using the `xlsx` library
- Column names are normalized (handles variations like "Course Code" vs "CourseCode")
- Each row yields a `Course` object (see `src/lib/types.ts`)

### Conflict Detection

Implemented in `src/lib/types.ts`:

- `parseDays(day: string)` — converts "MWF", "TTh", "M" etc. to arrays of day names
- `timeToMinutes(time: string)` — converts "9:30 AM" to minutes since midnight
- `getConflictLevel(uwe, coreCoursesForStudent)` — returns `"green" | "yellow" | "red"`
  - `green` = no overlap
  - `yellow` = tutorial/lab overlap only
  - `red` = lecture overlap

### Priority Scoring

Used to rank UWE demand:

```
score = (rank1 selections × 3) + (rank2 selections × 2) + (rank3 selections × 1)
```

Defined in `src/lib/types.ts` as `calculatePriorityScore(p1, p2, p3)`.

### Schedule Override Key

Schedule blocks use a composite key: `courseCode|component|originalDay`

This allows multiple day-slots of the same course to be independently rescheduled. The `component` field may be `null` — normalize to empty string when constructing keys.

### Notification System

- Triggered when a CR moves a course that appears in the **top-5 global demand** UWE list
- Notifications are sent to CRs of all batches that have students with that UWE in their preferences
- Notifications are dismissible and fetched via `GET /api/notifications`

---

## Testing

**There are no automated tests.** Manual testing is the current approach. When implementing features:

- Test the Google OAuth flow in the browser
- Verify role-based access (student vs CR vs super_admin views)
- Check timetable conflict indicators (green/yellow/red)
- Test mobile drag-and-drop (touch events are separate from mouse events)

---

## Common Pitfalls

1. **ORIGIN env var** — Must be set correctly for OAuth callbacks to work. In development: `http://localhost:5173`.

2. **Better Auth role field** — The `role` field is a custom extension. `hooks.server.ts` does a fallback DB lookup because Better Auth minimal build may not include custom user fields in the session.

3. **XLSX file location** — The timetable file must be placed in `src/lib/data/`. The API uses `import.meta.glob` to find any `.xlsx`, `.xls`, or `.csv` file there.

4. **Batch matching** — Student `batch` field can be comma-separated. CR batch assignments use case-insensitive matching (`ILIKE`). Be consistent when writing queries.

5. **Runes mode** — All Svelte files compile in runes mode. Using legacy reactive syntax (`$:`, `export let`) will cause errors.

6. **DB schema split** — The schema is across three files: `schema.ts` (app), `auth.schema.ts` (Better Auth), `app.schema.ts` (batches/notifications). Import from the correct file; `index.ts` re-exports the DB client, not the schema.

7. **engine-strict** — `.npmrc` sets `engine-strict=true`. Use the Node version specified in `package.json` engines field or you'll get install errors.
