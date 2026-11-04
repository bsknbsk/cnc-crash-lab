# CNC Crash Lab

A browser-based CNC milling trainer: write Fanuc 0i-style G-code, watch a 3D
machine run it, crash safely, and learn from a senior-setter AI instructor.
Built with Next.js, React Three Fiber, Supabase, and the Meta Model API.

## What it does

- **G-code editor + control panel** — Cycle Start runs the program with
  animated tool motion (1 mm/frame on G01, 4 mm/frame on G00), Single Block
  steps one program line per click, Reset homes the tool (X0 Y0 Z200).
  M30 highlights last with a "Program end M30, cycle time `<s>`s" note.
- **3D machine view** — 3-axis VMC (Fanuc 0i style, mm, G21): stock, vise
  jaws, table, tool + holder, work-offset datum markers (G54 always; the
  active offset with a dashed drop line when buried). Crashes trigger a
  spark burst, orange light flash, camera shake, and a synthesized crash
  sound (mutable, persisted).
- **Crash card** — crash type, line number, block text, and the repair cost
  from the `repair_costs` table the instant the crash is detected, plus a
  red 3× flash on the collided solid.
- **Instructor agent** — "Ask the Instructor" streams a debrief (NDJSON)
  with a tool-call trace: the model looks up G/M codes, quotes the repair
  cost, and must pass a corrected program through the simulator. A "Load
  fixed program" button copies the fix into the editor.
- **Exam mode** — a Fault Injector agent breaks the GOOD program in one
  place per crash type and saves simulator-verified faults to Supabase.
  Practice/Exam tabs, hints, model credit, per-browser progress in
  `localStorage`, and pass/fail on Cycle Start.
- **Program sheet scan** — photograph a printed/handwritten program; a
  vision model transcribes it, unclear lines highlight amber, parse errors
  list under the editor.

## Simulator (`lib/sim`, pure TypeScript, no React)

Deterministic Fanuc 0i milling subset: G00/G01/G17/G21/G28/G40/G43/G49/
G54/G55/G90/G91, M03/M05/M06/M08/M09/M30, T/S/F/H words. Machine model is
axis-aligned boxes (tool radius 5 mm, holder radius 20 mm) sampled every
0.5 mm. Crash types: `MISSING_G43`, `WRONG_WORK_OFFSET`,
`RAPID_INTO_STOCK`, `RAPID_INTO_VISE`, `FEED_SPINDLE_OFF`. Crash events
carry the impact point plus commanded/actual Z targets and `zErrorMm`.
`M30` ends the program and resets modal state. Repair prices come only
from the `repair_costs` table — never invented.

## Setup

```bash
npm install
```

Create `.env.local` (Vercel Supabase integration names):

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
MODEL_API_KEY=<meta-model-api-key>
# Optional: route fault injection through a hosted Muse Spark endpoint
# OPEN_MODEL_BASE_URL=
# OPEN_MODEL_API_KEY=
# OPEN_MODEL_ID=
```

Apply `supabase/schema.sql` in the Supabase SQL editor (creates the
`repair_costs` table with seed rows and habits, plus the `exam_faults`
table with RLS enabled).

```bash
npm run dev      # http://localhost:3000
npm run lint
npx tsc --noEmit
```

## API routes (`app/api`)

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Env flags, Supabase host, `repair_costs` row count/types. `await connection()`, no route config (cacheComponents is on). |
| `/api/cost?type=` | GET | One repair-cost row, or the full table when no `type`. |
| `/api/instructor` | POST `{ program, crash }` | Streams NDJSON (`thinking`/`step`/`done`/`error`). `maxDuration = 300`. |
| `/api/fault` | POST `{ program, crashType }` | Generates + saves one verified fault. `maxDuration = 120`. |
| `/api/exam` | GET `?exclude=` | Random saved fault + table total. |
| `/api/vision` | POST multipart `image` | Transcribes a program sheet photo, returns program + unclear lines + parse errors. `maxDuration = 60`. |

Server-only modules (`lib/supabase.ts`, `lib/meta.ts`, `lib/cost.ts`,
`lib/instructor.ts`, `lib/fault.ts`) are never imported by client
components. The simulator is the only judge of crashes: every agent tool
result and every UI claim goes back through `simulate()`.

## Scripts

```bash
npx tsx scripts/test-sim.ts        # simulator contract checks
node --env-file=.env.local --import tsx scripts/generate-faults.ts
# 5 verified faults x 5 crash types into exam_faults
```

## Sample programs (`data/samples.ts`)

`GOOD` plus one variant per crash type. `data/gcode-reference.json` holds
the one-line Fanuc meanings the Instructor may quote (unknown codes are
never explained from memory).

## Project rules (short)

- Simulator code stays framework-free so API routes can import it.
- Every Meta API call happens in `app/api/*`; the secret key never
  reaches the browser.
- No secrets in files other than `.env.local`. No commits/pushes
  without being asked.
