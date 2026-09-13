const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 5500);
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bat': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function dataPath(name) {
  return path.join(DATA, name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.writeFileSync(dataPath(name), `${JSON.stringify(value, null, 2)}\n`);
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function text(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(value);
}

function noContent(res) {
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Request body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function dateKey(date = new Date()) {
  const local = new Date(date);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeKey(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addMinutes(hhmm, minutes) {
  const [hours, mins] = String(hhmm).split(':').map(Number);
  const value = new Date(2000, 0, 1, hours || 0, mins || 0);
  value.setMinutes(value.getMinutes() + Number(minutes || 0));
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function eventDate(event) {
  return dateKey(event.timestamp || event.created_at || new Date());
}

function verifiedToday(routineId, day) {
  return readJson('events.json', []).some(event =>
    event.routine_id === routineId && eventDate(event) === day && event.status === 'verified'
  );
}

function eventExists(routineId, day, status) {
  return readJson('events.json', []).some(event =>
    event.routine_id === routineId && eventDate(event) === day && event.status === status
  );
}

function reminderKey(routineId, day) {
  return `${routineId}:${day}`;
}

function triggerReminder(routine) {
  const day = dateKey();
  const reminders = readJson('reminders.json', []);
  const key = reminderKey(routine.id, day);
  if (reminders.some(item => item.key === key)) return;
  const reminder = {
    id: `reminder_${Date.now()}_${routine.id}`,
    key,
    routine_id: routine.id,
    label: routine.label,
    type: routine.type,
    scheduled_time: routine.scheduled_time,
    created_at: nowIso(),
    acknowledged: false
  };
  reminders.push(reminder);
  writeJson('reminders.json', reminders.slice(-200));
  console.log(`[scheduler] reminder due: ${routine.label} (${routine.scheduled_time})`);
}

function markMissed(routine) {
  const day = dateKey();
  if (verifiedToday(routine.id, day) || eventExists(routine.id, day, 'missed')) return;
  const events = readJson('events.json', []);
  const event = {
    routine_id: routine.id,
    timestamp: nowIso(),
    status: 'missed',
    confidence: 0,
    step_confidences: []
  };
  events.push(event);
  writeJson('events.json', events.slice(-2000));
  console.log(`[scheduler] missed: ${routine.label}`);
  notifyFamily(routine, 'missed').catch(error => console.error('[whatsapp]', error.message));
}

async function sendWhatsAppAlert(toNumber, templateName, variables) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || 'v19.0';
  if (!token || !phoneNumberId || !toNumber) {
    console.log(`[whatsapp] skipped ${templateName}; server credentials or recipient are not configured`);
    return { skipped: true };
  }
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [{ type: 'body', parameters: variables.map(value => ({ type: 'text', text: String(value) })) }]
      }
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `WhatsApp API returned ${response.status}`);
  return result;
}

async function notifyFamily(routine, eventType) {
  const family = readJson('family.json', { elder_name: 'Elder', contacts: [] });
  for (const contact of family.contacts || []) {
    const notifyOn = Array.isArray(contact.notify_on) ? contact.notify_on : [contact.notify_on];
    if (notifyOn.includes('all') || notifyOn.includes(eventType)) {
      await sendWhatsAppAlert(contact.whatsapp_number, 'medication_missed_alert', [
        family.elder_name, routine.label, routine.scheduled_time
      ]);
    }
  }
}

const summarySent = new Set();
async function checkDailySummaries(now) {
  const family = readJson('family.json', { elder_name: 'Elder', contacts: [] });
  const routines = readJson('routines.json', []);
  const events = readJson('events.json', []);
  const today = dateKey(now);
  for (const contact of family.contacts || []) {
    const key = `${contact.id}:${today}`;
    if (!contact.daily_summary || timeKey(now) < contact.daily_summary_time || summarySent.has(key)) continue;
    summarySent.add(key);
    const scheduled = routines.filter(item => item.active && item.days_of_week?.includes(WEEKDAYS[now.getDay()])).length;
    const completed = events.filter(event => eventDate(event) === today && event.status === 'verified').length;
    await sendWhatsAppAlert(contact.whatsapp_number, 'daily_summary', [family.elder_name, completed, scheduled]);
  }
}

function checkSchedule() {
  const now = new Date();
  const currentTime = timeKey(now);
  const today = dateKey(now);
  const weekday = WEEKDAYS[now.getDay()];
  const routines = readJson('routines.json', []);
  for (const routine of routines) {
    if (!routine.active || !routine.days_of_week?.includes(weekday)) continue;
    const alreadyReminded = readJson('reminders.json', []).some(item => item.key === reminderKey(routine.id, today));
    if (currentTime >= routine.scheduled_time && !alreadyReminded) triggerReminder(routine);
    const graceDeadline = addMinutes(routine.scheduled_time, routine.grace_period_minutes);
    if (currentTime >= graceDeadline && !verifiedToday(routine.id, today) && !eventExists(routine.id, today, 'missed')) {
      markMissed(routine);
    }
  }
  checkDailySummaries(now).catch(error => console.error('[summary]', error.message));
}

function cleanRoutine(input, existing = {}) {
  const label = String(input.label || existing.label || 'Untitled routine').trim();
  const type = ['medicine', 'exercise', 'walk'].includes(input.type || existing.type) ? (input.type || existing.type) : 'medicine';
  const scheduledTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(input.scheduled_time || existing.scheduled_time) ? (input.scheduled_time || existing.scheduled_time) : '08:00';
  const days = Array.isArray(input.days_of_week || existing.days_of_week) ? (input.days_of_week || existing.days_of_week).filter(day => WEEKDAYS.includes(day)) : WEEKDAYS.slice(1);
  return {
    id: input.id || existing.id,
    type,
    label,
    scheduled_time: scheduledTime,
    grace_period_minutes: Math.max(0, Number(input.grace_period_minutes ?? existing.grace_period_minutes ?? 30)),
    days_of_week: days.length ? days : WEEKDAYS.slice(1),
    active: input.active ?? existing.active ?? true
  };
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const resource = parts[1];
  if (req.method === 'OPTIONS') return noContent(res);

  if (resource === 'routines') {
    const routines = readJson('routines.json', []);
    if (req.method === 'GET') return json(res, 200, routines);
    if (req.method === 'POST') {
      const input = await readBody(req);
      const base = String(input.label || 'routine').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'routine';
      let id = base;
      let n = 2;
      while (routines.some(item => item.id === id)) id = `${base}_${n++}`;
      const routine = cleanRoutine({ ...input, id });
      routines.push(routine);
      writeJson('routines.json', routines);
      return json(res, 201, routine);
    }
    if (parts[2]) {
      const index = routines.findIndex(item => item.id === parts[2]);
      if (index < 0) return json(res, 404, { error: 'Routine not found' });
      if (req.method === 'PUT') {
        const updated = cleanRoutine(await readBody(req), routines[index]);
        routines[index] = updated;
        writeJson('routines.json', routines);
        return json(res, 200, updated);
      }
      if (req.method === 'DELETE') {
        routines.splice(index, 1);
        writeJson('routines.json', routines);
        return noContent(res);
      }
    }
  }

  if (resource === 'events') {
    const events = readJson('events.json', []);
    if (req.method === 'GET') {
      const requestedDate = url.searchParams.get('date') || dateKey();
      return json(res, 200, events.filter(event => eventDate(event) === requestedDate));
    }
    if (req.method === 'POST') {
      const input = await readBody(req);
      const event = {
        routine_id: String(input.routine_id || 'morning_medicine'),
        timestamp: input.timestamp || nowIso(),
        status: ['verified', 'uncertain', 'failed', 'manual_override', 'missed'].includes(input.status) ? input.status : 'uncertain',
        confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0))),
        step_confidences: Array.isArray(input.step_confidences) ? input.step_confidences.map(value => Number(value)) : []
      };
      if (input.duration_seconds !== undefined) {
        const duration = Number(input.duration_seconds);
        if (Number.isFinite(duration)) event.duration_seconds = Math.max(0, Math.round(duration));
      }
      events.push(event);
      writeJson('events.json', events.slice(-2000));
      return json(res, 201, event);
    }
  }

  if (resource === 'family') {
    const family = readJson('family.json', { elder_name: 'Elder', contacts: [] });
    if (req.method === 'GET' && !parts[2]) return json(res, 200, family);
    if (parts[2] === 'setup' && req.method === 'POST') {
      const input = await readBody(req);
      const elderName = String(input.elder_name || '').trim();
      const contactName = String(input.contact_name || '').trim();
      const whatsappNumber = String(input.whatsapp_number || '').trim();
      if (!elderName || !contactName || !/^\+[1-9]\d{7,14}$/.test(whatsappNumber)) {
        return json(res, 400, { error: 'Enter an elder name, contact name, and a valid E.164 WhatsApp number.' });
      }
      const existing = family.contacts?.[0] || {};
      family.elder_name = elderName;
      family.contacts = [{
        ...existing,
        id: existing.id || 'primary_contact',
        name: contactName,
        whatsapp_number: whatsappNumber,
        notify_on: existing.notify_on || ['missed', 'uncertain'],
        daily_summary: existing.daily_summary ?? true,
        daily_summary_time: existing.daily_summary_time || '20:00'
      }];
      writeJson('family.json', family);
      return json(res, 200, family);
    }
    if (parts[2] && parts[3] === 'preferences' && req.method === 'POST') {
      const contact = family.contacts.find(item => item.id === parts[2]);
      if (!contact) return json(res, 404, { error: 'Contact not found' });
      const input = await readBody(req);
      if (Array.isArray(input.notify_on)) contact.notify_on = input.notify_on;
      if (typeof input.daily_summary === 'boolean') contact.daily_summary = input.daily_summary;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.daily_summary_time || '')) contact.daily_summary_time = input.daily_summary_time;
      writeJson('family.json', family);
      return json(res, 200, contact);
    }
  }

  if (resource === 'pending-reminders' && req.method === 'GET') {
    const today = dateKey();
    const reminders = readJson('reminders.json', []).filter(item => !item.acknowledged && item.key?.endsWith(`:${today}`));
    return json(res, 200, reminders);
  }

  if (resource === 'reminders' && parts[2] && parts[3] === 'ack' && req.method === 'POST') {
    const reminders = readJson('reminders.json', []);
    const reminder = reminders.find(item => item.id === parts[2]);
    if (!reminder) return json(res, 404, { error: 'Reminder not found' });
    reminder.acknowledged = true;
    reminder.acknowledged_at = nowIso();
    writeJson('reminders.json', reminders);
    return json(res, 200, reminder);
  }

  if (resource === 'status' && req.method === 'GET') {
    return json(res, 200, { ok: true, server_time: nowIso(), data_files: ['routines.json', 'events.json', 'family.json'] });
  }

  return json(res, 404, { error: 'API route not found' });
}

function serveStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === '/') requested = '/index.html';
  if (requested === '/dashboard' || requested === '/dashboard/') requested = '/dashboard/index.html';
  const file = path.resolve(ROOT, `.${requested}`);
  if (!(file === ROOT || file.startsWith(`${ROOT}${path.sep}`)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return text(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (error) {
    console.error('[api]', error);
    return json(res, 400, { error: error.message || 'Request failed' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Medication gesture server running at http://localhost:${PORT}`);
  console.log('Dashboard: /dashboard/');
  console.log('WhatsApp alerts stay disabled until server credentials and approved templates are configured.');
});

setInterval(checkSchedule, 60 * 1000);
checkSchedule();
