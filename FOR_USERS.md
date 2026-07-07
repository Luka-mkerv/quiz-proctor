# Quiz Proctor — Feature Documentation

This document explains every feature of the platform, how it works, and what it's designed to do. For setup and running instructions, see [QUICKSTART.md](./QUICKSTART.md).

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Lecturer Features](#lecturer-features)
   - [Authentication](#authentication)
   - [Quiz Management](#quiz-management)
   - [Question Types](#question-types)
   - [Student Enrollment](#student-enrollment)
   - [Database Extensions](#database-extensions)
   - [Monitoring Modes](#monitoring-modes)
   - [Live Monitor](#live-monitor)
   - [Results & Grading](#results--grading)
3. [Student Features](#student-features)
   - [Exam Entry](#exam-entry)
   - [Taking the Exam](#taking-the-exam)
   - [SQL Query Execution](#sql-query-execution)
   - [Submitting](#submitting)
4. [Anti-Cheat System](#anti-cheat-system)
   - [Violation Tracking](#violation-tracking)
   - [Strict vs Lenient Mode](#strict-vs-lenient-mode)
   - [Terminal/API Cheat Detection](#terminalapi-cheat-detection)
5. [Timer System](#timer-system)
6. [Database Sandbox System](#database-sandbox-system)
7. [Known Limitations](#known-limitations)

---

## Platform Overview

Quiz Proctor is a self-hosted exam proctoring platform built for university SQL courses. It replaces Google Forms-style exams with a real-time monitored environment where:

- Lecturers create and manage quizzes with multiple question types
- Students take exams in a controlled, monitored browser environment
- Violations (tab switching, fullscreen exits) are tracked live
- Students can write and execute real SQL queries against a real database
- Lecturers grade answers manually with full violation context

---

## Lecturer Features

### Authentication

Lecturers log in with an email and password. There is no public signup — accounts are created manually by seeding the database (see QUICKSTART.md). This is intentional: only authorized lecturers should have dashboard access.

JWT tokens are issued on login and expire after 8 hours. If you see "Failed to load quizzes," your token has expired — just log out and log back in.

---

### Quiz Management

**Creating a Quiz:**
From the dashboard, click "Create Quiz." You set:
- **Title** — displayed to students on the exam page
- **Duration** — optional time limit in minutes. If set, a countdown timer runs from when the quiz is opened (not from when each student logs in — see [Timer System](#timer-system))
- **Monitoring Mode** — Strict or Lenient (see [Monitoring Modes](#monitoring-modes))
- **Questions** — add as many as you want, each with a type and point value

**Quiz Statuses:**
A quiz moves through three states:
- **Locked** — created but not accessible to students. The shareable link is visible to the lecturer (so it can be shared in advance) but students who visit it see "This quiz is not currently open."
- **Open** — students can log in and take the exam. The timer starts the moment the lecturer clicks Open.
- **Closed** — exam is over. All active students are automatically submitted. The link is hidden.

**Lock vs Close:**
- **Lock** — pauses the exam mid-session. The timer freezes. Students see a "Exam Paused" overlay and cannot interact until the lecturer reopens. Use this for announcements, technical issues, or clarifications.
- **Close** — permanently ends the exam. All in-progress students are auto-submitted with whatever they've answered. Cannot be undone (but individual students can be reopened — see below).

**Deleting a Quiz:**
The delete button (in the danger zone at the bottom of the quiz detail page) permanently removes the quiz and all associated data — questions, enrollments, submissions, answers, violations, grades, and the database template if one was uploaded. A confirmation dialog prevents accidental deletion.

**Reopening a Student's Attempt:**
In the Results view, each submitted student has a "↩ Reopen" button. This resets their submission to in-progress, preserves all their saved answers, and creates a fresh database sandbox if the quiz has a database extension. The student logs back in normally and continues from where they left off. Use this for genuine accidents (accidental tab close, technical issues).

---

### Question Types

Each question in a quiz has a type, set when the quiz is created:

**1. Open Text**
A plain textarea. Students write free-form answers. Graded manually by the lecturer. Used for: "Explain what a JOIN does," "Describe normalization," etc.

**2. Multiple Choice**
The lecturer provides 2 or more answer options (A, B, C, D... no limit) and marks one as correct. Students click their choice — it saves immediately. **Auto-graded** on submission: correct answer = full points, wrong answer = 0 points. Lecturer can override the auto-grade in the results view. Used for: concept questions, definitions, "which statement is true" type questions.

**3. SQL Query**
Only available when a database extension is attached to the quiz (see [Database Extensions](#database-extensions)). Students write real T-SQL or PostgreSQL and click "Run Query" to execute it against their personal database sandbox and see real results. Used for: "Write a query to return all employees older than 40," "Create a stored procedure that..." etc.

A quiz can mix all three types — Q1 can be multiple choice, Q2 open text, Q3 SQL.

---

### Student Enrollment

Students don't have global accounts. Instead, the lecturer manually adds students to each quiz with a specific email and password.

**Adding Students:**
On the quiz detail page, scroll to the Roster section. Paste student emails and passwords in the bulk-add textarea, one per line:

```
student1@university.edu, Password123
student2@university.edu, Password456
student3@university.edu, Password789
```

Optionally add a full name as a third field:
```
student1@university.edu, Password123, John Smith
```

Click "Add to Roster" — students are added immediately. Passwords are hashed and stored securely (bcrypt) — the plaintext password is visible only at the moment of entry, then shown as "••••••••" afterward. Use the "Copy All Credentials" button right after adding to copy the full credential sheet before navigating away.

**Communicating Credentials:**
There is no automated email sending. Share credentials however works for your class — paste into Argus, send via university email, read aloud in class, print a sheet. The platform doesn't care how credentials are communicated.

**Roster Status:**
The roster table shows each student's current status:
- **Not started** — enrolled but hasn't logged in yet
- **In progress** — currently taking the exam
- **Submitted** — finished

---

### Database Extensions

Database extensions allow you to attach a real database to a quiz so students can execute SQL queries against it.

**Supported Engines:**
- **SQL Server** — upload a `.bak` backup file. Students write T-SQL. Uses GO to separate batches.
- **PostgreSQL** — upload a `.sql` dump file (pg_dump output). Students write standard PostgreSQL SQL. Uses semicolons to separate statements.

**How to Add a Database Extension:**
1. On the quiz detail page, scroll to the Database Extension section
2. Select your engine (SQL Server or PostgreSQL)
3. Upload your backup file
4. Wait for "Restoring..." to change to "✅ Ready — N tables"

The backup file is restored once as a permanent template for that quiz. Each student gets their own isolated copy when they log in (see [Database Sandbox System](#database-sandbox-system)).

**Removing an Extension:**
Click the remove button on the extension card. This drops the template database from SQL Server/PostgreSQL and deletes the backup file. Student sandboxes are already dropped at submission time so there's nothing extra to clean up.

**AdventureWorks:**
The recommended database for SQL Server exams is AdventureWorks OLTP, available free from Microsoft's GitHub: `github.com/microsoft/sql-server-samples/releases/tag/adventureworks`. Download `AdventureWorks2022.bak`.

---

### Monitoring Modes

Set per quiz at creation time. Cannot be changed after creation.

**Lenient Mode:**
When a student leaves the exam window (switches tabs, alt-tabs, exits fullscreen), a violation is logged and the lecturer sees it on the live monitor and in results. The student continues their exam uninterrupted. Use this when you want an audit trail but don't want to risk penalizing genuine accidents.

**Strict Mode:**
When a student leaves the exam window, a 6-second countdown appears on their screen: "You've left the exam. Return within 6 seconds or your quiz will be automatically submitted." If they click "Return to Exam Now" in time, the exam continues (the violation is still logged). If the countdown expires, their exam is auto-submitted immediately with whatever they've answered. This cannot be undone without the lecturer using the Reopen button.

The 6-second grace period is intentional — it protects against accidental Escape key presses or brief focus losses while still being meaningfully strict against actual tab-switching cheating attempts.

**Strict Mode + Tab Close:**
If a student closes their browser tab in strict mode, a best-effort auto-submit fires via `navigator.sendBeacon`. If this fails (network drop, browser killed too fast), the system detects the suspicious reconnect: if a student logs back into a strict mode exam where they previously established a socket connection, they are automatically submitted immediately and cannot continue without the lecturer's explicit Reopen.

---

### Live Monitor

Access from the quiz detail page while a quiz is Open. Shows all currently active students in real time.

**Student Chips:**
Each student appears as a small chip/badge. Default state is neutral (gray/white). The moment a student receives their first violation, their chip turns red and stays red for the rest of the session — this is permanent, not a temporary flash. The chip also shows a small flag count number.

**Clicking a Chip:**
Opens a detail panel showing the student's complete violation history with timestamps and event types (Tab switch, Exited fullscreen, Returned to fullscreen, Window blur).

**Disconnect vs Violation:**
When a student disconnects (closes their tab, loses internet, submits), their chip shows a distinct "disconnected" state. This is intentionally separate from violations — a dropped connection isn't necessarily cheating. The violation count does not increment on disconnect.

**Reconnect Indicator:**
If a lecturer uses the Reopen feature, the student's chip shows a pending/amber "reconnecting" state until the student logs back in and their socket reconnects.

---

### Results & Grading

Access from the quiz detail page after students have submitted. Shows all submissions with their answers, scores, violation counts, and monitoring status.

**Student List:**
Each submitted student shows:
- Email
- Submission time
- Current score (X / Y pts) — updates live as you grade
- Flag count
- Monitor status: green "✓ Monitored" if their socket connected during the exam, amber "⚠️ Bypassed exam interface" if they submitted via API without ever opening the browser

**Grading a Student:**
Click "Grade" on any student row. An inline panel expands showing all their questions with:
- The question prompt
- Their answer (plain text for open questions, syntax-highlighted code block for SQL questions, option selection for multiple choice)
- For SQL questions: the execution result from their last Run Query (what they actually saw when they ran it)
- For multiple choice: which option they picked vs which was correct, with green/red indicators
- Points input (pre-filled with auto-grade for multiple choice, blank for open/SQL)
- Optional notes field
- Save Grade button

Use Previous/Next buttons to move between students without going back to the list.

**Auto-grading:**
Multiple choice questions are auto-graded at submission time. The system compares the student's selected option to the marked correct option and assigns full points or zero automatically. You can override any auto-grade by changing the points input and clicking Save.

**Grading Progress:**
A progress indicator at the top shows "Graded: X / Y students" — a student counts as fully graded when all their questions have a saved grade.

---

## Student Features

### Exam Entry

Students access the exam via the link the lecturer shares (format: `https://yourdomain.com/quiz/QUIZ_ID`).

If the quiz is **locked**, students see "This quiz is not currently open. Please check with your instructor." They cannot enter but can wait on this page — when the lecturer opens the quiz, they can log in immediately.

If the quiz is **open**, students see a login form:
- Email (their enrolled university email)
- Password (the custom password the lecturer assigned them)

Wrong credentials show "Invalid email or password" — the error doesn't reveal which field is wrong (security best practice).

After logging in, the exam page requests fullscreen. Students should accept the fullscreen prompt.

---

### Taking the Exam

**Timer:**
If the quiz has a duration, a countdown shows in the top bar. The timer runs from when the **lecturer opened the quiz**, not from when the student logged in. A student who joins 5 minutes late has 5 minutes less. The timer turns amber under 5 minutes and red under 1 minute.

If the lecturer locks the quiz mid-exam, the timer freezes and students see a "Exam Paused" overlay. When the lecturer reopens, the timer resumes from exactly where it stopped — paused time does not count against students.

**Answering Questions:**
- **Open text** — type your answer in the textarea. Autosaves every time you stop typing.
- **Multiple choice** — click your chosen option. Saves immediately. You can change your mind by clicking a different option at any time before submitting.
- **SQL** — write your query in the editor, click Run Query to execute and see results. You can run and refine as many times as you want. The last query you ran is saved as your answer.

**Page Refresh:**
If a student refreshes their browser mid-exam, their session is automatically restored — all previously typed/run answers reappear in the editors, and the timer picks up from the correct remaining time. The monitoring socket reconnects automatically.

---

### SQL Query Execution

When the quiz has a database extension, each SQL question has a real code editor (CodeMirror) with syntax highlighting instead of a plain textarea.
[QUICKSTART.md](./QUICKSTART.md).
**Running a Query:**
Write your SQL and click "Run Query." Results appear below the editor:
- For SELECT queries: a results table with column headers and data rows (capped at 200 rows — if your query returns more, you'll see "Showing 200 of X rows")
- For DDL (CREATE TABLE, CREATE FUNCTION, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER): "✅ Command completed successfully"
- For DML (INSERT, UPDATE, DELETE): "✅ X row(s) affected"
- For errors: the exact SQL Server/PostgreSQL error message with line number

**Multi-batch queries (SQL Server):**
Use `GO` to separate batches when you need to create an object and immediately use it:

```sql
CREATE FUNCTION dbo.GetOrderSize(@qty INT)
RETURNS VARCHAR(20)
AS
BEGIN
    IF @qty < 5 RETURN 'Small Order'
    ELSE IF @qty <= 20 RETURN 'Medium Order'
    ELSE RETURN 'Large Order'
END
GO
SELECT OrderQty, dbo.GetOrderSize(OrderQty)
FROM Sales.SalesOrderDetail
```

Without the `GO`, SQL Server would complain that CREATE FUNCTION isn't the first statement. Each GO-separated block runs as its own batch and shows its own result.

**PostgreSQL queries:**
Use semicolons to separate statements (no GO needed). Complex functions use dollar quoting:

```sql
CREATE FUNCTION get_discount(price NUMERIC, pct NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    RETURN price * (1 - pct/100);
END;
$$ LANGUAGE plpgsql;

SELECT get_discount(100, 10);
```

**Query limits:**
- Maximum execution time: 10 seconds per batch (queries that take longer are cancelled with a clear error message)
- Maximum rows returned: 200 (the query runs against all rows, only the display is capped)
- Dangerous operations blocked: SHUTDOWN, DROP DATABASE, xp_cmdshell, BACKUP DATABASE, RESTORE DATABASE

**Your database is isolated:**
Every student has their own personal copy of the database. Your CREATE TABLE, INSERT, DROP TABLE etc. only affect your copy — other students' work is completely separate. You cannot accidentally break the shared database or affect another student's exam.

---

### Submitting

**Manual submit:**
Click "Submit Quiz" at the bottom of the page. If you have SQL questions with content in the editor that you never clicked Run Query on, a warning dialog lists those questions: "You have unrun queries in Q2 and Q3. Submit anyway?" This gives you a chance to run them before locking in. If you proceed, the unrun SQL text is saved as your answer (no execution result, lecturer sees "Not executed" badge).

**Timer expiry:**
When the countdown reaches 0, the exam automatically submits with whatever you've answered. No action needed — it happens immediately.

**Strict mode auto-submit:**
In strict mode, if you leave the exam window and don't return within 6 seconds, the exam submits automatically.

**After submitting:**
You see a confirmation screen: "Submitted — your answers have been recorded. You may close this window." You cannot re-enter the exam after submitting (unless the lecturer explicitly reopens your attempt).

---

## Anti-Cheat System

### Violation Tracking

The platform tracks three types of window-leaving events:

| Event | What triggers it | Logged as |
|---|---|---|
| Tab switch | Switching to another browser tab | `tab_switch` |
| Window blur | Alt-tabbing to another application | `window_blur` |
| Fullscreen exit | Pressing Escape or F11 to exit fullscreen | `fullscreen_exit` |
| Fullscreen return | Clicking "Return to fullscreen" after an exit | `fullscreen_reenter` |

Every violation is:
1. Sent to the backend via Socket.IO and stored in the database
2. Broadcast live to the lecturer's monitor (the student's chip turns red)
3. Visible in results after the exam with exact timestamps

**Fullscreen re-entry:**
When a student exits fullscreen, a banner appears: "You've exited fullscreen. This has been logged." with a "Click to return" button. Clicking it attempts to re-enter fullscreen and logs a `fullscreen_reenter` event. This means the lecturer can see the full timeline: "exited at 10:23:41, returned at 10:23:48" — useful for distinguishing an accidental Escape tap (quick return) from deliberate cheating (long gap before return or no return).

**Connection tracking:**
The results view shows a "Monitor" column. If a student submitted answers without ever establishing a browser socket connection (i.e., they used curl/terminal to submit directly rather than the actual exam page), their row shows "⚠️ Bypassed exam interface" — a strong signal worth investigating.

---

### Strict vs Lenient Mode

See [Monitoring Modes](#monitoring-modes) above for full details.

**Summary:**
- Lenient: violations logged, exam continues
- Strict: violations trigger 6-second countdown, expiry = auto-submit

---

### Terminal/API Cheat Detection

A technically proficient student could theoretically use `curl` from a terminal to submit answers via the API without opening the browser at all, bypassing all monitoring. The platform detects this:

- Every legitimate browser session establishes a Socket.IO connection when the student enters the exam
- This flips `socket_connected = true` on their submission
- Students who submit via API without a socket connection show "⚠️ Bypassed exam interface" in results
- Additionally: students who close their tab and submit via API (without socket) also get this flag

**What terminal access gives a cheating student:**
The API returns the same quiz questions visible in the browser. A student with terminal access could theoretically pipe questions to an AI. However: this is no different from using a phone or a second monitor to look things up, which no browser-based proctoring can prevent. The terminal doesn't provide any privileged access to answers or other students' work.

---

## Timer System

The timer is quiz-scoped, not student-scoped. This means:

- Timer starts when the **lecturer clicks Open**
- All students work against the **same deadline**
- A student who logs in 10 minutes late has 10 minutes less remaining
- This matches how real paper exams work ("exam ends at 11:30 regardless of when you sat down")

**Pause behavior:**
When the lecturer locks the quiz:
- Timer freezes immediately
- Students see a "Exam Paused" overlay (cannot interact)
- Backend records `paused_at` timestamp

When the lecturer reopens:
- Backend calculates how long the pause lasted and adds it to `total_paused_seconds`
- Timer resumes from exactly where it stopped
- Paused time is never counted against students

**Auto-close:**
When the timer reaches 0, the backend automatically:
1. Marks all active (unsubmitted) submissions as `auto_submitted: true`
2. Drops all active student database sandboxes
3. Flips quiz status to `closed`
4. Broadcasts `quiz:closed` to all connected students via Socket.IO

Students see the auto-submit happen in real time — their screen transitions to the submitted confirmation screen.

---

## Database Sandbox System

Each student gets a completely isolated, fully writable copy of the lecturer's uploaded database for the duration of their exam.

**Lifecycle:**

```
Lecturer uploads .bak/.sql file
        ↓
Backend restores it as a permanent template:
quiz_{id}_template (SQL Server) or 
quiz_{id}_pg_template (PostgreSQL)
        ↓
Student logs in
        ↓
Backend creates their personal copy:
RESTORE DATABASE sandbox_{submissionId} 
FROM quiz_{id}_template  (SQL Server)
or
CREATE DATABASE sandbox_{submissionId}_pg 
TEMPLATE quiz_{id}_pg_template  (PostgreSQL)
        ↓
Student runs queries against their sandbox only
Creates tables, functions, procedures, triggers —
all isolated from other students
        ↓
Student submits (or timer expires)
        ↓
Backend immediately drops their sandbox:
DROP DATABASE sandbox_{submissionId}
Template database untouched, ready for next student
```

**Isolation guarantee:**
Student A's `CREATE TABLE dbo.CustomerStore_Lab` has zero effect on Student B's database. Each student has their own independent copy. One student running `DELETE FROM Sales.SalesOrderDetail WHERE 1=1` only deletes rows in their own copy — the template and all other students' copies are completely unaffected.

**Storage:**
Each student copy is approximately the same size as the template database (~207MB for AdventureWorks). Peak storage during a live exam: template size + (template size × number of active students). For 50 students on AdventureWorks: ~10GB peak, drops back to ~207MB once all students submit.

**SQL Server note:**
The SQL Server sandbox uses `USE [sandbox_name]` set via a dedicated connection (using `sql.Transaction` per batch to pin the connection). This ensures DDL statements like `CREATE VIEW`, `CREATE FUNCTION`, `CREATE TRIGGER`, and `CREATE PROCEDURE` are always the first statement in their batch — a SQL Server requirement. If a query uses the wrong database context, the batch splitter handles it transparently.

---

## Known Limitations

**Browser-level proctoring cannot prevent:**
- Students using a second monitor or second device
- Students using a phone to look up answers
- Students using AI tools in another application
- Students with advanced Linux setups opening a terminal without triggering blur events (depends on window manager behavior) - but can be seen by "never monitored call"
- Students using VMs

**Strict mode cannot prevent:**
- A student closing their tab AND having the sendBeacon fail simultaneously (extremely unlikely but theoretically possible — the suspicious reconnect detection mitigates this)

**SQL execution:**
- PostgreSQL semicolon splitter is naive — complex PL/pgSQL functions with internal semicolons may need dollar quoting (`$$`) instead of standard semicolons inside function bodies
- SQL Server queries returning more than 200 rows display only the first 200 (the full query still executes — only the display is capped)
- Queries have a 10-second timeout — very complex queries or poorly written ones (missing WHERE clause on massive tables) will be cancelled

**Platform scope:**
This platform is designed and tested for one classroom (~50 students) per exam session. It has not been load-tested for simultaneous large-scale use across many classes.

**Authentication:**
Student sessions use short-lived JWTs stored in sessionStorage. Sessions do not persist across browser restarts (intentional — prevents one student from sharing credentials with another who logs in on a different device after the first has submitted).

---

*For setup instructions and For the technical architecture overview, see [README.md](./README.md).*
