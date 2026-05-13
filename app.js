// DrRobo Telehealth — React UI (in-browser Babel transpile).
// Talks to /api/* on this Express server, which proxies the aiRender
// ("hi" / IAMyHealth) Schedule Meeting API.

const { useState, useEffect, useMemo, useRef } = React;

// ─────────────────────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────────────────────
const api = {
    async health() { return (await fetch('/api/health')).json(); },
    async doctors(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return (await fetch('/api/doctors?' + qs)).json();
    },
    async slots(id, date) {
        const qs = date ? '?date=' + date : '';
        return (await fetch('/api/doctors/' + id + '/slots' + qs)).json();
    },
    async book(payload) {
        return (await fetch('/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })).json();
    },
    async notify(payload) {
        return (await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })).json();
    },
};

// ─────────────────────────────────────────────────────────────
// Local symptom classifier (fast, no API key needed)
// ─────────────────────────────────────────────────────────────
function classifySymptoms(text) {
    const s = (text || '').toLowerCase();
    // Order matters — most specific patterns first; General Physician is the fallback.
    if (/\b(child|baby|infant|pediatric|toddler|newborn|vaccin)/.test(s)) return { specialty: 'Pediatrician', reason: "Child's health" };
    if (/\b(pregnan|period|menstrual|ovary|pcod|pcos|maternity|gynec)/.test(s)) return { specialty: 'Gynecologist', reason: "Women's health" };
    if (/\b(ear|throat|nose|sinus|tonsil|hearing|sore throat)/.test(s)) return { specialty: 'ENT Specialist', reason: 'ENT concern' };
    if (/\b(eye|vision|sight|lasik|cataract|retina|glasses)/.test(s)) return { specialty: 'Ophthalmologist', reason: 'Eye care' };
    if (/\b(diabet|thyroid|hormone|insulin|sugar level|obesity)/.test(s)) return { specialty: 'Endocrinologist', reason: 'Hormonal / metabolic' };
    if (/\b(stomach|gastric|ulcer|acidit|indigest|liver|bloat)/.test(s)) return { specialty: 'Gastroenterologist', reason: 'Digestive concern' };
    if (/\b(asthma|lung|breath|wheez|tuberculosis|respiratory)/.test(s)) return { specialty: 'Pulmonologist', reason: 'Respiratory concern' };
    if (/\b(kidney|urin|prostate|bladder|kidney stone)/.test(s)) return { specialty: 'Urologist', reason: 'Urinary / kidney concern' };
    if (/\b(tooth|teeth|dental|gum|cavity|brace|root canal)/.test(s)) return { specialty: 'Dentist', reason: 'Dental concern' };
    if (/\b(heart|chest|cardio|palpitation|blood pressure|bp)/.test(s)) return { specialty: 'Cardiologist', reason: 'Cardiac symptoms' };
    if (/\b(anxiet|stress|depress|mental|sleep|mood|panic)/.test(s)) return { specialty: 'Psychiatrist', reason: 'Mental wellness' };
    if (/\b(headache|migraine|dizziness|nerve|brain|epilepsy|seizure)/.test(s)) return { specialty: 'Neurologist', reason: 'Neurological concern' };
    if (/\b(skin|acne|rash|itch|eczema|hair fall|pimple|allergy)/.test(s)) return { specialty: 'Dermatologist', reason: 'Skin / hair issue' };
    if (/\b(knee|joint|bone|fracture|spine|ankle|shoulder|back pain)/.test(s)) return { specialty: 'Orthopaedic', reason: 'Bone / joint issue' };
    return { specialty: 'General Physician', reason: 'General consultation' };
}

function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
}

function parseSlotTime(slot, referenceDate = new Date()) {
    const parts = slot.trim().split(' ');
    if (parts.length !== 2) return null;
    const [time, period] = parts;
    const [hours, minutes] = time.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    const result = new Date(referenceDate);
    let h = hours % 12;
    if (period.toUpperCase() === 'PM') h += 12;
    result.setHours(h, minutes, 0, 0);
    return result;
}

function isNearSearch(text) {
    return /(nearby|near me|near|close by|closest)/i.test(text);
}

function getDoctorDaysAhead(doc) {
    return typeof doc.daysAhead === 'number' ? doc.daysAhead : 0;
}

function getAppointmentDateString(doc /*, selectedDay */) {
    const offset = getDoctorDaysAhead(doc);
    return addDays(new Date(), offset).toISOString().slice(0, 10);
}

