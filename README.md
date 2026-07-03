# Quiz Proctor — Quick Start Guide

## Prerequisites (install once, already done)
- Docker + Docker Compose
- Node.js + pnpm

---

## Every time you want to run the project

### 1. Start the backend services (Postgres + SQL Server + Node)
```bash
cd ~/Projects/quiz/quiz-proctor
docker compose up -d
```

Check everything is running:
```bash
docker compose ps
```
You should see 3 containers all showing `Up`:
- `quiz-proctor-backend` (port 4000)
- `quiz-proctor-db` (Postgres, port 5433)
- `quiz-proctor-sqlserver` (SQL Server, port 1433)

Verify backend is alive:
```bash
curl http://localhost:4000/health
# Should return: {"status":"ok"}
```

### 2. Start the frontend
```bash
cd ~/Projects/quiz/quiz-proctor/frontend
pnpm dev
```
Open `http://localhost:3000` in your browser.

---

## Lecturer login
```
Email:    you@uni.edu
Password: yourpass
```

If you need to create or reset a lecturer account:
```bash
cd ~/Projects/quiz/quiz-proctor
docker compose exec backend node src/db/seedLecturer.js "you@uni.edu" "yourpass" "Your Name"
```

---

## If you added new migration files
Run this before testing any new features — always:
```bash
docker compose exec backend npm run migrate
```
This is safe to run multiple times (skips already-applied migrations).

---

## Stopping everything
```bash
# Stop containers but keep data:
docker compose down

# Stop AND wipe all data (fresh start):
docker compose down -v
# Note: after this you'll need to re-run migrations and re-seed the lecturer
```

---

## Checking logs if something breaks
```bash
# Backend logs (live):
docker compose logs -f backend

# All containers:
docker compose logs -f

# Last 50 lines of backend only:
docker compose logs --tail 50 backend
```

---

## If the backend seems broken after a code change
```bash
docker compose restart backend
# Wait for "Backend listening on port 4000" in logs
docker compose logs -f backend
```

---

## SQL Server — useful commands
```bash
# Check what databases exist (including student sandboxes):
docker compose exec sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'YOUR_SA_PASSWORD' -C \
  -Q "SELECT name FROM sys.databases ORDER BY name;"

# YOUR_SA_PASSWORD is in backend/.env as MSSQL_SA_PASSWORD
```

---

## Project structure reminder
```
quiz-proctor/
├── docker-compose.yml     ← all services defined here
├── backend/               ← Node/Express/Socket.IO (runs in Docker)
│   ├── src/
│   │   ├── routes/        ← auth.js, quizzes.js, public.js
│   │   ├── socket/        ← real-time violation tracking
│   │   └── db/
│   │       ├── migrations/ ← SQL migration files (001-011)
│   │       ├── pool.js     ← Postgres connection
│   │       ├── mssqlPool.js ← SQL Server connection
│   │       └── seedLecturer.js
└── frontend/              ← React/Vite/Tailwind (runs locally)
    └── src/
        ├── pages/         ← Login, Dashboard, QuizDetail, 
        │                     QuizMonitor, QuizResults,
        │                     QuizPage (student exam)
        └── lib/api.js     ← axios client, auto-attaches JWT
```

---

## Common issues

**"service backend is not running"**
→ You ran `docker compose` from the wrong folder. Always run from `~/Projects/quiz/quiz-proctor` (the project root, not inside `backend/`).

**"Failed to load quizzes" in dashboard**
→ Your JWT expired (8h lifespan). Just log out and log back in.

**Frontend not updating after code change**
→ Vite hot-reloads automatically. If it still looks wrong, hard-refresh the browser (Ctrl+Shift+R).

**Port 5432 already in use**
→ Another Postgres is running on your machine. Our container maps to port 5433 instead — this is already configured, no action needed.

**SQL Server volume ownership error**
→ If you ever wipe volumes and recreate them, run:
```bash
docker compose exec -u root sqlserver chown mssql:mssql /var/opt/mssql/backup
```

**pnpm: No package.json found**
→ You're in the wrong directory. Frontend commands must be run from `~/Projects/quiz/quiz-proctor/frontend`, not the project root.