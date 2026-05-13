// ─────────────────────────────────────────────────────────────────────────────
// DrRobo Telehealth — Express gateway + static frontend
//
// Serves the React UI from /public and exposes /api/* routes that proxy
// to the aiRender ("hi" / IAMyHealth) Schedule Meeting backend.
// If the upstream is unreachable, the gateway transparently falls back to
// in-memory mock data so the demo always works.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const apt = require('./appointmentClient');

const PORT = process.env.PORT || 4000;
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const upstream = await apt.checkBackend();
    res.json({
        ok: true,
        service: 'DrRobo Telehealth',
        backend: 'aiRender / IAMyHealth Schedule Meeting',
        telehealthBackend: apt.BASE,
        schedulePath: apt.SCHEDULE_PATH,
        upstream,
        timestamp: new Date().toISOString(),
    });
});

// ── Doctors ────────────────────────────────────────────────────────────────
app.get('/api/doctors', async (req, res, next) => {
    try {
        const { specialty, day } = req.query;
        res.json(await apt.listDoctors({ specialty, day }));
    } catch (e) { next(e); }
});

app.get('/api/doctors/:id', async (req, res, next) => {
    try { res.json(await apt.getDoctor(req.params.id)); }
    catch (e) { next(e); }
});

// ── Timeslots ──────────────────────────────────────────────────────────────
app.get('/api/doctors/:id/slots', async (req, res, next) => {
    try {
        const date = req.query.date || new Date().toISOString().slice(0, 10);
        res.json(await apt.getTimeslots(req.params.id, date));
    } catch (e) { next(e); }
});

// ── Schedule meeting (aiRender) ────────────────────────────────────────────
app.post('/api/bookings', async (req, res, next) => {
    try { res.json(await apt.bookAppointment(req.body || {})); }
    catch (e) { next(e); }
});

// ── Confirmation (SMS / Email — demo stub) ────────────────────────────────
app.post('/api/notify', async (req, res, next) => {
    try { res.json(await apt.sendConfirmation(req.body || {})); }
    catch (e) { next(e); }
});

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error handler ──────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('[drrobo] error:', err);
    res.status(500).json({ ok: false, error: err.message });
});

app.listen(PORT, () => {
    console.log(`\n  DrRobo Telehealth → http://localhost:${PORT}`);
    console.log(`  aiRender backend  → ${apt.BASE}${apt.SCHEDULE_PATH}`);
    console.log(`  If the upstream is down, the UI uses an aiRender-style mock so demos still work.\n`);
});