function getVisibleSlots(doc /*, selectedDay */) {
    const now = new Date();
    const offset = getDoctorDaysAhead(doc);
    const referenceDate = addDays(now, offset);
    // For today's slots: must be at least 15 minutes in the future.
    // For future days: all listed slots are valid.
    const earliest = new Date(now.getTime() + 15 * 60 * 1000);
    return (doc.slots || []).filter(slot => {
        const slotDate = parseSlotTime(slot, referenceDate);
        if (!slotDate) return false;
        return offset === 0 ? slotDate > earliest : true;
    });
}

function availabilityLabel(doc) {
    const offset = getDoctorDaysAhead(doc);
    if (offset === 0) return 'Available today';
    if (offset === 1) return 'Tomorrow';
    const target = addDays(new Date(), offset);
    return target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Haversine distance in km between two lat/lng points.
function haversineKm(lat1, lng1, lat2, lng2) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function Header({ upstream }) {
    const pillClass = upstream === 'live' ? 'upstream-pill live' : upstream === 'mock' ? 'upstream-pill mock' : 'upstream-pill';
    const label = upstream === 'live'
        ? '● Live · aiRender connected'
        : upstream === 'mock' ? '○ Demo mode · aiRender simulator'
            : '○ Checking aiRender…';
    return (
        <header className="header">
            <div className="brand">
                <div className="brand-mark">★</div>
                <span className="brand-name">DrRobo Telehealth</span>
                <span className="brand-sub">powered by aiRender · IAMyHealth</span>
            </div>
            <span className={pillClass}>{label}</span>
        </header>
    );
}

// ─────────────────────────────────────────────────────────────
// Hero / search
// ─────────────────────────────────────────────────────────────
function Hero({ query, setQuery, specialty, setSpecialty, day, setDay }) {
    return (
        <section className="hero">
            <div className="hero-inner">
                <h1>Find a doctor and start a secure video call — in seconds.</h1>
                <p>Speak or type your symptoms. Our AI finds the right specialist, books the slot via aiRender, and opens a secure teleconsultation room.</p>
                <div className="search-bar">
                    <input placeholder="Search by name, symptom, hospital, or near me…" value={query} onChange={e => setQuery(e.target.value)} />
                    <select value={specialty} onChange={e => setSpecialty(e.target.value)}>
                        <option value="all">All specialties</option>
                        <option>Cardiologist</option>
                        <option>Dentist</option>
                        <option>Dermatologist</option>
                        <option>Endocrinologist</option>
                        <option>ENT Specialist</option>
                        <option>Gastroenterologist</option>
                        <option>General Physician</option>
                        <option>Gynecologist</option>
                        <option>Neurologist</option>
                        <option>Ophthalmologist</option>
                        <option>Orthopaedic</option>
                        <option>Pediatrician</option>
                        <option>Psychiatrist</option>
                        <option>Pulmonologist</option>
                        <option>Urologist</option>
                    </select>
                    <select value={day} onChange={e => setDay(e.target.value)}>
                        <option value="this week">This week</option>
                        <option value="today">Today</option>
                        <option value="tomorrow">Tomorrow</option>
                    </select>
                    <button onClick={() => { }}>Search</button>
                </div>
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────────────────────
// Voice / symptom panel
// ─────────────────────────────────────────────────────────────
function VoicePanel({ onSuggest }) {
    const [text, setText] = useState('');
    const [listening, setListening] = useState(false);
    const [stage, setStage] = useState('Tap mic or type symptoms');
    const recogRef = useRef(null);

    useEffect(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        const r = new SR();
        r.continuous = false; r.interimResults = false; r.lang = 'en-IN';
        r.onresult = (e) => {
            const transcript = Array.from(e.results).map(x => x[0].transcript).join(' ').trim();
            setText(transcript);
            setListening(false);
            submit(transcript);
        };
        r.onerror = () => setListening(false);
        r.onend = () => setListening(false);
        recogRef.current = r;
    }, []);

    const startListening = () => {
        if (!recogRef.current) { setStage('Voice not supported — type instead.'); return; }
        setListening(true);
        setStage('🎙️ Listening… describe your symptoms');
        try { recogRef.current.start(); } catch { }
    };

    const submit = (raw) => {
        const t = (raw || text).trim();
        if (!t) return;
        setStage('🧠 Understanding your symptoms…');
        const cls = classifySymptoms(t);
        setStage(`Found you a ${cls.specialty}.`);
        onSuggest({ specialty: cls.specialty, reason: cls.reason, transcript: t });
    };

    return (
        <div className="card">
            <div className="voice-panel">
                <button className={'voice-btn ' + (listening ? 'listening' : '')} onClick={startListening} title="Talk to AI">🎤</button>
                <div className="voice-status">
                    <div className="stage">AI symptom triage</div>
                    <div className="text">{stage}</div>
                </div>
            </div>
            <div className="voice-input">
                <input placeholder="…or type your symptoms here" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
                <button onClick={() => submit()}>Find doctor</button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Doctor list
// ─────────────────────────────────────────────────────────────
function DoctorRow({ doc, onSlot, day, userLocation }) {
    const visibleSlots = getVisibleSlots(doc, day);
    const distLabel = doc.distanceKm != null
        ? `${doc.distanceKm.toFixed(1)} km${userLocation ? ' from you' : ''}`
        : null;
    return (
        <div className="doctor">
            <div className="avatar" style={{ background: doc.avatarBg, color: doc.avatarColor }}>{doc.initials}</div>
            <div className="doctor-info">
                <div className="name">{doc.name}</div>
                <div className="meta">{doc.specialty} · {doc.experience} yrs</div>
                <div className="meta small">{doc.hospital}{doc.location ? ` · ${doc.location}` : ''}{distLabel ? ` · 📍 ${distLabel}` : ''}</div>
                <span className="rating-pill">★ {doc.rating} ({doc.reviews})</span>
                <div className="slot-row">
                    {visibleSlots.length > 0 ? visibleSlots.map(s => (
                        <button key={s} className="slot" onClick={() => onSlot(doc, s)}>{s}</button>
                    )) : (
                        <div className="no-slots">No upcoming slots today — try Tomorrow.</div>
                    )}
                </div>
            </div>
            <div className="fee-col">
                <div className="fee">₹{doc.fee}</div>
                <div className="available">{availabilityLabel(doc)}</div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Booking modal
// ─────────────────────────────────────────────────────────────
function BookingModal({ booking, onCancel, onConfirmed }) {
    const { doctor, slot, reason } = booking;
    const [name, setName] = useState('Jayani Patel');
    const [phone, setPhone] = useState('9726160822');
    const [email, setEmail] = useState('jayanipatel23@gmail.com');
    const [busy, setBusy] = useState(false);

    const confirm = async () => {
        setBusy(true);
        try {
            const date = booking.date || new Date().toISOString().slice(0, 10);
            const res = await api.book({
                patientId: 'guest',
                physicianId: doctor.id,
                date,
                slot,
                reason: reason || 'Online consultation',
                patientName: name || 'Jayani Patel',
                patientPhone: phone || '0000000000',
                patientEmail: email || '',
                fee: doctor.fee,
            });
            const data = res?.data || {};
            const appointmentId = data.appointmentId || data.room;
            if (!appointmentId) throw new Error('Booking failed — no appointment id returned');

            onConfirmed({
                appointmentId,
                room: data.room,
                urls: data.urls || {},
                joinUrls: data.joinUrls || data.urls || {},
                users: data.users || {},
                doctor,
                slot,
                date,
                reason,
                patient: data.patient || { name: name || 'Patient', phone: phone || '—', email: email || data.patient?.email || '—' },
                source: res?.source || 'mock',
                note: data.note || '',
                emailStatus: data.emailStatus || null,
            });
        } catch (err) {
            alert('Booking failed: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-backdrop" onClick={onCancel}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h2>Review your booking</h2>
                <p className="small">Confirm to schedule the meeting through aiRender and open your teleconsultation room.</p>

                <div className="detail-box">
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div className="avatar" style={{ background: doctor.avatarBg, color: doctor.avatarColor }}>{doctor.initials}</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700 }}>{doctor.name}</div>
                            <div style={{ fontSize: 12, color: '#5f6368' }}>{doctor.specialty} · {doctor.experience} yrs</div>
                            <span className="rating-pill" style={{ marginTop: 4 }}>★ {doctor.rating} ({doctor.reviews})</span>
                        </div>
                    </div>

                    <div className="grid">
                        <div><div className="label">📅 Date</div><div className="value">{booking.date}</div></div>
                        <div><div className="label">🕐 Time</div><div className="value" style={{ color: '#00a98f' }}>{slot}</div></div>
                        <div><div className="label">📍 Clinic</div><div className="value">{doctor.hospital}</div></div>
                        <div><div className="label">💳 Fee</div><div className="value">₹{doctor.fee}</div></div>
                    </div>

                    <div className="field-row">
                        <label>Your name</label>
                        <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Raj Kumar" />
                    </div>
                    <div className="field-row">
                        <label>Phone (for confirmation)</label>
                        <input className="text-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="9876543210" />
                    </div>
                    <div className="field-row">
                        <label>Email (optional — used for aiRender invite)</label>
                        <input className="text-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="patient@example.com" />
                    </div>
                    {reason && (
                        <div className="field-row">
                            <label>Reason for visit</label>
                            <div style={{ fontSize: 13, fontStyle: 'italic', color: '#202124' }}>"{reason}"</div>
                        </div>
                    )}
                </div>

                <div className="note">
                    <span>ℹ️</span>
                    <span>Tapping <b>Confirm</b> calls the aiRender Schedule Meeting API and instantly opens your teleconsultation room.</span>
                </div>

                <div className="actions">
                    <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
                    <button className="btn-primary" onClick={confirm} disabled={busy}>
                        {busy ? 'Scheduling…' : '📹 Confirm & Start Teleconsultation'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Booking-confirmed screen
// Shows after the booking is created. Both patient and doctor have been
// emailed their join links — they enter the call when the slot time arrives.
// ─────────────────────────────────────────────────────────────
function BookingConfirmation({ appointment, onJoin, onDone }) {
    const { doctor, slot, date, room, appointmentId, patient, emailStatus, joinUrls = {}, urls = {} } = appointment;
    const patientEmail = emailStatus?.patient?.email || patient?.email || '—';
    const doctorEmail = emailStatus?.doctor?.email || '—';
    const mode = emailStatus?.mode || 'simulated';
    const inviteeURL = joinUrls.InviteeURL || joinUrls.inviteeURL || urls.InviteeURL || '';

    const copy = (val) => { try { navigator.clipboard.writeText(val); } catch { } };

    return (
        <div className="confirm-screen">
            <div className="confirm-card">
                <div className="confirm-check">✓</div>
                <h1>Teleconsultation Booked</h1>
                <p className="sub">
                    We've emailed the join link to both you and {doctor.name}. You can join at your slot time —
                    no need to stay on this page.
                </p>

                <div className="confirm-grid">
                    <div><div className="label">👨‍⚕️ Doctor</div><div className="value">{doctor.name}</div></div>
                    <div><div className="label">🩺 Specialty</div><div className="value">{doctor.specialty}</div></div>
                    <div><div className="label">📅 Date</div><div className="value">{date}</div></div>
                    <div><div className="label">🕐 Slot</div><div className="value highlight">{slot}</div></div>
                    <div><div className="label">🔗 Room ID</div><div className="value mono">{room || appointmentId}</div></div>
                    <div><div className="label">💳 Fee</div><div className="value">₹{doctor.fee}</div></div>
                </div>

                <div className="email-status">
                    <div className="email-row">
                        <span className={'email-dot ' + (emailStatus?.patient?.sent ? 'ok' : 'fail')}>
                            {emailStatus?.patient?.sent ? '✓' : '✗'}
                        </span>
                        <div>
                            <div className="email-line"><b>Patient invite</b> sent to {patientEmail}</div>
                            <div className="email-sub">{mode === 'live' ? 'Delivered via Gmail SMTP' : 'Demo mode — email body printed in server console'}</div>
                        </div>
                    </div>
                    <div className="email-row">
                        <span className={'email-dot ' + (emailStatus?.doctor?.sent ? 'ok' : 'fail')}>
                            {emailStatus?.doctor?.sent ? '✓' : '✗'}
                        </span>
                        <div>
                            <div className="email-line"><b>Doctor invite</b> sent to {doctorEmail}</div>
                            <div className="email-sub">{mode === 'live' ? 'Delivered via Gmail SMTP' : 'Demo mode — email body printed in server console'}</div>
                        </div>
                    </div>
                </div>

                {inviteeURL && (
                    <div className="join-link-box">
                        <div className="label">Your join link</div>
                        <div className="link-flex">
                            <code>{inviteeURL}</code>
                            <button className="copy-btn" onClick={() => copy(inviteeURL)}>copy</button>
                        </div>
                    </div>
                )}

                <div className="confirm-actions">
                    <button className="btn-secondary" onClick={onDone}>Done — I'll join from email</button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Teleconsultation screen (aiRender / hi)
// ─────────────────────────────────────────────────────────────
function VideoCall({ appointment, onEnd }) {
    const { doctor, slot, appointmentId, urls = {}, joinUrls = {}, source } = appointment;

    // Display URLs (what aiRender would return) — shown in the Room panel and copied.
    const inviteeURL = urls.InviteeURL || urls.inviteeURL || '';
    const hostURL = urls.hostURL || '';
    const guestURL = urls.guestURL || '';

    // Join URLs (what the iframe + Open room button actually load). In live
    // mode these are the same as the aiRender URLs. In simulator mode they
    // point to /demo-room.html so the demo actually opens a working room.
    const joinInvitee = joinUrls.InviteeURL || joinUrls.inviteeURL || inviteeURL;
    const joinHost = joinUrls.hostURL || hostURL;
    const joinGuest = joinUrls.guestURL || guestURL;

    const [duration, setDuration] = useState(0);
    const [status, setStatus] = useState('connecting');
    const [muted, setMuted] = useState(false);
    const [videoOff, setVideoOff] = useState(false);
    const [tab, setTab] = useState('info');
    const [chat, setChat] = useState([{ from: 'system', text: 'Secure teleconsultation room ready · aiRender / IAMyHealth' }]);
    const [chatInput, setChatInput] = useState('');
    const [notes, setNotes] = useState([]);
    const [embedFailed, setEmbedFailed] = useState(false);

    useEffect(() => {
        const t1 = setTimeout(() => {
            setStatus('live');
            setChat(c => [...c, { from: 'doctor', text: `Hello! I'm ${doctor.name}. How can I help you today?` }]);
            setNotes(n => [...n, { time: '0:00', text: 'Session started. AI note-taker active.' }]);
        }, 1500);
        return () => clearTimeout(t1);
    }, [doctor.name]);

    useEffect(() => {
        if (status !== 'live') return;
        const t = setInterval(() => setDuration(d => d + 1), 1000);
        return () => clearInterval(t);
    }, [status]);

    useEffect(() => {
        if (status !== 'live') return;
        const timers = [
            setTimeout(() => setNotes(n => [...n, { time: '0:08', text: 'Patient presenting for consultation. Chief complaint noted.' }]), 8000),
            setTimeout(() => setNotes(n => [...n, { time: '0:20', text: 'AI: symptom analysis in progress…' }]), 20000),
            setTimeout(() => setNotes(n => [...n, { time: '0:35', text: 'Suggested follow-up: basic labs / ECG if cardiac concern.' }]), 35000),
        ];
        return () => timers.forEach(clearTimeout);
    }, [status]);

    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    const sendChat = () => {
        const m = chatInput.trim(); if (!m) return;
        setChat(c => [...c, { from: 'patient', text: m }]); setChatInput('');
        setTimeout(() => {
            const replies = [
                'I see. Can you describe the symptom more — is it constant or comes and goes?',
                'How long have you been experiencing this?',
                'I will note that in your chart. Have you tried any medication so far?',
                'That helps. I will recommend a few tests; the e-prescription will reach your app shortly.',
            ];
            setChat(c => [...c, { from: 'doctor', text: replies[Math.floor(Math.random() * replies.length)] }]);
        }, 1200);
    };

    const copy = (val) => { try { navigator.clipboard.writeText(val); } catch { } };

    return (
        <div className="video-screen">
            <div className="video-top">
                <div className={status === 'live' ? '' : 'connecting'}>
                    <span className="live-dot"></span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{status === 'live' ? `Live · ${fmt(duration)}` : 'Connecting…'}</span>
                    <span className="backend-chip">🔒 E2E · aiRender Teleconsultation {source === 'mock' ? '(demo)' : ''}</span>
                </div>
                <span style={{ fontSize: 13, color: '#9aa0a6' }}>{doctor.name} · {doctor.specialty} · {slot}</span>
            </div>

            <div className="video-main">
                <div className="video-stage">
                    {joinInvitee && !embedFailed ? (
                        <iframe
                            className="video-iframe"
                            src={joinInvitee}
                            title="aiRender Teleconsultation"
                            allow="camera; microphone; fullscreen; display-capture; autoplay"
                            onError={() => setEmbedFailed(true)}
                        />
                    ) : (
                        <div className="video-fallback">
                            <div className="doc-avatar" style={{ background: doctor.avatarBg, color: doctor.avatarColor }}>{doctor.initials}</div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>{doctor.name}</div>
                            <div style={{ fontSize: 13, color: '#9aa0a6' }}>{doctor.specialty} · {slot}</div>
                            {status === 'connecting' && <div style={{ marginTop: 10, color: '#fbbc04', fontSize: 13 }}>⏳ Setting up secure aiRender channel…</div>}
                            <div style={{ marginTop: 14, fontSize: 12, color: '#9aa0a6', maxWidth: 360, textAlign: 'center' }}>
                                {joinInvitee
                                    ? 'Your teleconsultation room is ready. Tap below to join.'
                                    : 'Generating teleconsultation room…'}
                            </div>
                            {joinInvitee && (
                                <a className="btn-primary" style={{ marginTop: 12, padding: '10px 22px' }} href={joinInvitee} target="_blank" rel="noopener noreferrer">📹 Open teleconsultation room</a>
                            )}
                        </div>
                    )}

                    <div className="pip">
                        {videoOff
                            ? <span style={{ fontSize: 24 }}>📷</span>
                            : <div className="pip-circle">You</div>}
                        <span style={{ fontSize: 10, color: '#9aa0a6' }}>You {videoOff ? '(video off)' : ''}</span>
                    </div>
                </div>

                <div className="video-side">
                    <div className="tabs">
                        <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>Room</button>
                        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
                        <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>AI Notes</button>
                    </div>

                    {tab === 'info' && (
                        <div className="notes">
                            <div style={{ fontSize: 12, color: '#9aa0a6', marginBottom: 10 }}>
                                🔗 aiRender Schedule Meeting · room <b style={{ color: '#e8eaed' }}>{appointment.room || appointmentId}</b>
                            </div>

                            {inviteeURL && (
                                <div className="link-row">
                                    <div className="link-label">Patient (Invitee)</div>
                                    <div className="link-value">
                                        <a href={inviteeURL} target="_blank" rel="noopener noreferrer">{inviteeURL}</a>
                                        <button className="copy-btn" onClick={() => copy(inviteeURL)}>copy</button>
                                    </div>
                                </div>
                            )}
                            {hostURL && (
                                <div className="link-row">
                                    <div className="link-label">Doctor (Host)</div>
                                    <div className="link-value">
                                        <a href={hostURL} target="_blank" rel="noopener noreferrer">{hostURL}</a>
                                        <button className="copy-btn" onClick={() => copy(hostURL)}>copy</button>
                                    </div>
                                </div>
                            )}
                            {guestURL && (
                                <div className="link-row">
                                    <div className="link-label">Guest</div>
                                    <div className="link-value">
                                        <a href={guestURL} target="_blank" rel="noopener noreferrer">{guestURL}</a>
                                        <button className="copy-btn" onClick={() => copy(guestURL)}>copy</button>
                                    </div>
                                </div>
                            )}

                            <div className="note-item">
                                <div className="time">Appointment ID</div>
                                <div className="text">{appointmentId}</div>
                            </div>
                            <div className="note-item">
                                <div className="time">Backend</div>
                                <div className="text">{source === 'live' ? 'aiRender (live)' : 'aiRender (demo simulator)'}</div>
                            </div>
                            <div className="note-item">
                                <div className="time">Patient</div>
                                <div className="text">{appointment.patient?.name} · {appointment.patient?.phone}</div>
                            </div>
                            {appointment.note && (
                                <div className="note-item">
                                    <div className="time">Note</div>
                                    <div className="text" style={{ color: '#fbbc04' }}>{appointment.note}</div>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'chat' && (
                        <>
                            <div className="chat">
                                {chat.map((m, i) => (
                                    <div key={i} className={'chat-msg ' + m.from}>{m.text}</div>
                                ))}
                            </div>
                            <div className="chat-input">
                                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Type a message…" />
                                <button onClick={sendChat}>Send</button>
                            </div>
                        </>
                    )}

                    {tab === 'notes' && (
                        <div className="notes">
                            <div style={{ fontSize: 12, color: '#9aa0a6', marginBottom: 10 }}>🤖 AI Note-taker — clinical notes auto-generated</div>
                            {notes.map((n, i) => (
                                <div key={i} className="note-item">
                                    <div className="time">{n.time}</div>
                                    <div className="text">{n.text}</div>
                                </div>
                            ))}
                            {notes.length === 0 && <div style={{ fontSize: 12, color: '#9aa0a6' }}>Notes appear here as the session progresses…</div>}
                        </div>
                    )}
                </div>
            </div>

            <div className="video-controls">
                <button onClick={() => setMuted(!muted)}>{muted ? '🔇' : '🎤'}<span>{muted ? 'Unmute' : 'Mute'}</span></button>
                <button onClick={() => setVideoOff(!videoOff)}>{videoOff ? '🚫' : '📹'}<span>{videoOff ? 'Video on' : 'Video'}</span></button>
                <button onClick={() => setTab('chat')}>💬<span>Chat</span></button>
                <button onClick={() => setTab('notes')}>🤖<span>AI Notes</span></button>
                <button onClick={() => alert('e-Prescription sent (demo)')}>💊<span>e-Prescribe</span></button>
                {joinInvitee && (
                    <button onClick={() => window.open(joinInvitee, '_blank', 'noopener')}>
                        ↗<span>Open room</span>
                    </button>
                )}
                {source === 'mock' && joinHost && (
                    <button onClick={() => window.open(joinHost, '_blank', 'noopener')} title="Open the doctor view in a new tab — useful for the demo">
                        👨‍⚕️<span>Open as doctor</span>
                    </button>
                )}
                <button className="danger" onClick={onEnd}>📵<span>End Call</span></button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// App root
// ─────────────────────────────────────────────────────────────
function App() {
    const [doctors, setDoctors] = useState([]);
    const [upstream, setUpstream] = useState(null); // 'live' | 'mock'
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [specialty, setSpecialty] = useState('all');
    const [day, setDay] = useState('this week');
    const [voiceReason, setVoiceReason] = useState(null);

    // Geolocation state — browser handles its own permission UX.
    const [userLocation, setUserLocation] = useState(null); // { lat, lng, accuracy }
    const [locating, setLocating] = useState(false);

    const [pending, setPending] = useState(null);          // booking modal payload
    const [confirmed, setConfirmed] = useState(null);      // booking made, awaiting "join now"
    const [appointment, setAppointment] = useState(null);  // joined the call

    const requestLocation = () => {
        if (!navigator.geolocation) return; // silently fall back
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserLocation({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                });
                setLocating(false);
            },
            () => {
                // Permission denied / position unavailable / timeout — silently
                // fall back to the hard-coded distances; no UI pill.
                setLocating(false);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
        );
    };

    // Initial load — health probe + first doctor list + auto-request location.
    // The browser shows its own native permission prompt; if the user denies,
    // we silently fall back to the hard-coded `distanceKm` values.
    useEffect(() => {
        (async () => {
            try {
                const h = await api.health();
                setUpstream(h?.upstream?.reachable ? 'live' : 'mock');
            } catch { setUpstream('mock'); }
            await loadDoctors({});
        })();
        requestLocation();
    }, []);

  const loadDoctors = async ({ specialty, day }) => {
    setLoading(true);
    try {
        // 1. Grab your local data array from memory
        let list = window.DOCTORS || [];

        // 2. Filter by specialty (matching your backend check for 'all')
        if (specialty && specialty.toLowerCase() !== 'all') {
        list = list.filter(doc => 
            doc.specialty.toLowerCase() === specialty.toLowerCase()
        );
        }

        // 3. Filter by day timeline (matching your backend check for 'this week')
        if (day && day.toLowerCase() !== 'this week') {
        const targetDay = day.toLowerCase();
        if (targetDay === 'today') {
            list = list.filter(doc => doc.daysAhead === 0);
        } else if (targetDay === 'tomorrow') {
            list = list.filter(doc => doc.daysAhead === 1);
        }
        }

        // 4. Update the React state variable directly
        setDoctors(list);
    } catch (err) {
        console.error("Local data filtering error:", err);
    } finally {
        setLoading(false);
    }
    };

    useEffect(() => { loadDoctors({ specialty, day }); }, [specialty, day]);

    // Re-compute every doctor's distance whenever we have a user location.
    // This overrides the static `distanceKm` baked into mockData.
    const doctorsWithDistance = useMemo(() => {
        if (!userLocation) return doctors;
        return doctors.map(d => {
            const dist = haversineKm(userLocation.lat, userLocation.lng, d.lat, d.lng);
            return dist == null ? d : { ...d, distanceKm: dist };
        });
    }, [doctors, userLocation]);

    const filtered = useMemo(() => {
        const q = query.toLowerCase().trim();
        const baseList = doctorsWithDistance;
        const cleanQuery = q.replace(/nearby|near me|near|close by|closest/g, '').trim();
        const nearQuery = isNearSearch(q);

        const match = baseList.filter(d => {
            const hay = `${d.name} ${d.specialty} ${d.hospital} ${d.location} ${(d.tags || []).join(' ')}`.toLowerCase();
            return cleanQuery ? hay.includes(cleanQuery) : true;
        });

        // Sort by distance when:
        //   - user explicitly typed/said "near me", or
        //   - user granted geolocation (then distance is genuinely meaningful).
        if (nearQuery || userLocation) {
            return match.slice().sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
        }
        return match;
    }, [query, doctorsWithDistance, userLocation]);

    const onSuggest = ({ specialty, reason, transcript }) => {
        setSpecialty(specialty);
        setVoiceReason(reason);
        setQuery('');

        // If the patient mentioned location, kick off a geolocation request
        // automatically so the auto-pick uses real distance.
        const searchText = (transcript || reason || '').toLowerCase();
        if (isNearSearch(searchText) && !userLocation && !locating) {
            requestLocation();
        }

        setTimeout(async () => {
            const res = await api.doctors({ specialty });
            const list = res?.data || [];

            // Apply the same distance override + sort the main list uses.
            const withDist = userLocation
                ? list.map(d => {
                    const dist = haversineKm(userLocation.lat, userLocation.lng, d.lat, d.lng);
                    return dist == null ? d : { ...d, distanceKm: dist };
                })
                : list;

            const ordered = (isNearSearch(searchText) || userLocation)
                ? withDist.slice().sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
                : withDist;

            if (ordered.length) {
                const doc = ordered[0];
                const upcoming = getVisibleSlots(doc, day);
                const slot = upcoming[0]; // Only auto-pick if there is a genuinely upcoming slot.
                if (slot) setPending({ doctor: doc, slot, reason: transcript || reason, date: getAppointmentDateString(doc, day) });
            }
        }, 250);
    };

    const onSlot = (doctor, slot) => {
        setPending({ doctor, slot, reason: voiceReason || '', date: getAppointmentDateString(doctor, day) });
    };

    if (appointment) {
        return <VideoCall appointment={appointment} onEnd={() => setAppointment(null)} />;
    }
    if (confirmed) {
        return (
            <BookingConfirmation
                appointment={confirmed}
                onJoin={() => { setAppointment(confirmed); setConfirmed(null); }}
                onDone={() => setConfirmed(null)}
            />
        );
    }

    return (
        <div>
            <Header upstream={upstream} />
            <Hero
                query={query} setQuery={setQuery}
                specialty={specialty} setSpecialty={setSpecialty}
                day={day} setDay={setDay}
            />

            <main className="main">
                <VoicePanel onSuggest={onSuggest} />

                <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                        <h2>{filtered.length} {filtered.length === 1 ? 'doctor' : 'doctors'} found</h2>
                        <p>
                            {specialty === 'all' ? 'All specialties' : specialty} · {day}
                            {query ? ` · "${query}"` : ''}
                            {userLocation ? ' · 📍 sorted by distance from you' : ''}
                        </p>
                    </div>
                    <div style={{ fontSize: 12, color: '#5f6368', display: 'flex', gap: 14 }}>
                        <span>🔒 Verified profiles</span>
                        <span>🎥 aiRender video</span>
                        <span>💳 Secure payments</span>
                    </div>
                </div>

                {loading ? (
                    <div className="empty"><div className="icon">⏳</div><div>Loading doctors…</div></div>
                ) : filtered.length === 0 ? (
                    <div className="empty">
                        <div className="icon">🔍</div>
                        <h3>No doctors match your filters</h3>
                        <p>Try a different specialty or expand the time range.</p>
                        <button className="btn-primary" style={{ flex: 'none', marginTop: 14, padding: '10px 22px' }} onClick={() => { setQuery(''); setSpecialty('all'); setDay('this week'); }}>Reset filters</button>
                    </div>
                ) : (
                    filtered.map(doc => <DoctorRow key={doc.id} doc={doc} onSlot={onSlot} day={day} userLocation={userLocation} />)
                )}
            </main>

            <footer className="footer">
                © 2026 DrRobo Telehealth · Teleconsultation powered by aiRender / IAMyHealth Schedule Meeting API
            </footer>

            {pending && (
                <BookingModal
                    booking={pending}
                    onCancel={() => setPending(null)}
                    onConfirmed={(appt) => { setPending(null); setConfirmed(appt); }}
                />
            )}
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
