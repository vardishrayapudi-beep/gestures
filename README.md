# Medication gesture verification

This prototype has two browser surfaces backed by a small Node server:

- `http://localhost:5500/` — elder-facing camera and gesture verification.
- `http://localhost:5500/dashboard/` — family Today, History, Routines, and Settings views.

The server stores only minimal routine and event data in `data/*.json`. Camera frames stay in the elder browser and are never sent to the API.

## Run

Install Node.js, then double-click `start.bat`, or run:

```text
node server.js
```

Open the elder app in regular Chrome so camera permissions work. The backend exposes:

```text
GET/POST              /api/routines
PUT/DELETE            /api/routines/:id
GET/POST              /api/events
GET                   /api/family
POST                  /api/family/:contactId/preferences
GET                   /api/pending-reminders
POST                  /api/reminders/:id/ack
```

The server scheduler checks active routines once per minute, creates tablet reminders, marks missed routines after the grace period, and logs what it would notify. WhatsApp is intentionally disabled until Meta/Twilio credentials and approved templates are supplied as server environment variables; no token belongs in the browser or repository.
