/**
 * ════════════════════════════════════════════════════════════════════════
 *   DrRobo Telehealth — Email webhook (Google Apps Script)
 * ════════════════════════════════════════════════════════════════════════
 *
 *   WHAT THIS DOES
 *   --------------
 *   The DrRobo frontend POSTs booking details to this Apps Script. The
 *   script then sends a teleconsultation invite from YOUR Gmail to both
 *   the patient and the doctor. It runs on Google's servers as YOU, so
 *   no SMTP password is ever in the deployed code or in a committed file.
 *
 *   5-MINUTE SETUP (do this once)
 *   -----------------------------
 *   1. Open https://script.google.com  → New project.
 *   2. Replace the default `Code.gs` with this entire file. Save.
 *   3. Click  Deploy  →  New deployment  →  Type: Web app
 *        • Description     : DrRobo email webhook
 *        • Execute as      : Me (your-gmail@gmail.com)
 *        • Who has access  : Anyone
 *      Click Deploy. Authorise when prompted (you'll see a Google warning;
 *      click "Advanced" → "Go to (unsafe)" — it's your own script).
 *   4. Copy the "Web app URL" Google gives you. It looks like:
 *        https://script.google.com/macros/s/AKfycby.../exec
 *   5. Paste it into index.html:
 *        <meta name="email-webhook" content="PASTE_URL_HERE" />
 *   6. Push to GitHub. AWS Amplify rebuilds. The live URL now sends real
 *      emails through your Gmail.
 *
 *   That's it — no SMTP password, no Render, no nothing.
 *
 *   To update the script later, edit it in Apps Script → Deploy → Manage
 *   deployments → edit the existing version (do NOT create a new
 *   deployment — that gives you a different URL).
 * ════════════════════════════════════════════════════════════════════════
 */

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // Lightweight message broker so two devices can talk in real time without
    // needing Firebase / Render / etc. Patient and doctor each POST their
    // messages here and poll via GET below.
    if (payload.action === 'chat' || payload.action === 'presence' || payload.action === 'bye') {
      return _json(storeMessage_(payload));
    }
    // Default: booking email send.
    const result = sendBookingEmails_(payload);
    return _json({ ok: true, ...result });
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message || err) });
  }
}

// Allow GET to either verify reachability or poll for new messages.
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'poll') {
    return _json(pollMessages_(e.parameter.room, parseInt(e.parameter.since || '0', 10)));
  }
  return _json({ ok: true, service: 'DrRobo email webhook', time: new Date().toISOString() });
}

// ── Tiny in-memory chat broker, keyed by room ────────────────────────────
function storeMessage_(p) {
  const cache  = CacheService.getScriptCache();
  const room   = p.room || 'default';
  const key    = 'msgs:' + room;
  const existing = cache.get(key);
  const messages = existing ? JSON.parse(existing) : [];
  const msg = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    type: p.type || p.action || 'chat',
    from: p.from || 'unknown',
    name: p.name || '',
    text: p.text || '',
  };
  messages.push(msg);
  const recent = messages.slice(-100);
  // Cache for 1 hour — plenty for any single consultation.
  cache.put(key, JSON.stringify(recent), 3600);
  return { ok: true, stored: true, msg: msg };
}

function pollMessages_(room, since) {
  const cache    = CacheService.getScriptCache();
  const key      = 'msgs:' + (room || 'default');
  const existing = cache.get(key);
  const messages = existing ? JSON.parse(existing) : [];
  const filtered = messages.filter(function (m) { return m.ts > (since || 0); });
  return { ok: true, messages: filtered, now: Date.now() };
}

function sendBookingEmails_(p) {
  const doctorName   = p.doctorName   || 'Telehealth Doctor';
  const patientName  = p.patientName  || 'Patient';
  const patientEmail = (p.patientEmail || '').trim() || 'jayanipatel23@gmail.com';
  const doctorEmail  = (p.doctorEmail  || '').trim() || 'more.jayesh7777@gmail.com';
  const slot         = p.slot         || '';
  const date         = p.date         || '';
  const room         = p.room         || '';
  const reason       = p.reason       || '';
  const fee          = p.fee          || '';
  const patientJoin  = p.patientJoinUrl || '';
  const doctorJoin   = p.doctorJoinUrl  || '';
  const aiPatient    = p.aiRenderInviteeUrl || '';
  const aiDoctor     = p.aiRenderHostUrl   || '';

  const readable = slot + ' on ' + date;

  GmailApp.sendEmail(
    patientEmail,
    'Teleconsultation confirmed with ' + doctorName + ' — ' + readable,
    _plain('invitee', { doctorName, patientName, slot, date, room, reason, fee, joinUrl: patientJoin, aiRenderUrl: aiPatient }),
    {
      name: 'DrRobo Telehealth',
      htmlBody: _html('invitee', { doctorName, patientName, slot, date, room, reason, fee, joinUrl: patientJoin, aiRenderUrl: aiPatient }),
    }
  );

  GmailApp.sendEmail(
    doctorEmail,
    'New teleconsultation booked with ' + patientName + ' — ' + readable,
    _plain('host', { doctorName, patientName, slot, date, room, reason, fee, joinUrl: doctorJoin, aiRenderUrl: aiDoctor }),
    {
      name: 'DrRobo Telehealth',
      htmlBody: _html('host', { doctorName, patientName, slot, date, room, reason, fee, joinUrl: doctorJoin, aiRenderUrl: aiDoctor }),
    }
  );

  return {
    sent: true,
    mode: 'apps-script',
    patient: { email: patientEmail },
    doctor:  { email: doctorEmail  },
  };
}

