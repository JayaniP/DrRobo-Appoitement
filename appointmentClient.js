// ─────────────────────────────────────────────────────────────────────────────
// DrRobo Telehealth — aiRender ("hi" / IAMyHealth) integration
//
// Wraps the aiRender Schedule Meeting API documented in the
// "IAMyHealth and aiRender hi - API integration doc".
//
//   Endpoint :  POST  https://airender.co:8000/receive-data
//   Body     :  { requestType: "schedule", roomType: "teleconsultation",
//                 host, coHostList, inviteelist, date, startTime, ... }
//   Response :  { room, urls: { hostURL, coHostURL, InviteeURL, guestURL },
//                 users: { host, coHost, Invitee } }
//
// Every public function returns { ok, source, data } where `source` is
// "live" when the aiRender backend answered and "mock" when we synthesised
// a realistic-looking response so the UI keeps working during the demo.
// ─────────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const { DOCTORS, bookings } = require('./mockData');
const mailer = require('./mailer');

const BASE = (process.env.TELEHEALTH_API_BASE_URL || 'https://airender.co:8000').replace(/\/$/, '');
const SCHEDULE_PATH = process.env.TELEHEALTH_SCHEDULE_PATH || '/receive-data';
const PUBLIC_MEETING_BASE = process.env.PUBLIC_MEETING_BASE_URL || 'https://airender.co';
const ORG_NAME = process.env.TELEHEALTH_ORG_NAME || 'IAMyHealth';
const ORG_ID = process.env.TELEHEALTH_ORG_ID || 'ORG1234567890';
const PLAN_ID = process.env.TELEHEALTH_PLAN_ID || 'PLANENTP1234567890';
// Set TELEHEALTH_FORCE_MOCK=true in .env to bypass the live aiRender call entirely
// (useful while demoing if your aiRender credentials aren't registered yet).
const FORCE_MOCK = /^(1|true|yes)$/i.test(process.env.TELEHEALTH_FORCE_MOCK || '');
// Flip USE_AIRENDER_FOR_JOIN=true in .env once aiRender has registered your
// organisation/doctor accounts and their /?data=... URLs actually open a real
// room. Until then we route every "Join" button through our local demo room
// so the prototype never lands on aiRender's broken page.
const USE_AIRENDER_FOR_JOIN = /^(1|true|yes)$/i.test(process.env.USE_AIRENDER_FOR_JOIN || '');

const http = axios.create({
    baseURL: BASE,
    timeout: 6500,
    headers: { 'Content-Type': 'application/json' },
});

// ─── helpers ────────────────────────────────────────────────────────────────
function ok(data, source = 'live') { return { ok: true, source, data }; }
function fallback(data) { return { ok: true, source: 'mock', data }; }

function slug(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')   // collapse non-alphanumerics (incl. "Dr.") into single dot
        .replace(/^\.+|\.+$/g, '');    // trim leading/trailing dots
}

function parseSlotIso(dateString, slot) {
    if (!dateString || !slot) return null;
    const date = new Date(dateString + 'T00:00:00');
    const [time, period] = slot.trim().split(/\s+/);
    if (!time || !period) return null;
    const [hours, minutes] = time.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    let h = hours % 12;
    if (period.toUpperCase() === 'PM') h += 12;
    date.setHours(h, minutes, 0, 0);
    return date.toISOString();
}

