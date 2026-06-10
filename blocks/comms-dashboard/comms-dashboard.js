/**
 * Comms Dashboard block — Adobe Spectrum 2
 *
 * Fetches live data from comms-data Cloudflare Worker, renders all
 * communication sources across 4 tabs with 60s polling.
 *
 * Block authoring: single table cell containing the Worker URL.
 * Worker URL default: https://comms-data.compass-xsc.workers.dev
 */

const POLL_INTERVAL = 60_000;
const TASKS_KEY = 'cd-tasks';

// ── Spectrum helpers ──────────────────────────────────────

function el(tag, cls, html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Map source/tag names to Spectrum semantic badge variants */
function badgeVariant(tag) {
  const t = (tag || '').toLowerCase();
  if (/soccer|teams|collab|1:1/i.test(t)) return 'info';
  if (/football|urgent|negative|demo/i.test(t)) return 'notice';
  if (/partnership|positive|family|kyra|jayleen/i.test(t)) return 'positive';
  if (/analytics|business|adobe|recording/i.test(t)) return 'neutral';
  if (/event|amber/i.test(t)) return 'notice';
  if (/banking|gray/i.test(t)) return 'neutral';
  if (/purple/i.test(t)) return 'purple';
  return 'info';
}

function badge(text, variant) {
  const v = variant || badgeVariant(text);
  return `<span class="cd-badge cd-badge-${v}">${text}</span>`;
}

function personChip(initials, name) {
  return `<span class="cd-person-chip"><span class="cd-av">${initials}</span>${name}</span>`;
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relativeDate(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Task storage (localStorage) ───────────────────────────

const SEED_TASKS = [
  { id: 't-1', text: 'Submit banking documents', tag: 'banking', done: false, createdAt: '2026-06-10' },
  { id: 't-2', text: 'Seattle → Amazon meeting (Tuesday)', tag: 'travel', done: false, createdAt: '2026-06-10' },
  { id: 't-3', text: 'Toronto → Agentic Roadshow (Wednesday) — book tickets', tag: 'travel', done: false, createdAt: '2026-06-10' },
  { id: 't-4', text: 'Drop off Zyra checks', tag: 'zyra', done: false, createdAt: '2026-06-10' },
];

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  saveTasks(SEED_TASKS);
  return [...SEED_TASKS];
}

function saveTasks(tasks) {
  try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); } catch { /* ignore */ }
}

function renderTaskList(taskListEl) {
  const tasks = loadTasks();
  taskListEl.innerHTML = tasks.length
    ? tasks.map((t) => `
        <div class="cd-task-item${t.done ? ' cd-task-done' : ''}" data-id="${esc(t.id)}" role="listitem">
          <input type="checkbox" class="cd-task-check"${t.done ? ' checked' : ''} aria-label="Mark done"/>
          <span class="cd-task-text">${esc(t.text)}</span>
          ${badge(t.tag, badgeVariant(t.tag))}
        </div>`).join('')
    : '<p class="cd-muted" style="font-size:12px;padding:8px 0">No tasks yet — add one above.</p>';

  taskListEl.querySelectorAll('.cd-task-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const { id } = cb.closest('[data-id]').dataset;
      saveTasks(loadTasks().map((t) => (t.id === id ? { ...t, done: cb.checked } : t)));
      renderTaskList(taskListEl);
    });
  });
}

// ── Data fetch ────────────────────────────────────────────