function _plain(kind, x) {
  return [
    kind === 'host'
      ? 'You are scheduled as the host (doctor) for a teleconsultation.'
      : 'Your teleconsultation with ' + x.doctorName + ' is confirmed.',
    '',
    'Doctor : ' + x.doctorName,
    'Patient: ' + x.patientName,
    'Date   : ' + x.date,
    'Slot   : ' + x.slot,
    'Room   : ' + x.room,
    x.reason ? 'Reason : ' + x.reason : '',
    x.fee    ? 'Fee    : INR ' + x.fee : '',
    '',
    'Join link: ' + (x.joinUrl || '(generated at slot time)'),
    x.aiRenderUrl ? 'aiRender link: ' + x.aiRenderUrl : '',
    '',
    '— DrRobo Telehealth (powered by aiRender / IAMyHealth)',
  ].filter(Boolean).join('\n');
}

function _html(kind, x) {
  const cta = x.joinUrl
    ? '<a href="' + x.joinUrl + '" style="display:inline-block;background:linear-gradient(135deg,#00a98f,#0099ff);color:#fff;font-weight:600;padding:14px 28px;border-radius:9999px;text-decoration:none;font-size:15px;">Join Teleconsultation</a>'
    : '';
  const roleLine = kind === 'host'
    ? '<p>You have been scheduled as the <b>host (doctor)</b> for the following teleconsultation:</p>'
    : '<p>Your teleconsultation with <b>' + x.doctorName + '</b> is confirmed.</p>';

  return '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f8;margin:0;padding:30px;color:#1a1a1a;">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.06);">' +
      '<div style="background:linear-gradient(135deg,#00a98f,#0099ff);padding:24px 28px;color:#fff;">' +
        '<div style="font-size:22px;font-weight:700;">DrRobo Telehealth</div>' +
        '<div style="font-size:12px;opacity:.85;margin-top:2px;letter-spacing:.04em;text-transform:uppercase;">Powered by aiRender · IAMyHealth</div>' +
      '</div>' +
      '<div style="padding:28px;">' +
        '<h2 style="margin:0 0 12px;font-size:20px;">Teleconsultation Confirmed</h2>' +
        roleLine +
        '<table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;">' +
          '<tr><td style="padding:8px 0;color:#5f6368;width:40%;">Doctor</td><td style="padding:8px 0;font-weight:600;">' + x.doctorName + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:#5f6368;">Patient</td><td style="padding:8px 0;">' + x.patientName + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:#5f6368;">Date</td><td style="padding:8px 0;">' + x.date + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:#5f6368;">Slot</td><td style="padding:8px 0;color:#00a98f;font-weight:600;">' + x.slot + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:#5f6368;">Room ID</td><td style="padding:8px 0;font-family:ui-monospace,SF Mono,Menlo,monospace;">' + x.room + '</td></tr>' +
          (x.reason ? '<tr><td style="padding:8px 0;color:#5f6368;">Reason</td><td style="padding:8px 0;font-style:italic;">' + x.reason + '</td></tr>' : '') +
          (x.fee    ? '<tr><td style="padding:8px 0;color:#5f6368;">Fee</td><td style="padding:8px 0;">INR ' + x.fee + '</td></tr>' : '') +
        '</table>' +
        '<div style="text-align:center;margin:24px 0 10px;">' + cta + '</div>' +
        (x.aiRenderUrl ? '<p style="font-size:11px;color:#9aa0a6;margin-top:18px;word-break:break-all;">aiRender direct link: <a href="' + x.aiRenderUrl + '" style="color:#1a73e8;">' + x.aiRenderUrl + '</a></p>' : '') +
        '<p style="font-size:12px;color:#5f6368;margin-top:24px;border-top:1px solid #e8eaed;padding-top:14px;">Secure · Powered by aiRender / IAMyHealth Schedule Meeting<br>Need help? Reply to this email and the DrRobo team will assist.</p>' +
      '</div>' +
    '</div></body></html>';
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