function buildSchedulePayload({ doctor, patientName, patientEmail, patientPhone, date, slot, reason }) {
    const hostEmail = doctor.hostEmail || `${slug(doctor.name)}@airender.co`;
    const inviteeEmail = patientEmail || (patientPhone ? `${patientPhone}@drrobo.demo` : `${slug(patientName || 'guest')}@drrobo.demo`);
    const startTime = parseSlotIso(date, slot) || new Date().toISOString();
    const endTime = new Date(new Date(startTime).getTime() + 15 * 60_000).toISOString();

    return {
        organization: ORG_NAME,
        organizationID: ORG_ID,
        planID: PLAN_ID,
        roomType: 'teleconsultation',
        requestType: 'schedule',
        isAuth: true,
        isRegistered: true,
        host: doctor.hostUID
            ? { uid: doctor.hostUID }
            : { name: doctor.name, email: hostEmail, password: doctor.hostPassword || 'Doctor@123' },
        title: `Doctor Appointment: ${doctor.name}`,
        description: reason || 'Teleconsultation appointment',
        date,
        duration: 15,
        startTime,
        endTime,
        coHostList: doctor.coHostList || [],
        inviteelist: [
            { name: patientName || 'Guest Patient', email: inviteeEmail, password: 'Patient@123' },
        ],
        addToCalender: false,
    };
}

// Build aiRender-style display URLs (what aiRender would return). These are
// used for display/copy in the UI — they look like real aiRender URLs but the
// token is synthetic so they won't actually open a real room.
function buildMockUrls(room) {
    const token = Buffer.from(`drrobo:${room}:${Date.now()}`).toString('base64url');
    const url = (role) => `${PUBLIC_MEETING_BASE}/?data=${token}.${role}`;
    return {
        hostURL: url('host'),
        coHostURL: url('cohost'),
        InviteeURL: url('invitee'),   // exact casing per the aiRender doc
        guestURL: url('guest'),
    };
}

// Build *working* local demo-room URLs that the UI can actually open / iframe.
// These point to /demo-room.html on this same server and look the part for the
// demo while we wait for aiRender to register our credentials.
function buildJoinUrls({ doctor, room, slot, patientName }) {
    const qs = (role) => new URLSearchParams({
        role,
        room: String(room),
        doctor: doctor.name || 'Telehealth Doctor',
        specialty: doctor.specialty || 'Telehealth',
        initials: doctor.initials || '',
        avatarBg: doctor.avatarBg || '',
        avatarColor: doctor.avatarColor || '',
        slot: slot || '',
        patient: patientName || 'Patient',
    }).toString();
    return {
        hostURL: `/demo-room.html?${qs('host')}`,
        coHostURL: `/demo-room.html?${qs('cohost')}`,
        InviteeURL: `/demo-room.html?${qs('invitee')}`,
        guestURL: `/demo-room.html?${qs('guest')}`,
    };
}

// ─── DOCTORS / TIMESLOTS ────────────────────────────────────────────────────
// Doctor data is owned by this prototype (no upstream doctor directory).
// We still expose this through "live" source so the UI is happy.
async function listDoctors({ specialty, day } = {}) {
    const list = DOCTORS.filter((d) => {
        if (specialty && specialty !== 'all') {
            const s = specialty.toLowerCase();
            if (!d.specialty.toLowerCase().includes(s) && !s.includes(d.specialty.toLowerCase().split(' ')[0])) return false;
        }
        const ahead = d.daysAhead ?? 0;
        if (day === 'today' && ahead !== 0) return false;
        if (day === 'tomorrow' && ahead !== 1) return false;
        // 'this week' or omitted → return everything within the next 6 days.
        return true;
    });
    return ok(list);
}

async function getDoctor(id) {
    const doc = DOCTORS.find((d) => d.id === id);
    return doc ? ok(doc) : { ok: false, error: 'Doctor not found' };
}

async function getTimeslots(physicianId /*, dateISO */) {
    const doc = DOCTORS.find((d) => d.id === physicianId);
    return ok(doc ? doc.slots.map((s, i) => ({ slotId: `${physicianId}-slot-${i}`, time: s })) : []);
}

