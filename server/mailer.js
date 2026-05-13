// ─────────────────────────────────────────────────────────────────────────────
// DrRobo Telehealth — booking email service
//
// Sends a teleconsultation invite to both the patient and the doctor after a
// booking is scheduled. Uses Gmail SMTP if `SMTP_USER` and `SMTP_PASS` are set
// in `.env`; otherwise it falls back to logging the full email to the server
// console — handy for demos where you want to *show* what email was sent
// without actually delivering it.
// ─────────────────────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = (process.env.SMTP_SECURE || 'true').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_NAME = process.env.MAIL_FROM_NAME || 'DrRobo Telehealth';
const FROM_ADDR = process.env.MAIL_FROM || SMTP_USER || 'no-reply@drrobo.demo';

const DEFAULT_DOCTOR_EMAIL = process.env.DEMO_DOCTOR_EMAIL || 'more.jayesh7777@gmail.com';
const DEFAULT_PATIENT_EMAIL = process.env.DEMO_PATIENT_EMAIL || 'jayanipatel23@gmail.com';
// Public base URL used to turn relative /demo-room.html links into absolute
// URLs that work when clicked from an email. Override in .env when deployed.
const PUBLIC_APP_BASE_URL = (process.env.PUBLIC_APP_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');

function absolutize(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return PUBLIC_APP_BASE_URL + (url.startsWith('/') ? url : '/' + url);
}

let transporter = null;
const liveMode = !!(SMTP_USER && SMTP_PASS);

if (liveMode) {
    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
}

function fmtIsoToReadable(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return iso; }
}

function inviteHtml({ kind, patientName, doctorName, slot, date, room, joinUrl, aiRenderUrl, reason, fee }) {
    const cta = joinUrl
        ? `<a href="${joinUrl}" style="display:inline-block;background:linear-gradient(135deg,#00a98f,#0099ff);color:#fff;font-weight:600;padding:14px 28px;border-radius:9999px;text-decoration:none;font-size:15px;">📹 Join Teleconsultation</a>`
        : '';
    const roleLine = kind === 'host'
        ? `<p>You have been scheduled as the <b>host (doctor)</b> for the following teleconsultation:</p>`
        : `<p>Your teleconsultation with <b>${doctorName}</b> is confirmed.</p>`;
    return `
<!doctype html>
<html><body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f4f6f8;margin:0;padding:30px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.06);">
    <div style="background:linear-gradient(135deg,#00a98f,#0099ff);padding:24px 28px;color:#fff;">
      <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;">DrRobo Telehealth</div>
      <div style="font-size:12px;opacity:.85;margin-top:2px;letter-spacing:.04em;text-transform:uppercase;">Powered by aiRender · IAMyHealth</div>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 12px;font-size:20px;">Teleconsultation Confirmed</h2>
      ${roleLine}

      <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#5f6368;width:40%;">👨‍⚕️ Doctor</td><td style="padding:8px 0;font-weight:600;">${doctorName}</td></tr>
        <tr><td style="padding:8px 0;color:#5f6368;">🧑 Patient</td><td style="padding:8px 0;">${patientName}</td></tr>
        <tr><td style="padding:8px 0;color:#5f6368;">📅 Date</td><td style="padding:8px 0;">${date}</td></tr>
        <tr><td style="padding:8px 0;color:#5f6368;">🕐 Slot</td><td style="padding:8px 0;color:#00a98f;font-weight:600;">${slot}</td></tr>
        <tr><td style="padding:8px 0;color:#5f6368;">🔗 Room ID</td><td style="padding:8px 0;font-family:ui-monospace,'SF Mono',Menlo,monospace;">${room}</td></tr>
        ${reason ? `<tr><td style="padding:8px 0;color:#5f6368;">📝 Reason</td><td style="padding:8px 0;font-style:italic;">${reason}</td></tr>` : ''}
        ${fee ? `<tr><td style="padding:8px 0;color:#5f6368;">💳 Fee</td><td style="padding:8px 0;">₹${fee}</td></tr>` : ''}
      </table>

      <p style="margin:20px 0 10px;font-size:13px;color:#5f6368;">
        ${kind === 'host'
            ? 'Tap below to open the host (doctor) view of the teleconsultation room. You can let the patient in from the waiting lobby.'
            : 'Tap below at your scheduled slot time to join the secure video room. You will land in a waiting lobby until the doctor admits you.'}
      </p>

      <div style="text-align:center;margin:24px 0 10px;">${cta}</div>

      ${aiRenderUrl ? `<p style="font-size:11px;color:#9aa0a6;margin-top:18px;word-break:break-all;">aiRender direct link: <a href="${aiRenderUrl}" style="color:#1a73e8;">${aiRenderUrl}</a></p>` : ''}

      <p style="font-size:12px;color:#5f6368;margin-top:24px;border-top:1px solid #e8eaed;padding-top:14px;">
        🔒 End-to-end encrypted · Powered by aiRender / IAMyHealth Schedule Meeting<br>
        Need help? Reply to this email and the DrRobo team will assist.
      </p>
    </div>
  </div>
</body></html>
`.trim();
}

