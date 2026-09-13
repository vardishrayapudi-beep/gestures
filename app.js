const $ = id => document.getElementById(id);
const weekdayLabels = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const state = { routines: [], events: [], family: null, date: localDate(), editingId: null };

function localDate(date = new Date()) {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function api(path, options) {
  const response = await fetch(`/api/${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

function notice(message, error = false) { $('notice').textContent = message || ''; $('notice').className = `notice${error ? ' error' : ''}`; }
function typeIcon(type) { return type === 'medicine' ? '💊' : type === 'walk' ? '🚶' : '🧘'; }
function prettyTime(time) { const [hours, minutes] = time.split(':').map(Number); const suffix = hours >= 12 ? 'PM' : 'AM'; return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`; }
function prettyStamp(timestamp) { return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function latestEvent(routineId, date = state.date) { return state.events.filter(event => event.routine_id === routineId && localDate(new Date(event.timestamp)) === date).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]; }
function statusText(event) { if (!event) return ['pending', 'Not verified']; if (event.status === 'verified') return ['verified', `Verified · ${prettyStamp(event.timestamp)}`]; if (event.status === 'missed') return ['missed', 'Missed']; if (event.status === 'failed') return ['failed', 'Failed']; return ['uncertain', 'Needs attention']; }

async function loadBase() {
  try { [state.routines, state.family] = await Promise.all([api('routines'), api('family')]); await loadDate(state.date); renderAll(); notice(''); }
  catch (error) { notice(`Dashboard backend is not available yet: ${error.message}`, true); }
}

async function loadDate(date) { state.date = date; state.events = await api(`events?date=${encodeURIComponent(date)}`); }

function renderToday() {
  $('todayHeading').textContent = `${state.family?.elder_name || 'Elder'} · ${new Date(`${state.date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`;
  const list = $('todayList');
  if (!state.routines.length) { list.innerHTML = '<div class="empty">No routines have been added yet.</div>'; return; }
  list.innerHTML = state.routines.filter(item => item.active).sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)).map(routine => { const [kind, label] = statusText(latestEvent(routine.id)); return `<article class="routine-card"><div class="routine-icon">${typeIcon(routine.type)}</div><div><div class="routine-name">${escapeHtml(routine.label)}</div><div class="routine-meta">${prettyTime(routine.scheduled_time)} · ${routine.grace_period_minutes} minute grace period</div></div><div class="status ${kind}">${label}</div></article>`; }).join('');
}

function renderHistory() {
  $('historyDate').value = state.date;
  const list = $('historyList');
  if (!state.events.length) { list.innerHTML = '<div class="empty">No event has been logged for this date.</div>'; return; }
  list.innerHTML = state.events.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map(event => { const routine = state.routines.find(item => item.id === event.routine_id); const [kind, label] = statusText(event); return `<article class="event-card"><div><strong>${typeIcon(routine?.type)} ${escapeHtml(routine?.label || event.routine_id)}</strong><p>${new Date(event.timestamp).toLocaleString()} · confidence ${Math.round((event.confidence || 0) * 100)}%</p></div><div class="status ${kind}">${label}</div></article>`; }).join('');
}

function routineForm(routine = null) {
  const days = routine?.days_of_week || weekdayLabels.map(item => item[0]);
  return `<form class="routine-form" data-routine-form ${routine ? `data-id="${escapeHtml(routine.id)}"` : ''}><div class="form-row"><label class="field">Label<input name="label" required value="${escapeHtml(routine?.label || '')}" placeholder="Morning medicine"></label><label class="field">Type<select name="type"><option value="medicine" ${routine?.type === 'medicine' ? 'selected' : ''}>Medicine</option><option value="exercise" ${routine?.type === 'exercise' ? 'selected' : ''}>Exercise</option><option value="walk" ${routine?.type === 'walk' ? 'selected' : ''}>Walk</option></select></label></div><div class="form-row"><label class="field">Scheduled time<input name="scheduled_time" type="time" required value="${routine?.scheduled_time || '08:00'}"></label><label class="field">Grace period (minutes)<input name="grace_period_minutes" type="number" min="0" value="${routine?.grace_period_minutes ?? 30}"></label></div><div class="field">Active days<div class="days">${weekdayLabels.map(([value, label]) => `<label class="day-chip"><input type="checkbox" name="days_of_week" value="${value}" ${days.includes(value) ? 'checked' : ''}>${label}</label>`).join('')}</div></div><div class="form-actions"><button type="button" class="secondary cancel-routine">Cancel</button><button class="primary">${routine ? 'Save changes' : 'Add routine'}</button></div></form>`;
}

function renderRoutines() {
  const editor = $('routineEditor');
  const forms = state.editingId === 'new' ? routineForm() : state.editingId ? routineForm(state.routines.find(item => item.id === state.editingId)) : '';
  editor.innerHTML = forms + state.routines.map(routine => `<article class="routine-card"><div class="routine-icon">${typeIcon(routine.type)}</div><div><div class="routine-name">${escapeHtml(routine.label)}</div><div class="routine-meta">${prettyTime(routine.scheduled_time)} · ${routine.active ? routine.days_of_week.join(', ') : 'inactive'}</div></div><div class="form-actions"><button class="secondary edit-routine" data-id="${escapeHtml(routine.id)}">Edit</button><button class="danger delete-routine" data-id="${escapeHtml(routine.id)}">Remove</button></div></article>`).join('') || '<div class="empty">Add the first routine.</div>';
  editor.querySelector('[data-routine-form]')?.addEventListener('submit', saveRoutine);
  editor.querySelector('.cancel-routine')?.addEventListener('click', () => { state.editingId = null; renderRoutines(); });
  editor.querySelectorAll('.edit-routine').forEach(button => button.addEventListener('click', () => { state.editingId = button.dataset.id; renderRoutines(); }));
  editor.querySelectorAll('.delete-routine').forEach(button => button.addEventListener('click', () => deleteRoutine(button.dataset.id)));
}

function renderSettings() {
  const contacts = state.family?.contacts || [];
  $('settingsPanel').innerHTML = contacts.length ? contacts.map(contact => { const current = Array.isArray(contact.notify_on) ? (contact.notify_on.includes('all') ? 'all' : contact.notify_on.includes('uncertain') ? 'missed_uncertain' : contact.notify_on.includes('missed') ? 'missed' : 'never') : 'never'; return `<article class="settings-card" data-contact="${escapeHtml(contact.id)}"><h3>${escapeHtml(contact.name)}</h3><div class="form-row"><label class="field">Notify on<select name="notify"><option value="never" ${current === 'never' ? 'selected' : ''}>Never</option><option value="missed" ${current === 'missed' ? 'selected' : ''}>Missed only</option><option value="missed_uncertain" ${current === 'missed_uncertain' ? 'selected' : ''}>Missed + uncertain</option><option value="all" ${current === 'all' ? 'selected' : ''}>All events</option></select></label><label class="field">Daily summary time<input name="summaryTime" type="time" value="${contact.daily_summary_time || '20:00'}"></label></div><label class="field"><span><input name="summary" type="checkbox" ${contact.daily_summary ? 'checked' : ''}> Send daily summary</span></label><div class="settings-actions"><button class="primary save-settings">Save preferences</button></div></article>`; }).join('') : '<div class="empty">No family contacts have been configured.</div>';
  $('settingsPanel').querySelectorAll('.save-settings').forEach(button => button.addEventListener('click', saveSettings));
}

async function saveRoutine(event) { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form).entries()); data.days_of_week = [...form.querySelectorAll('[name="days_of_week"]:checked')].map(input => input.value); data.grace_period_minutes = Number(data.grace_period_minutes); try { if (form.dataset.id) await api(`routines/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(data) }); else await api('routines', { method: 'POST', body: JSON.stringify(data) }); state.routines = await api('routines'); state.editingId = null; renderRoutines(); renderToday(); notice('Routine saved.'); } catch (error) { notice(error.message, true); } }
async function deleteRoutine(id) { if (!confirm('Remove this routine?')) return; try { await api(`routines/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.routines = await api('routines'); renderRoutines(); renderToday(); notice('Routine removed.'); } catch (error) { notice(error.message, true); } }
async function saveSettings(event) { const card = event.currentTarget.closest('[data-contact]'); const select = card.querySelector('[name="notify"]').value; const notify_on = select === 'all' ? ['all'] : select === 'missed_uncertain' ? ['missed', 'uncertain'] : select === 'missed' ? ['missed'] : ['never']; try { await api(`family/${encodeURIComponent(card.dataset.contact)}/preferences`, { method: 'POST', body: JSON.stringify({ notify_on, daily_summary: card.querySelector('[name="summary"]').checked, daily_summary_time: card.querySelector('[name="summaryTime"]').value }) }); state.family = await api('family'); renderSettings(); notice('Preferences saved.'); } catch (error) { notice(error.message, true); } }

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function renderAll() { renderToday(); renderHistory(); renderRoutines(); renderSettings(); }
function showView(view) { document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view)); document.querySelectorAll('.view').forEach(section => section.classList.toggle('active-view', section.id === `${view}View`)); $('pageTitle').textContent = view[0].toUpperCase() + view.slice(1); }

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', async () => { showView(tab.dataset.view); if (tab.dataset.view === 'history') { await loadDate($('historyDate').value || state.date); renderHistory(); } }));
$('historyDate').addEventListener('change', async event => { try { await loadDate(event.target.value); renderHistory(); } catch (error) { notice(error.message, true); } });
$('refreshToday').addEventListener('click', async () => { try { await loadDate(state.date); renderAll(); notice('Updated just now.'); } catch (error) { notice(error.message, true); } });
$('newRoutine').addEventListener('click', () => { state.editingId = 'new'; showView('routines'); renderRoutines(); });
loadBase();