async function fetchData(workerUrl) {
  try {
    const res = await fetch(`${workerUrl}/data`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[comms-dashboard] fetch failed:', err.message);
    return null;
  }
}

// ── Work tab: Slack ───────────────────────────────────────

function renderSlack(d) {
  const sd = d?.slack?.data;
  if (!sd) {
    return `
      <div class="cd-card-head">
        <div><div class="cd-card-heading">Slack</div>
        <div class="cd-card-subheading">Adobe Enterprise Workspace · not yet connected</div></div>
      </div>
      <div class="cd-empty-state">
        <div class="cd-empty-title">Awaiting n8n connection</div>
        n8n Slack node → transform → POST /data/slack
      </div>`;
  }

  const unread = sd.unreadCount
    ? badge(sd.unreadCount, 'neutral')
    : '';
  const upd = d.slack?.updatedAt
    ? `<span class="cd-last-updated">${relativeDate(d.slack.updatedAt)}</span>`
    : '';

  const channels = (sd.pinnedChannels || []).map((ch) => {
    if (!ch.lastMessage) {
      return `<tr><td class="cd-bold">#${ch.name}</td><td><span class="cd-muted">—</span></td></tr>`;
    }
    const short = ch.lastMessage.length > 80 ? ch.lastMessage.slice(0, 80) : ch.lastMessage;
    const hasMore = ch.lastMessage.length > 80;
    return `<tr>
      <td class="cd-bold cd-channel-name">#${ch.name}</td>
      <td>${hasMore
        ? `<details><summary class="cd-muted">"${short}…" — ${ch.lastMessageDate || ''}</summary><span class="cd-muted">"${ch.lastMessage}" — ${ch.lastMessageDate || ''}</span></details>`
        : `<span class="cd-muted">"${short}" — ${ch.lastMessageDate || ''}</span>`
      }</td>
    </tr>`;
  }).join('');

  const slackBase = 'https://adobe.slack.com/team/';
  const slackPeople = { 'Bill Lofft': 'blofft', 'Bridget Portela': 'bportela', 'Emily Jansen': 'estange', 'Jake Monsen': 'monsen', 'Jeff Figueiredo': 'jfigueir' };
  const people = (sd.priorityPeople || []).map((p) => {
    const handle = slackPeople[p.name];
    const chip = `<span class="cd-av">${p.initials}</span>${p.name}`;
    return handle
      ? `<a href="${slackBase}${handle}" target="_blank" rel="noopener noreferrer" class="cd-person-chip cd-person-chip-link">${chip}</a>`
      : `<span class="cd-person-chip">${chip}</span>`;
  }).join('');

  const mentions = (sd.mentions || []).map((m) => `
    <tr>
      <td class="cd-col-date">${m.date}</td>
      <td class="cd-bold">${m.from}</td>
      <td class="cd-muted cd-mention-msg">${m.message || m.channel || ''}</td>
    </tr>`).join('');

  return `
    <div class="cd-card-head">
      <div><div class="cd-card-heading">Slack ${unread} ${upd}</div>
      <div class="cd-card-subheading">Adobe Enterprise Workspace</div></div>
    </div>
    <span class="cd-section-label">Pinned Channels</span>
    <table class="cd-ctable">
      <thead><tr><th>Channel</th><th>Last Message</th></tr></thead>
      <tbody>${channels || '<tr><td colspan="2" class="cd-muted">No pinned channels</td></tr>'}</tbody>
    </table>
    <span class="cd-section-label">Priority People</span>
    <div class="cd-people-wrap">${people || '<span class="cd-muted">No people configured</span>'}</div>
    <span class="cd-section-label">Direct @mentions</span>
    <table class="cd-ctable">
      <thead><tr><th>Date</th><th>From</th><th>Message</th></tr></thead>
      <tbody>${mentions || '<tr><td colspan="3" class="cd-muted">No recent mentions</td></tr>'}</tbody>
    </table>
    <div class="cd-action-row">
      <button class="cd-btn cd-btn-sm" data-refresh="slack">Refresh Slack</button>
    </div>`;
}

// ── Work tab: Teams ───────────────────────────────────────

function renderTeams(d) {
  const td = d?.teams?.data;
  if (!td) {
    return `
      <div class="cd-card-head">
        <div><div class="cd-card-heading">Teams</div>
        <div class="cd-card-subheading">Microsoft Teams · not yet connected</div></div>
      </div>
      <div class="cd-empty-state">
        <div class="cd-empty-title">Set up Power Automate</div>
        Power Automate (Teams connector) → POST /data/teams
      </div>`;
  }

  const upd = d.teams?.updatedAt
    ? `<span class="cd-last-updated">${relativeDate(d.teams.updatedAt)}</span>`
    : '';

  const meetings = (td.watchedMeetings || []).map((m) => `
    <tr>
      <td class="cd-bold">${m.name}</td>
      <td>${m.organizer || ''}</td>
      <td class="cd-col-cadence">${m.cadence || ''}</td>
      <td class="cd-col-action">
        <button class="cd-btn cd-btn-sm" data-recordings="${m.name}">Recordings</button>
      </td>
    </tr>`).join('');

  const teams = (td.watchedTeams || []).map((t) => `
    <tr>
      <td class="cd-bold">${t.name}</td>
      <td class="cd-col-date">${t.lastActive || '—'}</td>
    </tr>`).join('');

  return `
    <div class="cd-card-head">
      <div><div class="cd-card-heading">Teams ${upd}</div>
      <div class="cd-card-subheading">Microsoft Teams</div></div>
    </div>
    <span class="cd-section-label">Watched Meetings</span>
    <table class="cd-ctable">
      <thead><tr><th>Meeting</th><th>Organizer</th><th class="cd-col-cadence">Cadence</th><th class="cd-col-action"></th></tr></thead>
      <tbody>${meetings || '<tr><td colspan="4" class="cd-muted">No meetings configured</td></tr>'}</tbody>
    </table>
    <span class="cd-section-label">Watched Teams</span>
    <table class="cd-ctable">
      <thead><tr><th>Team</th><th class="cd-col-date">Last Active</th></tr></thead>
      <tbody>${teams || '<tr><td colspan="2" class="cd-muted">No teams configured</td></tr>'}</tbody>
    </table>
    <div class="cd-action-row">
      <button class="cd-btn cd-btn-sm" data-refresh="teams">Refresh Teams</button>
    </div>`;
}

// ── Work tab: Outlook ─────────────────────────────────────

function renderOutlook(d) {
  const od = d?.outlook?.data;
  if (!od) {
    return `
      <div class="cd-card-head">
        <div><div class="cd-card-heading">Outlook</div>
        <div class="cd-card-subheading">remekie@adobe.com · not yet connected</div></div>
        <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/mail" target="_blank">Open Outlook</a>
      </div>
      <div class="cd-empty-state">
        <div class="cd-empty-title">Set up Power Automate</div>
        See docs/power-automate-setup.md
      </div>`;
  }

  const unread = od.unreadCount ?? 0;
  const upd = d.outlook?.updatedAt
    ? `<span class="cd-last-updated">${relativeDate(d.outlook.updatedAt)}</span>`
    : '';

  const emails = (od.emails || od.people || []).slice(0, 8).map((e) => `
    <tr>
      <td class="cd-bold">${e.subject}</td>
      <td class="cd-muted cd-col-narrow">${e.from || ''}</td>
      <td class="cd-col-date">${e.date || ''}</td>
    </tr>`).join('');

  const flagged = od.flagged || [];
  const flaggedContent = flagged.length
    ? flagged.map((f) => `<div class="cd-bold cd-flagged-item">${f.subject}</div>`).join('')
    : `<span class="cd-muted">No flagged emails</span>`;

  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">
          Outlook
          ${badge(`${unread.toLocaleString()} unread`, unread > 100 ? 'negative' : 'neutral')}
          ${upd}
        </div>
        <div class="cd-card-subheading">remekie@adobe.com</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/mail" target="_blank" rel="noopener noreferrer">Open Outlook</a>
    </div>
    <div class="cd-grid-2 cd-mt-16 cd-outlook-swimlanes">
      <div>
        <span class="cd-section-label cd-mt-0">Recent Emails</span>
        <table class="cd-ctable">
          <thead><tr><th>Subject</th><th class="cd-col-narrow">From</th><th class="cd-col-date">Date</th></tr></thead>
          <tbody>${emails || '<tr><td colspan="3" class="cd-muted">No emails</td></tr>'}</tbody>
        </table>
      </div>
      <div>
        <span class="cd-section-label cd-mt-0">To-Do / Flagged</span>
        ${flaggedContent}
      </div>
    </div>
    <div class="cd-filter-note">Filters active — hiding LinkedIn alerts, Concur, Uber receipts, automated senders</div>`;
}

// ── Meetings tab ──────────────────────────────────────────

function renderMeetings(d) {
  const cal = d?.outlook?.data?.calendar || d?.gcalendar?.data;
  if (!cal?.events?.length) {
    return `
      <div class="cd-card-head">
        <div><div class="cd-card-heading">This Week</div>
        <div class="cd-card-subheading">Awaiting calendar data from Power Automate</div></div>
        <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/calendar" target="_blank">Open Calendar</a>
      </div>
      <div class="cd-empty-state">
        <div class="cd-empty-title">Calendar not yet connected</div>
        Power Automate → Outlook Calendar → POST /data/gcalendar
      </div>`;
  }

  let lastDay = '';
  const rows = cal.events.map((ev) => {
    let dayRow = '';
    if (ev.day !== lastDay) {
      lastDay = ev.day;
      const todayChip = ev.isToday ? `<span class="cd-badge cd-badge-today">Today</span>` : '';
      dayRow = `<tr class="cd-day-header"><td colspan="4">${ev.day} ${todayChip}</td></tr>`;
    }
    const tagHtml = ev.tag ? badge(ev.tag, badgeVariant(ev.tag)) : '';
    return `${dayRow}<tr>
      <td class="cd-col-time">${ev.time || '—'}</td>
      <td class="cd-bold">${ev.title}</td>
      <td>${ev.organizer || ''}</td>
      <td class="cd-col-tag">${tagHtml}</td>
    </tr>`;
  }).join('');

  return `
    <div class="cd-card-head">
      <div><div class="cd-card-heading">This Week</div>
      <div class="cd-card-subheading">${cal.weekLabel || 'This week'} · All times MDT · Edmonton</div></div>
      <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/calendar" target="_blank">Open Calendar</a>
    </div>
    <table class="cd-ctable cd-mt-16">
      <thead><tr><th class="cd-col-time">Time</th><th>Event</th><th class="cd-col-narrow">Organizer</th><th class="cd-col-tag"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Personal tab: Gmail ───────────────────────────────────

function renderGmail(d) {
  const gd = d?.gmail?.data;
  const unread = gd?.unreadCount ?? '—';
  const upd = d?.gmail?.updatedAt
    ? `<span class="cd-last-updated">${relativeDate(d.gmail.updatedAt)}</span>`
    : '';

  const rows = gd ? (gd.filtered || []).slice(0, 8).map((m) => `
    <tr>
      <td class="cd-bold">${m.from}</td>
      <td>${m.subject}</td>
      <td class="cd-col-date">${m.date ? `${m.date}${m.time ? ` · ${m.time}` : ''}` : ''}</td>
      <td class="cd-col-tag">${badge(m.tag, badgeVariant(m.tag))}</td>
    </tr>`).join('') : null;

  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">
          Gmail
          <span class="cd-unread-pill">${unread} unread</span>
          ${upd}
        </div>
        <div class="cd-card-subheading">courtney.remekie@gmail.com</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://mail.google.com" target="_blank">Open Gmail</a>
    </div>
    <div class="cd-filter-pill">Family filter: Theo · Soccer · Football · Jayleen · Kyra</div>
    ${rows
      ? `<table class="cd-ctable cd-mt-16">
          <thead><tr><th>From</th><th>Subject</th><th class="cd-col-date">Date</th><th class="cd-col-tag">Tag</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : '<div class="cd-empty-state"><div class="cd-empty-title">Gmail not connected</div>n8n Gmail OAuth2 node → POST /data/gmail</div>'}`;
}

// ── Personal tab: Zyra ────────────────────────────────────

function renderZyra(d) {
  const zd = d?.zyra?.data;
  const unread = zd?.unreadCount ?? '—';
  const upd = d?.zyra?.updatedAt
    ? `<span class="cd-last-updated">${relativeDate(d.zyra.updatedAt)}</span>`
    : '';

  const rows = zd ? (zd.filtered || []).slice(0, 8).map((m) => `
    <tr>
      <td class="cd-bold">${m.from}</td>
      <td>${m.subject}</td>
      <td class="cd-col-tag">${badge(m.tag, badgeVariant(m.tag))}</td>
    </tr>`).join('') : null;

  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">
          Zyra Spirits
          ${zd ? `<span class="cd-unread-pill">${unread} unread</span>` : ''}
          ${upd}
        </div>
        <div class="cd-card-subheading">courtney@drinkzyra.com</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://webmail.dreamhost.com" target="_blank">Open Zyra Mail</a>
    </div>
    <div class="cd-filter-pill">Business filter: hiding Uline catalogs + routine DHL charges</div>
    ${rows
      ? `<table class="cd-ctable cd-mt-16">
          <thead><tr><th>From</th><th>Subject</th><th class="cd-col-tag">Tag</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : '<div class="cd-empty-state"><div class="cd-empty-title">Zyra IMAP not connected</div>n8n IMAP node (courtney@drinkzyra.com) → POST /data/zyra</div>'}`;
}

// ── Personal tab: Messages + WhatsApp ────────────────────

function renderMessages(d) {
  const md = d?.messages?.data;
  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">
          Google Messages
          ${md ? badge(`${md.unreadCount ?? 0}`, 'neutral') : ''}
        </div>
        <div class="cd-card-subheading">RCS/SMS · S25</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://messages.google.com/web/conversations" target="_blank">Open Messages</a>
    </div>
    ${md ? `<table class="cd-ctable cd-mt-16">
      <thead><tr><th>From</th><th>Message</th><th class="cd-col-date">Time</th></tr></thead>
      <tbody>${(md.threads || []).slice(0, 6).map((t) => `
        <tr><td class="cd-bold">${t.from}</td><td>${t.preview || ''}</td><td class="cd-col-date">${t.time || ''}</td></tr>`).join('')}
      </tbody></table>`
    : `<div class="cd-empty-state">
        <div class="cd-empty-title">Google Messages not connected</div>
        Requires browser extension bridge → POST /data/messages
       </div>`}`;
}

function renderWhatsApp(d) {
  const wd = d?.whatsapp?.data;
  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">
          WhatsApp
          ${wd ? badge(`${wd.unreadCount ?? 0}`, 'neutral') : ''}
        </div>
        <div class="cd-card-subheading">web.whatsapp.com · S25 linked</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://web.whatsapp.com" target="_blank">Open WhatsApp</a>
    </div>
    ${wd ? `<table class="cd-ctable cd-mt-16">
      <thead><tr><th>Contact / Group</th><th>Last Message</th><th class="cd-col-date">Time</th></tr></thead>
      <tbody>${(wd.threads || []).slice(0, 6).map((t) => `
        <tr><td class="cd-bold">${t.from}</td><td>${t.preview || ''}</td><td class="cd-col-date">${t.time || ''}</td></tr>`).join('')}
      </tbody></table>`
    : `<div class="cd-empty-state">
        <div class="cd-empty-title">WhatsApp not connected</div>
        Requires browser extension bridge → POST /data/whatsapp
       </div>`}
    <div class="cd-card-footer">
      To mute TH.I.N.K YeG — open group in WhatsApp → group name → Mute notifications → Always
    </div>`;
}

// ── Personal tab: Family Calendar ────────────────────────

function renderFamilyCalendar(d) {
  const cal = d?.calendar?.data || d?.gcalendar?.data;
  const personalEvents = cal ? (cal.events || []).filter((e) => e.isPersonal) : null;

  if (!personalEvents?.length) {
    return `
      <div class="cd-card-head">
        <div><div class="cd-card-heading">Family Calendar</div>
        <div class="cd-card-subheading">${cal?.weekLabel || 'This week'} · All times MDT</div></div>
        <a class="cd-btn cd-btn-sm" href="https://calendar.google.com" target="_blank">Open Calendar</a>
      </div>
      <div class="cd-empty-state">
        <div class="cd-empty-title">Google Calendar not connected</div>
        n8n Google Calendar node → POST /data/calendar
      </div>`;
  }

  let lastDay = '';
  const rows = personalEvents.map((ev) => {
    let dayCell = '';
    if (ev.day !== lastDay) {
      lastDay = ev.day;
      dayCell = `<td class="cd-bold">${ev.day}${ev.isToday ? ` <span class="cd-badge cd-badge-today">Today</span>` : ''}</td>`;
    } else {
      dayCell = '<td></td>';
    }
    return `<tr>
      ${dayCell}
      <td class="cd-col-time">${ev.time}</td>
      <td>${ev.title}</td>
      <td class="cd-muted">${ev.location || ''}</td>
      <td class="cd-col-tag">${ev.tag ? badge(ev.tag, badgeVariant(ev.tag)) : ''}</td>
    </tr>`;
  }).join('');

  return `
    <div class="cd-card-head">
      <div><div class="cd-card-heading">Family Calendar</div>
      <div class="cd-card-subheading">${cal.weekLabel || 'This week'} · All times MDT · Edmonton</div></div>
      <a class="cd-btn cd-btn-sm" href="https://calendar.google.com" target="_blank">Open Calendar</a>
    </div>
    <table class="cd-ctable cd-mt-16">
      <thead><tr><th>Day</th><th class="cd-col-time">Time</th><th>Event</th><th>Location</th><th class="cd-col-tag">Tag</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Workspace tab ─────────────────────────────────────────

function renderWorkspace(d) {
  const recordings = d?.teams?.data?.recordings || [];
  const recRows = recordings.map((r) => `
    <tr>
      <td class="cd-bold">${r.name}</td>
      <td>${r.organizer || ''}</td>
      <td class="cd-col-date">${r.date || ''}</td>
      <td class="cd-col-tag">${badge('Teams', 'info')}</td>
    </tr>`).join('');

  return `
    <div class="cd-workspace-grid">
      <div class="cd-card cd-workspace-tasks">
        <div class="cd-card-head">
          <div>
            <div class="cd-card-heading">Tasks</div>
            <div class="cd-card-subheading">Voice or type to add · tagged · proactive reminders</div>
          </div>
        </div>
        <div class="cd-task-input-row">
          <input type="text" class="cd-task-input" placeholder="Add a task…" aria-label="New task"/>
          <select class="cd-task-tag-select" aria-label="Tag">
            <option value="work">Work</option>
            <option value="zyra">Zyra</option>
            <option value="banking">Banking</option>
            <option value="travel">Travel</option>
            <option value="family">Family</option>
            <option value="personal">Personal</option>
          </select>
          <button class="cd-task-mic cd-assistant-mic" aria-label="Voice task input">🎙</button>
          <button class="cd-task-add cd-btn cd-btn-primary cd-btn-sm">Add</button>
        </div>
        <div class="cd-task-list" role="list"></div>
      </div>
      <div class="cd-card cd-workspace-chat-card">
        <div class="cd-workspace-chat-container"></div>
      </div>
    </div>
    <div class="cd-mt-16">
      <div class="cd-card">
        <div class="cd-card-head">
          <div><div class="cd-card-heading">Team Recordings</div>
          <div class="cd-card-subheading">Microsoft Teams</div></div>
          <button class="cd-btn cd-btn-primary cd-btn-sm" data-refresh="recordings">Fetch Recordings</button>
        </div>
        ${recRows
          ? `<table class="cd-ctable cd-mt-16">
              <thead><tr><th>Recording</th><th>Organizer</th><th class="cd-col-date">Date</th><th class="cd-col-tag">Source</th></tr></thead>
              <tbody>${recRows}</tbody>
            </table>`
          : '<p class="cd-muted" style="font-size:12px;margin:8px 0 0">Recordings sync via Power Automate after each watched meeting ends.</p>'}
      </div>
      <div class="cd-card cd-mt-24">
        <div class="cd-card-head">
          <div><div class="cd-card-heading">SharePoint</div>
          <div class="cd-card-subheading">adobe.sharepoint.com</div></div>
          <a class="cd-btn cd-btn-sm" href="https://adobe.sharepoint.com" target="_blank" rel="noopener noreferrer">Open SharePoint</a>
        </div>
        <p class="cd-muted" style="font-size:12px;margin:8px 0 0">Access shared documents and team sites.</p>
      </div>
    </div>`;
}

// ── Assistant panel ───────────────────────────────────────

function buildAssistant(data, workerUrl, sharedHistory) {
  const panel = el('div', 'cd-assistant-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', "Court's Co-worker");
  panel.innerHTML = `
    <div class="cd-assistant-header">
      <svg viewBox="0 0 133.46 118.11" width="18" height="16" aria-hidden="true" focusable="false">
        <polygon fill="#fa0f00" points="84.13 0 133.46 0 133.46 118.11 84.13 0"/>
        <polygon fill="#fa0f00" points="49.37 0 0 0 0 118.11 49.37 0"/>
        <polygon fill="#fa0f00" points="66.75 43.53 98.18 118.11 77.58 118.11 68.18 94.36 45.18 94.36 66.75 43.53"/>
      </svg>
      <div style="flex:1">
        <div class="cd-assistant-title">Court's Co-worker</div>
        <div class="cd-assistant-subtitle">Powered by Claude · knows your context</div>
      </div>
      <button class="cd-assistant-close" aria-label="Close assistant">×</button>
    </div>
    <div class="cd-assistant-messages" role="log" aria-live="polite">
      <div class="cd-msg-assistant cd-msg-suggestions">
        <strong>Hi Courtney! Connected to Slack, Teams, Outlook, Gmail, Zyra, and your calendars. Try:</strong>
        · "What's my day Monday?" · "Any urgent Zyra emails?" · "Theo's games this week?" · "Book with Jake Tuesday 2pm"
      </div>
    </div>
    <div class="cd-assistant-input-area">
      <input type="text" class="cd-assistant-input" placeholder="Ask anything about your day…" aria-label="Ask your assistant"/>
      <button class="cd-assistant-mic" aria-label="Voice input">🎙</button>
      <button class="cd-assistant-send" aria-label="Send message">Send</button>
    </div>`;

  panel.querySelector('.cd-assistant-close').addEventListener('click', () => { panel.classList.remove('is-open'); });

  const messages = panel.querySelector('.cd-assistant-messages');
  const input = panel.querySelector('.cd-assistant-input');
  const sendBtn = panel.querySelector('.cd-assistant-send');
  const micBtn = panel.querySelector('.cd-assistant-mic');
  function addMsg(text, role) {
    const d = el('div', role === 'user' ? 'cd-msg-user' : 'cd-msg-assistant');
    d.style.whiteSpace = 'pre-wrap';
    d.textContent = text;
    messages.appendChild(d);
    messages.scrollTop = messages.scrollHeight;
    return d;
  }

  async function reply(text) {
    const typing = addMsg('Thinking…', 'assistant');
    typing.classList.add('cd-msg-typing');
    try {
      const res = await fetch(`${workerUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: sharedHistory, tasks: loadTasks().filter((t) => !t.done) }),
      });
      const { reply: replyText, error } = await res.json();
      typing.remove();
      const replyMsg = addMsg(replyText || error || 'Something went wrong.', 'assistant');
      if (replyText) {
        sharedHistory.push({ role: 'user', content: text }, { role: 'assistant', content: replyText });
      }
      return replyMsg;
    } catch {
      typing.remove();
      addMsg('Could not reach assistant — check worker status.', 'assistant');
    }
    return null;
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    addMsg(text, 'user');
    input.value = '';
    reply(text);
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // Voice input
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.hidden = true;
  } else {
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    micBtn.addEventListener('click', () => {
      micBtn.classList.add('cd-mic-active');
      recognition.start();
    });
    recognition.onresult = (e) => {
      input.value = e.results[0][0].transcript;
      micBtn.classList.remove('cd-mic-active');
      send();
    };
    recognition.onerror = () => micBtn.classList.remove('cd-mic-active');
    recognition.onend = () => micBtn.classList.remove('cd-mic-active');
  }

  return panel;
}

