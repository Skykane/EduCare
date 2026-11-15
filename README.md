# EDUCARE: School Equipment Maintenance and Repair Management System

A web app for monitoring school equipment, organizing repair activities, recommending technician assignments, and scheduling preventive maintenance.

Built with **Node.js + Express**, **EJS** pages, and a JSON file database (no database server to install).

## How to run

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. Sample data is created automatically the first time.

| Role          | Email                | Password |
| ------------- | -------------------- | -------- |
| Administrator | admin@educare.local  | admin123 |
| Technician    | juan@educare.local   | tech123  |
| Requester     | ana@educare.local    | user123  |

Other sample technicians: `maria@`, `pedro@`, `liza@educare.local` (password `tech123`). Other requester: `jose@educare.local` (`user123`).

Other commands:

- `npm run dev` – restarts automatically when you edit a file
- `npm run seed` – **erases all data** and reloads the sample data

Settings (optional environment variables): `PORT`, `SESSION_SECRET`, `DATA_DIR`, `UPLOAD_DIR`.

## Where things are saved

- `data/db.json` – all records (users, equipment, requests, history, notifications)
- `uploads/` – repair photos

Back up these two folders to keep your data.

## Roles

| Feature | Requester | Technician | Administrator |
| --- | :-: | :-: | :-: |
| Submit repair requests, view own requests | ✔ | ✔ | ✔ |
| View equipment | ✔ | ✔ | ✔ |
| Work on assigned tasks (start, hold, complete) | | ✔ | ✔ |
| Update equipment condition, log maintenance | | ✔ | ✔ |
| Preventive schedule, maintenance history | | ✔ | ✔ |
| Set priority, assign technicians | | | ✔ |
| Manage equipment, categories, users, technicians | | | ✔ |
| Reports and CSV export | | | ✔ |

## Features (where to find them)

| # | Feature | Page / file |
| --- | --- | --- |
| 1 | Technician Account Management | Technicians, User Accounts — `src/routes/technicians.js`, `src/routes/users.js` |
| 2 | Equipment Category and Status Management | Categories & Locations, Equipment — `src/routes/categories.js` |
| 3 | Maintenance History | Maintenance History, equipment page — `src/routes/history.js` |
| 4 | Priority Level Management | Request page → Priority — `POST /requests/:id/priority` |
| 5 | Equipment Profile Management | Equipment → Add/Edit — `src/routes/equipment.js` |
| 6 | Repair Request and Activity History | Request page → Activity History — `src/services/activity.js` |
| 7 | Maintenance Reports | Reports (print + CSV) — `src/routes/reports.js` |
| 8 | Repair Request Submission | Report a Problem — `POST /requests` |
| 9 | Role-Based User Access | `src/auth.js` (`requireRole`) |
| 10 | Technician Task Assignment | Request page → Assign Technician (target date, progress) |
| 11 | Search and Advanced Filtering | Filters on Equipment, Requests, History |
| 12 | Repair Documentation | Before/after photos and notes — `src/upload.js` |
| 13 | Notifications and Reminders | Bell icon / Notifications — `src/services/notify.js` |
| 14 | Dashboard and Data Persistence | Dashboard (per role) — `src/routes/dashboard.js`, `src/db.js` |
| 15 | Automated Repair Request Prioritization | `src/services/priority.js` |
| 16 | Smart Technician Assignment | `src/services/assignment.js` |
| 17 | Preventive Maintenance Scheduling | Preventive Schedule — `src/services/preventive.js`, `src/services/scheduler.js` |

## How the automatic features work

**Priority score (feature 15)** — 0 to 100 points:

- Equipment importance (1–5): up to 40 points
- Reported severity (Minor, Moderate, Major, Critical): up to 40 points
- Waiting time: up to 20 points, reached after 14 days

70 or more = **High**, 40–69 = **Medium**, below 40 = **Low**. An administrator can override it with a manual priority.

**Technician recommendation (feature 16)** — 0 to 100 points:

- Specialization matches the equipment category: 50 points (a technician with no specialization gets 15)
- Availability: Available 30, Busy 10, On Leave is not recommended
- Workload: 20 points minus 5 for each active task

**Preventive maintenance (feature 17)** — next due date = last preventive maintenance (or acquisition date) + inspection interval. Equipment is **Due Soon** within 7 days and **Overdue** after the due date. Every hour (and at startup) the system sends reminders to administrators for due/overdue inspections and to technicians and administrators for repair tasks past their target date. Each reminder is only sent once. Completing a preventive task resets the next due date.

## Project structure

```
server.js              App setup and routes
src/
  db.js                JSON file database
  auth.js              Login session and role checks
  upload.js            Photo uploads
  seed.js              Sample data
  constants.js         Statuses, priorities, roles
  helpers.js           Date formatting and view helpers
  routes/              One file per section of the app
  services/            Priority, assignment, schedule, notifications, activity log
views/                 EJS pages
public/                CSS and browser JavaScript
```

## Scope and limitations

As stated in the project scope, this system does not include AI-based damage diagnosis, IoT monitoring, automatic equipment failure prediction, large-scale procurement management, or asset depreciation calculations.
