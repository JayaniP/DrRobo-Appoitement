# DrRobo Telehealth — aiRender / IAMyHealth integration

A self-contained, demo-ready prototype that combines:

- A patient-facing booking UI (search doctors, AI voice triage, slot picker).
- A teleconsultation backend powered by the **aiRender / IAMyHealth "hi" Schedule Meeting API**.

Bookings are made by calling the aiRender Schedule Meeting endpoint. If the
upstream is unreachable during a demo, the gateway returns a deterministic,
aiRender-shaped mock response so the UI always works.

> Google Meet and the previous `ia-appointment-service` integration have been
> removed. The only telehealth backend is now aiRender.

---

## Folder layout

```
DrRobo-Appoitment/
├── package.json
├── .env
├── README.md
├── server/
│   ├── index.js                 # Express gateway + static frontend
│   ├── appointmentClient.js     # aiRender Schedule Meeting client (+ mock fallback)
│   └── mockData.js              # Built-in demo doctors / slots
└── public/
    ├── index.html               # Loads React via CDN — no build step
    ├── app.js                   # The React UI (booking flow + teleconsultation screen)
    └── styles.css
```

---

## Quick start

```bash
cd DrRobo-Appoitment
npm install
npm start
```

Open <http://localhost:4000>. Pick any doctor, choose a slot, fill in your name
(and optionally an email so aiRender can email the invite), and click
**Confirm & Start Teleconsultation**.

The header pill shows the backend state:

- **● Live · aiRender connected** — bookings hit `https://airender.co:8000/receive-data`.
- **○ Demo mode · aiRender simulator** — backend unreachable, demo continues with a local simulator.

---

## How the booking flow connects to aiRender

| UI action            | Frontend call             | Server route       | Upstream call                                                   |
| -------------------- | ------------------------- | ------------------ | --------------------------------------------------------------- |
| Load doctors         | `GET /api/doctors`        | `listDoctors`      | (local directory)                                               |
| Pick slot → confirm  | `POST /api/bookings`      | `bookAppointment`  | `POST https://airender.co:8000/receive-data` (Schedule Meeting) |
| Confirmation (SMS)   | `POST /api/notify`        | `sendConfirmation` | (local stub — aiRender doesn't expose a notify endpoint)        |
| Start teleconsult    | (reads `urls.InviteeURL`) | n/a                | Opens / iframes the aiRender room URL                           |
| Health pill          | `GET /api/health`         | `checkBackend`     | `GET https://airender.co:8000/`                                 |

### Schedule Meeting payload (sent to aiRender)

```jsonc
{
  "organization": "IAMyHealth",
  "organizationID": "ORG1234567890",
  "planID": "PLANENTP1234567890",
  "roomType": "teleconsultation",
  "requestType": "schedule",
  "isAuth": true,
  "isRegistered": true,
  "host": { "name": "Dr. Ananya Rao", "email": "dr.ananya.rao@airender.co", "password": "Doctor@123" },
  "title": "Doctor Appointment: Dr. Ananya Rao",
  "description": "Cardiac symptoms",
  "date": "2026-05-13",
  "duration": 15,
  "startTime": "2026-05-13T04:30:00.000Z",
  "endTime":   "2026-05-13T04:45:00.000Z",
  "coHostList": [],
  "inviteelist": [{ "name": "Raj Kumar", "email": "raj@example.com", "password": "Patient@123" }],
  "addToCalender": false
}
```

### Expected response shape

```jsonc
{
  "room": 123456789,
  "urls": {
    "hostURL":   "https://airender.co/?data=...host",
    "coHostURL": "https://airender.co/?data=...cohost",
    "InviteeURL":"https://airender.co/?data=...invitee",
    "guestURL":  "https://airender.co/?data=...guest"
  },
  "users": { "host": {...}, "coHost": [...], "Invitee": [...] }
}
```

The UI uses `urls.InviteeURL` for the patient and exposes `hostURL` / `guestURL`
in the **Room** tab of the video screen so the doctor can copy the host link.

---

## Environment variables

See `.env`. The important ones:

| Var                        | Default                    | Purpose                                                  |
| -------------------------- | -------------------------- | -------------------------------------------------------- |
| `PORT`                     | `4000`                     | Port this app listens on.                                |
| `TELEHEALTH_API_BASE_URL`  | `https://airender.co:8000` | aiRender Schedule Meeting backend.                       |
| `TELEHEALTH_SCHEDULE_PATH` | `/receive-data`            | Schedule Meeting path.                                   |
| `PUBLIC_MEETING_BASE_URL`  | `https://airender.co`      | Base for fallback meeting URLs when the backend is down. |
| `TELEHEALTH_ORG_NAME`      | `IAMyHealth`               | `organization` field on every Schedule Meeting call.     |
| `TELEHEALTH_ORG_ID`        | `ORG1234567890`            | `organizationID` field.                                  |
| `TELEHEALTH_PLAN_ID`       | `PLANENTP1234567890`       | `planID` field.                                          |

---

## Demo checklist (for showing the doctor tomorrow)

1. `npm install && npm start` — header pill turns green once aiRender responds.
2. Click 🎤 and say "chest pain" — AI triage picks **Cardiologist** and pre-fills the booking.
3. Fill name + email + phone → **Confirm & Start Teleconsultation**.
4. The aiRender teleconsultation room opens embedded in the video screen.
5. Use the **Room** tab to copy the doctor's `hostURL` and open it in a second browser as the doctor.
6. Test chat, AI notes, and e-Prescribe controls on the bottom bar.

---

## Notes

- React is loaded via CDN with in-browser Babel — **no build step required**.
  `npm install` only installs the Express server's dependencies.
- All UI components live in `public/app.js`. CSS lives in `public/styles.css`.
- Voice input uses the browser `SpeechRecognition` API (Chrome / Edge); typed
  input works everywhere.
- Patient identity is set to `"guest"` in this scaffold — wire your auth layer
  to replace `patientId` in the `POST /api/bookings` payload when productionising.
- If the doctor's browser blocks third-party iframe embeds for `airender.co`,
  the video screen automatically falls back to a "Open aiRender room" button
  that launches the room in a new tab.
