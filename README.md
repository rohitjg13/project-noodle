# noodle

A timetable and course preference management system for colleges. Students pick their electives, class reps manage the schedule, and everyone sees conflicts in real time.

---

## What it does

Colleges typically have a core timetable plus elective/UWE slots that students need to choose from. Noodle handles the full flow:

**Students** pick a minor program and rank their preferred UWE (elective) courses. The system shows them a personal timetable and flags conflicts between their selections and core courses in real time (green/yellow/red).

**Class Representatives (CRs)** get a demand view showing how many students want each UWE, a visual timetable editor to drag and reschedule courses so they suggest minor changes to the profs, and a notification system that alerts them when another CR makes a change that affects their batch.

**Super Admins** manage which users are CRs for which batches, upload the master timetable as an XLSX file, and view demand across all students.

---

## Tech stack

- **SvelteKit** — full-stack framework (frontend + API routes)
- **Svelte 5** with runes mode
- **Tailwind CSS v4**
- **PostgreSQL** via **Drizzle ORM** (self-hosted)
- **Better Auth** — authentication with Google OAuth
- **TypeScript** throughout

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd noodle
npm install
```

### 2. Environment variables

Create a `.env` file:

```env
DATABASE_URL="postgres://user:password@host:port/db-name"
ORIGIN=""                # Base URL, e.g. http://localhost:5173
BETTER_AUTH_SECRET=""    # Random 32+ character string
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

### 3. Push the database schema

```bash
npm run db:push
```

### 4. Add the timetable

Drop your timetable XLSX file into `src/lib/data/`. The admin page will sync batches from it automatically on load.

### 5. Run

```bash
npm run dev
```

---

## Database commands

| Command | Description |
|---|---|
| `npm run db:push` | Push schema changes to the database |
| `npm run db:generate` | Generate migration files |
| `npm run db:studio` | Open Drizzle Studio (visual DB editor) |
| `npm run auth:schema` | Regenerate Better Auth tables |

---

## Roles

| Role | Access |
|---|---|
| `student` | View timetable, submit and lock preferences |
| `cr` | Everything above + manage schedule for assigned batches |
| `super_admin` | Everything + manage CR assignments, view all demand |

User roles are set directly in the `user` table.
