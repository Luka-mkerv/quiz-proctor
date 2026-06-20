# Quiz Proctor

A self-hosted, live-monitored quiz/exam tool built for SQL midterms and quizzes — designed to deter casual cheating, give lecturers real-time visibility into student behavior during an exam, and keep a permanent audit trail of every submission.

Built end-to-end: Postgres schema → Express/Socket.IO backend → React/Vite frontend, fully containerized for local development with Docker Compose.

---

## What it does

**For lecturers:**
- Secure login (JWT-based, no public signup — accounts are seeded manually)
- Create quizzes with any number of free-text questions, an optional time limit, and a choice of monitoring strictness
- Lock, open, or close a quiz at will — students can only access it while it's open
- Get a shareable link the moment a quiz opens (`/quiz/:id`), safe to post anywhere (Argus, email, etc.)
- Watch a **live monitor** during the exam — every student shown as a compact chip, turning red the moment they're flagged, with a click-through history of exactly what happened and when
- Review full **results** after the fact — every student's answers, submission status (on time / auto-submitted / in progress), and complete violation history
- Delete a quiz (with a confirmation step) — cascades cleanly, removing all of its questions, submissions, answers, and violations

**For students:**
- No account needed — just a name and the link
- Clean, distraction-free quiz page: enter fullscreen, answer questions, autosave as you type
- Optional countdown timer, visible at all times
- Manual submit, or automatic submit when time runs out
- Can't edit or resubmit after finishing; can't start a second attempt under the same name once submitted

**Two monitoring modes, set per quiz:**
- **Lenient** — leaving the exam window (tab switch, alt-tab, exiting fullscreen) is logged as a flag, visible to the lecturer live and in results, but the student keeps going uninterrupted
- **Strict** — the same actions trigger a 6-second on-screen countdown ("Return to Exam Now or you'll be auto-submitted"). Returning in time logs the flag and continues the exam; letting it expire ends the attempt immediately. This protects against accidental Escape-key taps while still being meaningfully strict against actual cheating attempts. A best-effort `beforeunload` handler also fires a final submit if the tab is closed outright.

---

## Architecture

```
quiz-proctor/
├── docker-compose.yml        Postgres + backend, containerized for local dev
├── backend/
│   ├── src/
│   │   ├── index.js          Express app + Socket.IO server
│   │   ├── routes/
│   │   │   ├── auth.js       Lecturer login (JWT)
│   │   │   ├── quizzes.js    Authenticated quiz CRUD, results, delete
│   │   │   └── public.js     Public student flow (no auth)
│   │   ├── socket/index.js   Live violation broadcast (lecturer + student rooms)
│   │   ├── middleware/requireAuth.js
│   │   └── db/
│   │       ├── pool.js
│   │       ├── migrate.js    Plain-SQL migration runner
│   │       ├── seedLecturer.js
│   │       └── migrations/   001–006, applied in order
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── pages/             Login, Dashboard, Create Quiz, Quiz Detail,
    │   │                      Live Monitor, Results, Student Quiz page
    │   └── lib/api.js         Axios client, auto-attaches JWT from localStorage
    └── vite.config.js
```

**Stack:** Node/Express, PostgreSQL, Socket.IO, React + Vite + Tailwind CSS, Docker Compose.

**Database:** `lecturers`, `quizzes` (status: locked/open/closed, monitoring_mode: lenient/strict, optional duration), `questions`, `submissions` (one per student per quiz, resumable on refresh), `answers` (autosaved per question), `violations` (typed: tab_switch, window_blur, fullscreen_exit, fullscreen_reenter, etc., timestamped).

**Real-time layer:** Socket.IO rooms scoped per quiz (`quiz:{id}`). Students join and emit violations; lecturers join (with JWT) and receive live broadcasts. Disconnects are tracked separately from violations — a dropped connection isn't treated as cheating.

---

## Setup (local development)

Requires Docker, Node.js, and `pnpm` (or `npm`).

**1. Start the backend (Postgres + Express + Socket.IO):**
```bash
docker compose up -d --build
docker compose exec backend npm run migrate
docker compose exec backend node src/db/seedLecturer.js "you@example.com" "yourpassword" "Your Name"
```

Verify it's up:
```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

**2. Start the frontend:**
```bash
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:3000`, log in with the credentials you seeded.

**Important:** any time a new migration file is added (check `backend/src/db/migrations/`), run the migrate command again before testing — new DB columns/enum values won't exist until it's applied. This bit us once with a silently-failing enum value; don't skip it.

---

## Known limitations (by design, not oversights)

- **No browser-level proctoring is unbeatable.** A determined student with a second device can still cheat without triggering anything here. This system is a strong deterrent and audit trail, not an unbeatable lock — that's a hard limit of what any web app can enforce, not a gap specific to this build.
- **Strict mode can't literally trap a browser tab.** Browsers explicitly prevent any website from blocking tab-close or fullscreen-exit — that's a deliberate security boundary, not something circumventable. Strict mode instead makes leaving carry an immediate, real consequence (the 6-second countdown) rather than preventing the action outright.
- **Not load-tested at real exam scale yet** (20–50 concurrent students) — validated with several simultaneous test sessions, but a full-scale dry run before a real midterm is recommended.
- **JWT_SECRET is still a placeholder** in local `.env` — must be replaced with a real random secret (`openssl rand -hex 32`) before any deployment beyond localhost.

---

## Status

Core product complete and manually verified end-to-end: auth, quiz lifecycle, student flow, live monitoring, results, strict/lenient modes, and quiz deletion. Next steps (when picked back up): production deployment (Railway/Render for backend, Vercel for frontend), a full concurrency dry-run, and optional further UI polish.