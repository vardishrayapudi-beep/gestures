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
POST                  /api/family/setup
```

The server scheduler checks active routines once per minute, creates tablet reminders, marks missed routines after the grace period, and logs what it would notify. WhatsApp is intentionally disabled until Meta/Twilio credentials and approved templates are supplied as server environment variables; no token belongs in the browser or repository.

## First-contact setup

Open `/dashboard/`. If no WhatsApp number has been configured, the dashboard opens the one-time Setup view automatically. Enter the elder name, trusted contact name, and the WhatsApp number in international E.164 format, such as `+919876543210`. The form saves through `POST /api/family/setup` and keeps the number server-side.

## WhatsApp activation

WhatsApp delivery needs an approved provider account and credentials owned by the family or deployment operator. Do not put secrets in `app.js`, the dashboard, or GitHub. Configure the server environment before starting Node:

```text
WHATSAPP_ACCESS_TOKEN=your-server-only-token
WHATSAPP_PHONE_NUMBER_ID=your-approved-sender-id
WHATSAPP_API_VERSION=v21.0
```

The server adapter is intentionally quiet when these values are absent. In Meta WhatsApp Manager, create and approve templates for missed medication, uncertain verification, and the daily summary; then map the approved template names in the server adapter before enabling real delivery. Test with the family’s own number first and confirm opt-in and local messaging rules.

## Field-test kiosk guide

1. Start the server on the same computer as the camera: `node server.js` or `start.bat`.
2. Open the elder page at `http://localhost:5500/` in regular Chrome. Complete camera permission and the first-contact setup from the dashboard.
3. For Android Chrome, use **Add to Home screen**, plug the phone in, set the screen to stay awake, and use Android **Screen pinning** so the elder cannot leave the check accidentally.
4. For iPad Safari, use **Add to Home Screen**, plug the iPad in, set Auto-Lock to Never during the trial, and enable **Guided Access** with the side-button triple-click.
5. Keep the camera at eye level with the elder’s hand fully visible. The elder can press **Start over** during a live check. If the camera disconnects, the app shows **Try again** and does not mark the gesture as verified.
6. A walk routine uses the phone’s motion sensor. Tap **Start walk**, carry the phone while walking, and tap **I’m done** when finished. The dashboard shows a verified walk duration only when enough motion samples were detected; otherwise it is marked uncertain.

The browser never uploads camera frames. Only the final gesture or walking event is sent to the local server.