// ─── BOOK APPOINTMENT (aiRender Schedule Meeting) ──────────────────────────
async function bookAppointment({ physicianId, date, slot, reason, patientName, patientPhone, patientEmail, fee }) {
    const doctor = DOCTORS.find((d) => d.id === physicianId) || { id: physicianId, name: 'Telehealth Doctor' };
    const payload = buildSchedulePayload({ doctor, patientName, patientEmail, patientPhone, date, slot, reason });

    // Demo escape hatch — set TELEHEALTH_FORCE_MOCK=true to skip the live call.
    if (FORCE_MOCK) {
        console.log('\n[aiRender] FORCE_MOCK enabled — skipping live call. Payload that WOULD have been sent:');
        console.log(JSON.stringify(payload, null, 2));
        return await buildMockBooking({ doctor, physicianId, date, slot, reason, patientName, patientPhone, patientEmail, fee,
            note: 'TELEHEALTH_FORCE_MOCK is enabled — using the aiRender simulator so the demo is deterministic.' });
    }

    try {
        console.log(`\n[aiRender] → POST ${BASE}${SCHEDULE_PATH}`);
        console.log('[aiRender] request body:');
        console.log(JSON.stringify(payload, null, 2));
        const res = await http.post(SCHEDULE_PATH, payload);
        const raw = res.data || {};
        console.log(`[aiRender] ← ${res.status} response:`);
        console.log(JSON.stringify(raw, null, 2));

        // aiRender's actual response shape wraps the documented payload under
        // `serverResponseData`. Older / mocked deployments put it at the root.
        // Read from either location so we work in both worlds.
        const data = raw.serverResponseData || raw;

        const room = data.room || `MC-${Date.now().toString().slice(-6)}`;

        // aiRender currently returns URLs prefixed with the literal string
        // "undefined?data=..." instead of "https://airender.co/?data=..." —
        // this is a known bug on their side. Repair the prefix so the rooms
        // actually open.
        const repair = (u) => {
            if (!u) return '';
            if (u.startsWith('undefined')) {
                const base = PUBLIC_MEETING_BASE.replace(/\/$/, '');
                const rest = u.slice('undefined'.length).replace(/^\//, '');
                return `${base}/${rest}`;
            }
            return u;
        };
        const urls = {
            // Accept both the documented casing ("InviteeURL") and the safer
            // camelCase variant ("inviteeURL") just in case.
            hostURL: repair(data.urls?.hostURL || ''),
            coHostURL: repair(data.urls?.coHostURL || ''),
            InviteeURL: repair(data.urls?.InviteeURL || data.urls?.inviteeURL || ''),
            guestURL: repair(data.urls?.guestURL || ''),
        };

        // aiRender sometimes accepts the request but returns no meeting URLs —
        // typically because the host / organization isn't registered with them
        // ("Register doctor/user is required" in their integration doc).
        // Back-fill simulator URLs so the demo continues, and surface a note.
        const hasUsableUrls = !!(urls.InviteeURL || urls.hostURL);
        let note = '';
        let source = 'live';
        // joinUrls are the URLs the UI will actually open/iframe.
        //   - When USE_AIRENDER_FOR_JOIN=true and aiRender returned usable URLs,
        //     use them directly (assumes their backend is healthy).
        //   - Otherwise route Join through our local demo-room.html so the
        //     prototype always lands on a working page.
        let joinUrls = (USE_AIRENDER_FOR_JOIN && hasUsableUrls)
            ? { ...urls }
            : buildJoinUrls({ doctor, room, slot, patientName });
        if (!hasUsableUrls) {
            const sim = buildMockUrls(String(room));
            urls.hostURL = sim.hostURL;
            urls.coHostURL = sim.coHostURL;
            urls.InviteeURL = sim.InviteeURL;
            urls.guestURL = sim.guestURL;
            note = 'aiRender accepted the request but returned no meeting URLs — usually because the host / organizationID / planID is not yet registered on aiRender. The demo is using a local simulator room you can actually open.';
            source = 'mock';
        } else if (!USE_AIRENDER_FOR_JOIN) {
            note = 'aiRender returned real URLs but their hosted page currently throws Firebase / SSL errors for unregistered orgs. Until they confirm registration, "Join" opens the local working demo room. Set USE_AIRENDER_FOR_JOIN=true in .env once aiRender confirms the room loads cleanly.';
        }

        const booking = {
            appointmentId: String(room),
            room,
            physicianId,
            date,
            slot,
            reason,
            patientName,
            patientPhone,
            status: 'CREATED',
            urls,
            joinUrls,
            users: data.users || {
                host: { name: doctor.name, email: doctor.hostEmail || mailer.DEFAULT_DOCTOR_EMAIL },
                coHost: [],
                Invitee: { name: patientName || 'Guest Patient', email: patientEmail || mailer.DEFAULT_PATIENT_EMAIL },
            },
            backend: source === 'live' ? 'aiRender' : 'aiRender (simulated)',
            note,
            doctor: { name: doctor.name, email: doctor.hostEmail || mailer.DEFAULT_DOCTOR_EMAIL },
            patient: { name: patientName || 'Patient', phone: patientPhone || '', email: patientEmail || mailer.DEFAULT_PATIENT_EMAIL },
            fee: fee || doctor.fee,
        };
        booking.emailStatus = await mailer.sendBookingEmails(booking);
        bookings.set(booking.appointmentId, booking);
        return source === 'live' ? ok(booking) : fallback(booking);
    } catch (err) {
        // Fallback so the demo never breaks if airender.co isn't reachable.
        console.log(`[aiRender] ✗ request failed: ${err.code || err.message}${err.response?.status ? ` (HTTP ${err.response.status})` : ''}`);
        if (err.response?.data) {
            console.log('[aiRender] error body:', JSON.stringify(err.response.data, null, 2));
        }
        return await buildMockBooking({ doctor, physicianId, date, slot, reason, patientName, patientPhone, patientEmail, fee,
            note: `aiRender backend unreachable (${err.code || err.message}); using simulator so the demo continues.` });
    }
}

async function buildMockBooking({ doctor, physicianId, date, slot, reason, patientName, patientPhone, patientEmail, fee, note }) {
    const room = `MC-${Date.now().toString().slice(-6)}`;
    const urls = buildMockUrls(room);
    const joinUrls = buildJoinUrls({ doctor, room, slot, patientName });
    const booking = {
        appointmentId: room,
        room,
        physicianId,
        date,
        slot,
        reason,
        patientName,
        patientPhone,
        status: 'CREATED',
        urls,
        joinUrls,
        users: {
            host: { name: doctor.name, email: doctor.hostEmail || mailer.DEFAULT_DOCTOR_EMAIL },
            coHost: [],
            Invitee: { name: patientName || 'Guest Patient', email: patientEmail || mailer.DEFAULT_PATIENT_EMAIL },
        },
        backend: 'aiRender (simulated)',
        note,
        doctor: { name: doctor.name, email: doctor.hostEmail || mailer.DEFAULT_DOCTOR_EMAIL },
        patient: { name: patientName || 'Patient', phone: patientPhone || '', email: patientEmail || mailer.DEFAULT_PATIENT_EMAIL },
        fee: fee || doctor.fee,
    };
    booking.emailStatus = await mailer.sendBookingEmails(booking);
    bookings.set(booking.appointmentId, booking);
    return fallback(booking);
}

// ─── CONFIRMATION (SMS / Email) ────────────────────────────────────────────
// Not part of the aiRender API surface; we keep it as a no-op so the booking
// page can still show "Confirmation sent" feedback for the demo.
async function sendConfirmation({ appointmentId /*, patientPhone, details */ }) {
    return ok({ sent: true, channels: ['SMS', 'Email'], appointmentId });
}

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
async function checkBackend() {
    try {
        // The aiRender doc doesn't expose a /health endpoint, so we do a
        // lightweight HEAD on the base URL. Any 2xx-4xx is treated as reachable.
        const res = await http.request({ url: '/', method: 'GET', timeout: 1800, validateStatus: () => true });
        return { reachable: res.status < 500, status: res.status };
    } catch (err) {
        return { reachable: false, error: err.code || err.message };
    }
}

module.exports = {
    listDoctors,
    getDoctor,
    getTimeslots,
    bookAppointment,
    sendConfirmation,
    checkBackend,
    BASE,
    SCHEDULE_PATH,
};