function inviteText({ kind, patientName, doctorName, slot, date, room, joinUrl, aiRenderUrl }) {
    return [
        kind === 'host' ? `You're scheduled as the host (doctor) for a teleconsultation.` : `Your teleconsultation with ${doctorName} is confirmed.`,
        ``,
        `Doctor : ${doctorName}`,
        `Patient: ${patientName}`,
        `Date   : ${date}`,
        `Slot   : ${slot}`,
        `Room   : ${room}`,
        ``,
        `Join link: ${joinUrl || '(generated at slot time)'}`,
        aiRenderUrl ? `aiRender link: ${aiRenderUrl}` : '',
        ``,
        `— DrRobo Telehealth (powered by aiRender / IAMyHealth)`,
    ].filter(Boolean).join('\n');
}

async function sendOne(to, subject, html, text) {
    if (!to) return { sent: false, reason: 'no recipient' };

    if (!liveMode) {
        // Simulation mode — log the email so it can be shown during the demo.
        console.log(`\n[mailer] (simulated — set SMTP_USER & SMTP_PASS in .env to send for real)`);
        console.log(`[mailer] To     : ${to}`);
        console.log(`[mailer] From   : ${FROM_NAME} <${FROM_ADDR}>`);
        console.log(`[mailer] Subject: ${subject}`);
        console.log(`[mailer] ──────── body ────────`);
        console.log(text);
        console.log(`[mailer] ──────────────────────\n`);
        return { sent: true, simulated: true };
    }

    try {
        const info = await transporter.sendMail({
            from: `${FROM_NAME} <${FROM_ADDR}>`,
            to,
            subject,
            text,
            html,
        });
        console.log(`[mailer] ✓ Sent to ${to} (messageId=${info.messageId})`);
        return { sent: true, simulated: false, messageId: info.messageId };
    } catch (err) {
        console.error(`[mailer] ✗ Failed to send to ${to}: ${err.message}`);
        return { sent: false, error: err.message };
    }
}

async function sendBookingEmails(booking) {
    const {
        doctor = {}, patient = {}, slot, date, room, reason, fee,
        joinUrls = {}, urls = {},
    } = booking;

    const doctorName = doctor.name || 'Telehealth Doctor';
    const patientName = patient.name || 'Patient';
    const patientEmail = patient.email && /@/.test(patient.email) ? patient.email : DEFAULT_PATIENT_EMAIL;
    const doctorEmail = doctor.email && /@/.test(doctor.email) ? doctor.email : DEFAULT_DOCTOR_EMAIL;
    const readableSlot = `${slot} on ${date}`;

    const patientJoin = absolutize(joinUrls.InviteeURL || joinUrls.inviteeURL || urls.InviteeURL || urls.inviteeURL || '');
    const doctorJoin = absolutize(joinUrls.hostURL || urls.hostURL || '');
    const patientAiRender = urls.InviteeURL || urls.inviteeURL || '';
    const doctorAiRender = urls.hostURL || '';

    const baseFields = { slot, date, room, reason, fee, doctorName, patientName };

    const patientResult = await sendOne(
        patientEmail,
        `Teleconsultation confirmed with ${doctorName} — ${readableSlot}`,
        inviteHtml({ kind: 'invitee', ...baseFields, joinUrl: patientJoin, aiRenderUrl: patientAiRender }),
        inviteText({ kind: 'invitee', ...baseFields, joinUrl: patientJoin, aiRenderUrl: patientAiRender }),
    );

    const doctorResult = await sendOne(
        doctorEmail,
        `New teleconsultation booked with ${patientName} — ${readableSlot}`,
        inviteHtml({ kind: 'host', ...baseFields, joinUrl: doctorJoin, aiRenderUrl: doctorAiRender }),
        inviteText({ kind: 'host', ...baseFields, joinUrl: doctorJoin, aiRenderUrl: doctorAiRender }),
    );

    return {
        mode: liveMode ? 'live' : 'simulated',
        patient: { email: patientEmail, ...patientResult },
        doctor: { email: doctorEmail, ...doctorResult },
    };
}

module.exports = { sendBookingEmails, liveMode, DEFAULT_DOCTOR_EMAIL, DEFAULT_PATIENT_EMAIL };