// ── Workspace embedded chat ───────────────────────────────

function buildWorkspaceChat(workerUrl, sharedHistory, wsRef) {
  const container = el('div', 'cd-workspace-chat-inner');
  container.innerHTML = `
    <div class="cd-assistant-header">
      <svg viewBox="0 0 133.46 118.11" width="18" height="16" aria-hidden="true" focusable="false">
        <polygon fill="#fa0f00" points="84.13 0 133.46 0 133.46 118.11 84.13 0"/>
        <polygon fill="#fa0f00" points="49.37 0 0 0 0 118.11 49.37 0"/>
        <polygon fill="#fa0f00" points="66.75 43.53 98.18 118.11 77.58 118.11 68.18 94.36 45.18 94.36 66.75 43.53"/>
      </svg>
      <div style="flex:1">
        <div class="cd-assistant-title">Court's Co-worker</div>
        <div class="cd-assistant-subtitle">Powered by Claude · Workspace</div>
      </div>
    </div>
    <div class="cd-assistant-messages" role="log" aria-live="polite"></div>
    <div class="cd-assistant-input-area">
      <input type="text" class="cd-assistant-input" placeholder="Ask anything…" aria-label="Ask your assistant"/>
      <button class="cd-assistant-mic" aria-label="Voice input">🎙</button>
      <button class="cd-assistant-send" aria-label="Send message">Send</button>
    </div>`;

  const messages = container.querySelector('.cd-assistant-messages');
  const input = container.querySelector('.cd-assistant-input');
  const sendBtn = container.querySelector('.cd-assistant-send');
  const micBtn = container.querySelector('.cd-assistant-mic');

  function addMsg(text, role) {
    const d = el('div', role === 'user' ? 'cd-msg-user' : 'cd-msg-assistant');
    d.style.whiteSpace = 'pre-wrap';
    d.textContent = text;
    messages.appendChild(d);
    messages.scrollTop = messages.scrollHeight;
    return d;
  }

  // Re-render existing history on rebuild
  if (sharedHistory.length === 0) {
    const hint = el('div', 'cd-msg-assistant cd-msg-suggestions');
    hint.innerHTML = '<strong>Hi! Ask me anything or check your tasks.</strong> · "What needs attention?" · "Any Zyra emails this week?"';
    messages.appendChild(hint);
  } else {
    sharedHistory.forEach(({ role, content }) => addMsg(content, role));
    messages.scrollTop = messages.scrollHeight;
  }

  async function reply(text) {
    addMsg(text, 'user');
    const typing = addMsg('Thinking…', 'assistant');
    typing.classList.add('cd-msg-typing');
    try {
      const res = await fetch(`${workerUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: sharedHistory, tasks: loadTasks().filter((t) => !t.done) }),
      });
      const { reply: replyText, error } = await res.json();
      typing.remove();
      addMsg(replyText || error || 'Something went wrong.', 'assistant');
      if (replyText) {
        sharedHistory.push({ role: 'user', content: text }, { role: 'assistant', content: replyText });
      }
    } catch {
      typing.remove();
      addMsg('Could not reach assistant.', 'assistant');
    }
  }

  if (wsRef) wsRef.reply = reply;

  function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    reply(text);
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.hidden = true;
  } else {
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    micBtn.addEventListener('click', () => { micBtn.classList.add('cd-mic-active'); recognition.start(); });
    recognition.onresult = (e) => { input.value = e.results[0][0].transcript; micBtn.classList.remove('cd-mic-active'); send(); };
    recognition.onerror = () => micBtn.classList.remove('cd-mic-active');
    recognition.onend = () => micBtn.classList.remove('cd-mic-active');
  }

  return container;
}

// ── Wire workspace tab ────────────────────────────────────

function wireWorkspace(panel, workerUrl, sharedHistory, wsRef) {
  // Inject inline chat
  const chatContainer = panel.querySelector('.cd-workspace-chat-container');
  if (chatContainer) {
    chatContainer.innerHTML = '';
    chatContainer.appendChild(buildWorkspaceChat(workerUrl, sharedHistory, wsRef));
  }

  // Render task list
  const taskListEl = panel.querySelector('.cd-task-list');
  if (taskListEl) renderTaskList(taskListEl);

  // Wire task add
  const taskInput = panel.querySelector('.cd-task-input');
  const tagSel = panel.querySelector('.cd-task-tag-select');
  const addBtn = panel.querySelector('.cd-task-add');
  const taskMic = panel.querySelector('.cd-task-mic');

  if (addBtn && taskInput && tagSel && taskListEl) {
    const addTask = () => {
      const text = taskInput.value.trim();
      if (!text) return;
      const newTask = { id: `t-${Date.now()}`, text, tag: tagSel.value, done: false, createdAt: new Date().toISOString() };
      saveTasks([newTask, ...loadTasks()]);
      taskInput.value = '';
      renderTaskList(taskListEl);
    };
    addBtn.addEventListener('click', addTask);
    taskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });
  }

  // Voice for task input
  if (taskMic) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      taskMic.hidden = true;
    } else {
      const recog = new SpeechRecognition();
      recog.lang = 'en-US';
      taskMic.addEventListener('click', () => { taskMic.classList.add('cd-mic-active'); recog.start(); });
      recog.onresult = (e) => { taskInput.value = e.results[0][0].transcript; taskMic.classList.remove('cd-mic-active'); };
      recog.onerror = () => taskMic.classList.remove('cd-mic-active');
      recog.onend = () => taskMic.classList.remove('cd-mic-active');
    }
  }
}

// ── Render all tabs ───────────────────────────────────────

function renderAll(block, panels, data, renderCb) {
  const d = data || {};

  // Work
  panels.work.innerHTML = `
    <div class="cd-card">${renderOutlook(d)}</div>
    <div class="cd-card cd-mt-24">${renderSlack(d)}</div>
    <div class="cd-card cd-mt-24">${renderTeams(d)}</div>`;

  // Meetings
  panels.meetings.innerHTML = `<div class="cd-card">${renderMeetings(d)}</div>`;

  // Personal
  panels.personal.innerHTML = `
    <div class="cd-grid-2 cd-personal-grid">
      <div class="cd-card">${renderGmail(d)}</div>
      <div class="cd-card">${renderZyra(d)}</div>
      <div class="cd-card cd-full-width">${renderFamilyCalendar(d)}</div>
      <div class="cd-card">${renderMessages(d)}</div>
      <div class="cd-card">${renderWhatsApp(d)}</div>
    </div>`;

  // Workspace (HTML shell only — wireWorkspace wires tasks + chat)
  panels.workspace.innerHTML = renderWorkspace(d);

  // Unread total badge in topbar
  const outlookUnread = d.outlook?.data?.unreadCount ?? 0;
  const slackUnread = d.slack?.data?.unreadCount ?? 0;
  const gmailUnread = d.gmail?.data?.unreadCount ?? 0;
  const zyraUnread = d.zyra?.data?.unreadCount ?? 0;
  const total = outlookUnread + slackUnread + gmailUnread + zyraUnread;
  const badge$ = block.querySelector('.cd-unread-total');
  if (badge$ && total > 0) badge$.textContent = total.toLocaleString();

  // Refresh button handlers
  block.querySelectorAll('[data-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      fetchData(btn.closest('[data-worker-url]')?.dataset.workerUrl || '')
        .then((fresh) => { if (fresh && renderCb) renderCb(fresh); })
        .finally(() => { btn.disabled = false; btn.textContent = orig; });
    });
  });

  // Recordings nav shortcut → switches to Workspace tab
  block.querySelectorAll('[data-recordings]').forEach((btn) => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.cd-tab-btn').forEach((b) => b.classList.remove('active'));
      block.querySelectorAll('.cd-tab-panel').forEach((p) => p.classList.remove('active'));
      block.querySelector('#cd-tab-workspace')?.classList.add('active');
      panels.workspace.classList.add('active');
    });
  });
}

// ── Main decorator ────────────────────────────────────────

export default async function decorate(block) {
  const workerUrl = (block.querySelector('td, p')?.textContent || '').trim()
    || 'https://comms-data.compass-xsc.workers.dev';
  block.textContent = '';
  block.dataset.workerUrl = workerUrl;

  // Top bar
  const topbar = el('div', 'cd-topbar');
  topbar.innerHTML = `
    <svg viewBox="0 0 133.46 118.11" width="24" height="20" aria-label="Adobe" role="img">
      <polygon fill="#fa0f00" points="84.13 0 133.46 0 133.46 118.11 84.13 0"/>
      <polygon fill="#fa0f00" points="49.37 0 0 0 0 118.11 49.37 0"/>
      <polygon fill="#fa0f00" points="66.75 43.53 98.18 118.11 77.58 118.11 68.18 94.36 45.18 94.36 66.75 43.53"/>
    </svg>
    <div class="cd-topbar-sep" aria-hidden="true"></div>
    <div>
      <div class="cd-topbar-title">Comms Dashboard</div>
      <div class="cd-topbar-sub">
        Courtney Remekie · Adobe Solutions Consultant · MDT
        <span class="cd-live-indicator" aria-live="polite">
          <span class="cd-live-dot" aria-hidden="true"></span> Live · 60s
        </span>
      </div>
    </div>
    <div class="cd-topbar-right">
      <span class="cd-unread-pill cd-unread-total" aria-label="Total unread messages">—</span>
      <span class="cd-unread-label">unread across all inboxes</span>
    </div>`;
  block.appendChild(topbar);

  const sharedHistory = [];
  const wsRef = { reply: null };

  // Tab bar
  const TABS = [
    { id: 'work',      label: 'Work' },
    { id: 'meetings',  label: 'Meetings' },
    { id: 'personal',  label: 'Personal' },
    { id: 'workspace', label: 'Workspace' },
  ];
  const tabBar = el('div', 'cd-tab-bar');
  tabBar.setAttribute('role', 'tablist');
  TABS.forEach(({ id, label }, i) => {
    const btn = el('button', `cd-tab-btn${i === 0 ? ' active' : ''}`);
    btn.id = `cd-tab-${id}`;
    btn.textContent = label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.setAttribute('aria-controls', `cd-panel-${id}`);
    btn.addEventListener('click', () => {
      block.querySelectorAll('.cd-tab-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      block.querySelectorAll('.cd-tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      block.querySelector(`#cd-panel-${id}`)?.classList.add('active');

      // Hide FAB on Workspace, show on all other tabs
      block.classList.toggle('workspace-active', id === 'workspace');

      // Proactive reminder when entering Workspace
      if (id === 'workspace' && wsRef.reply) {
        const pending = loadTasks().filter((t) => !t.done);
        if (pending.length > 0) {
          wsRef.reply(`I just opened my Workspace. I have ${pending.length} pending task(s): ${pending.map((t) => `"${t.text}" [${t.tag}]`).join(', ')}. Any urgent ones to flag?`);
        }
      }
    });
    tabBar.appendChild(btn);
  });
  block.appendChild(tabBar);

  // Panels
  const panels = {};
  TABS.forEach(({ id }, i) => {
    const panel = el('div', `cd-tab-panel${i === 0 ? ' active' : ''}`);
    panel.id = `cd-panel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `cd-tab-${id}`);
    panel.innerHTML = '<div class="cd-loading">Loading…</div>';
    panels[id] = panel;
    block.appendChild(panel);
  });

  // Assistant FAB
  const fab = el('div', 'cd-assistant-fab');
  fab.innerHTML = `
    <button id="cd-assistant-toggle" aria-label="Open Court's Co-worker assistant" aria-haspopup="dialog">
      <svg viewBox="0 0 133.46 118.11" width="16" height="14" aria-hidden="true" focusable="false">
        <polygon fill="#fa0f00" points="84.13 0 133.46 0 133.46 118.11 84.13 0"/>
        <polygon fill="#fa0f00" points="49.37 0 0 0 0 118.11 49.37 0"/>
        <polygon fill="#fa0f00" points="66.75 43.53 98.18 118.11 77.58 118.11 68.18 94.36 45.18 94.36 66.75 43.53"/>
      </svg>
      Ask Court's Co-worker
    </button>`;
  block.appendChild(fab);

  // Initial load + render
  const data = await fetchData(workerUrl);

  function render(d) {
    renderAll(block, panels, d, render);
    wireWorkspace(panels.workspace, workerUrl, sharedHistory, wsRef);
  }

  render(data);

  // Build assistant FAB panel
  let assistantPanel = buildAssistant(data || {}, workerUrl, sharedHistory);
  block.appendChild(assistantPanel);

  const toggleAssistant = () => assistantPanel.classList.toggle('is-open');
  fab.querySelector('button').addEventListener('click', toggleAssistant);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') assistantPanel.classList.remove('is-open');
  });

  // Poll every 60s — preserve open state across rebuilds
  setInterval(async () => {
    const fresh = await fetchData(workerUrl);
    if (fresh) {
      const wasOpen = assistantPanel.classList.contains('is-open');
      render(fresh);
      assistantPanel.remove();
      assistantPanel = buildAssistant(fresh, workerUrl, sharedHistory);
      if (wasOpen) assistantPanel.classList.add('is-open');
      block.appendChild(assistantPanel);
    }
  }, POLL_INTERVAL);
}
