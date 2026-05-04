/**
 * Comms Dashboard block
 * Fetches live data from the comms-data Cloudflare Worker and renders
 * the full dashboard: Work (Slack/Teams/Outlook), Meetings, Personal, Files.
 *
 * Block authoring: single table with one cell containing the worker URL.
 * Falls back to static skeleton when worker data is unavailable.
 */

const POLL_INTERVAL = 60_000; // 60 s

// ── Helpers ───────────────────────────────────────────────────

function el(tag, cls, html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function chip(text, color = 'gray') {
  return `<span class="cd-chip cd-chip-${color}">${text}</span>`;
}

function personChip(initials, name) {
  return `<span class="cd-person-chip"><span class="cd-av">${initials}</span>${name}</span>`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}

function relativeDate(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Data fetching ─────────────────────────────────────────────

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

// ── Render helpers ────────────────────────────────────────────

function renderSlack(data) {
  const d = data?.slack?.data;
  if (!d) return renderFallbackSlack();

  const channels = (d.pinnedChannels || []).map((ch) => `
    <tr>
      <td class="cd-bold">#${ch.name}</td>
      <td>${ch.lastMessage ? `"${ch.lastMessage}" <span class="cd-muted">— ${ch.lastMessageDate || ''}</span>` : '<span class="cd-muted">—</span>'}</td>
    </tr>`).join('');

  const people = (d.priorityPeople || []).map((p) => personChip(p.initials, p.name)).join('');

  const mentions = (d.mentions || []).map((m) => `
    <tr>
      <td class="cd-col-date">${m.date}</td>
      <td class="cd-bold">${m.from}</td>
      <td>${m.channel}</td>
    </tr>`).join('');

  const unread = d.unreadCount ? `${chip(d.unreadCount, 'gray')}` : '';
  const updated = data.slack?.updatedAt ? `<span class="cd-last-updated">${relativeDate(data.slack.updatedAt)}</span>` : '';

  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">Slack ${unread} ${updated}</div>
        <div class="cd-card-subheading">Adobe Enterprise Workspace</div>
      </div>
    </div>
    <span class="cd-section-label">Pinned Channels</span>
    <table class="cd-ctable">
      <thead><tr><th>Channel</th><th>Last Message</th></tr></thead>
      <tbody>${channels || '<tr><td colspan="2" class="cd-muted">No channels</td></tr>'}</tbody>
    </table>
    <span class="cd-section-label">Priority People</span>
    <div class="cd-people-wrap">${people}</div>
    <span class="cd-section-label">Direct @mentions</span>
    <table class="cd-ctable">
      <thead><tr><th>Date</th><th>From</th><th>Channel</th></tr></thead>
      <tbody>${mentions || '<tr><td colspan="3" class="cd-muted">No recent mentions</td></tr>'}</tbody>
    </table>
    <div class="cd-action-row">
      <button class="cd-btn cd-btn-sm" data-refresh="slack">Refresh Slack</button>
    </div>`;
}

function renderFallbackSlack() {
  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">Slack <span class="cd-live-dot"></span></div>
        <div class="cd-card-subheading">Adobe Enterprise Workspace · waiting for data</div>
      </div>
    </div>
    <div class="cd-empty-state">
      <div class="cd-empty-title">Not yet connected</div>
      Set up the n8n or Power Automate integration to see live Slack data here.
    </div>`;
}

function renderTeams(data) {
  const d = data?.teams?.data;
  if (!d) return renderFallbackTeams();

  const meetings = (d.watchedMeetings || []).map((m) => `
    <tr>
      <td class="cd-bold">${m.name}</td>
      <td>${m.organizer || ''}</td>
      <td class="cd-col-cadence">${m.cadence || ''}</td>
      <td class="cd-col-action"><button class="cd-btn cd-btn-sm" data-recordings="${m.name}">Recordings</button></td>
    </tr>`).join('');

  const teams = (d.watchedTeams || []).map((t) => `
    <tr>
      <td class="cd-bold">${t.name}</td>
      <td class="cd-col-date">${t.lastActive || '—'}</td>
    </tr>`).join('');

  const updated = data.teams?.updatedAt ? `<span class="cd-last-updated">${relativeDate(data.teams.updatedAt)}</span>` : '';

  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">Teams ${updated}</div>
        <div class="cd-card-subheading">Microsoft Teams</div>
      </div>
    </div>
    <span class="cd-section-label">Watched Meetings</span>
    <table class="cd-ctable">
      <thead><tr><th>Meeting</th><th>Organizer</th><th class="cd-col-cadence">Cadence</th><th class="cd-col-action"></th></tr></thead>
      <tbody>${meetings || '<tr><td colspan="4" class="cd-muted">No meetings</td></tr>'}</tbody>
    </table>
    <span class="cd-section-label">Watched Teams</span>
    <table class="cd-ctable">
      <thead><tr><th>Team</th><th class="cd-col-date">Last Active</th></tr></thead>
      <tbody>${teams || '<tr><td colspan="2" class="cd-muted">No teams</td></tr>'}</tbody>
    </table>
    <div class="cd-action-row">
      <button class="cd-btn cd-btn-sm" data-refresh="teams">Refresh Teams Activity</button>
    </div>`;
}

function renderFallbackTeams() {
  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">Teams</div>
        <div class="cd-card-subheading">Microsoft Teams · waiting for data</div>
      </div>
    </div>
    <div class="cd-empty-state">
      <div class="cd-empty-title">Not yet connected</div>
      Set up Power Automate to push Teams data to the Cloudflare Worker.
    </div>`;
}

function renderOutlook(data) {
  const d = data?.outlook?.data;
  if (!d) return renderFallbackOutlook();

  const unread = d.unreadCount ?? 0;
  const updated = data.outlook?.updatedAt ? `<span class="cd-last-updated">${relativeDate(data.outlook.updatedAt)}</span>` : '';

  const meetings = (d.meetings || []).slice(0, 6).map((m) => `
    <tr><td class="cd-bold">${m.subject}</td></tr>
    <tr><td class="cd-muted" style="padding-top:0;border:none">${m.from || ''}</td></tr>`).join('');

  const people = (d.people || []).slice(0, 6).map((p) => `
    <tr><td class="cd-bold">${p.subject}</td></tr>
    <tr><td class="cd-muted" style="padding-top:0;border:none">${p.from || ''}</td></tr>`).join('');

  const flagged = (d.flagged || []);
  const flaggedHtml = flagged.length
    ? flagged.map((f) => `<tr><td class="cd-bold">${f.subject}</td></tr>`).join('')
    : `<div class="cd-empty-state"><div class="cd-empty-title">No flagged emails</div>Flag items in Outlook to surface them here.</div>`;

  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">Outlook ${chip(`${unread} unread`, unread > 100 ? 'red' : 'gray')} ${updated}</div>
        <div class="cd-card-subheading">remekie@adobe.com</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/mail" target="_blank">Open Outlook</a>
    </div>
    <div class="cd-grid-3 cd-mt-16 cd-outlook-swimlanes">
      <div>
        <span class="cd-section-label cd-mt-0">Meetings / Invites</span>
        <table class="cd-ctable"><tbody>${meetings || '<tr><td class="cd-muted">None</td></tr>'}</tbody></table>
      </div>
      <div>
        <span class="cd-section-label cd-mt-0">People <span class="cd-chip cd-chip-green">adobe.com</span></span>
        <table class="cd-ctable"><tbody>${people || '<tr><td class="cd-muted">None</td></tr>'}</tbody></table>
      </div>
      <div>
        <span class="cd-section-label cd-mt-0">To-Do / Flagged</span>
        ${typeof flaggedHtml === 'string' && flagged.length ? `<table class="cd-ctable"><tbody>${flaggedHtml}</tbody></table>` : flaggedHtml}
        <div class="cd-action-row" style="justify-content:center">
          <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/mail" target="_blank">Open Outlook</a>
        </div>
      </div>
    </div>
    <div class="cd-filter-note">Filters active — hiding Uber receipts, LinkedIn alerts, Concur notifications, automated senders</div>`;
}

function renderFallbackOutlook() {
  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">Outlook</div>
        <div class="cd-card-subheading">remekie@adobe.com · waiting for data</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/mail" target="_blank">Open Outlook</a>
    </div>
    <div class="cd-empty-state">
      <div class="cd-empty-title">Not yet connected</div>
      Power Automate will push Outlook unread counts and flagged items here.
    </div>`;
}

function renderMeetings(data) {
  const d = data?.outlook?.data?.calendar || data?.calendar?.data;
  if (!d || !d.events?.length) return renderFallbackMeetings();

  let lastDay = '';
  const rows = d.events.map((ev) => {
    let dayRow = '';
    if (ev.day !== lastDay) {
      lastDay = ev.day;
      const isToday = ev.isToday ? `<span class="cd-chip-today">Today</span>` : '';
      dayRow = `<tr class="cd-day-header"><td colspan="4">${ev.day} ${isToday}</td></tr>`;
    }
    const tag = ev.tag ? chip(ev.tag, ev.tagColor || 'gray') : '';
    return `${dayRow}<tr>
      <td class="cd-col-time">${ev.time || '—'}</td>
      <td class="cd-bold">${ev.title}</td>
      <td>${ev.organizer || ''}</td>
      <td class="cd-col-tag">${tag}</td>
    </tr>`;
  }).join('');

  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">This Week</div>
        <div class="cd-card-subheading">${d.weekLabel || 'This week'} · All times MDT · Edmonton</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/calendar" target="_blank">Open Calendar</a>
    </div>
    <table class="cd-ctable cd-mt-16">
      <thead><tr><th class="cd-col-time">Time</th><th>Event</th><th class="cd-col-narrow">Organizer</th><th class="cd-col-tag"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderFallbackMeetings() {
  return `
    <div class="cd-card-head">
      <div>
        <div class="cd-card-heading">This Week</div>
        <div class="cd-card-subheading">Waiting for calendar data from Power Automate</div>
      </div>
      <a class="cd-btn cd-btn-sm" href="https://outlook.office.com/calendar" target="_blank">Open Calendar</a>
    </div>
    <div class="cd-empty-state">
      <div class="cd-empty-title">Calendar not yet connected</div>
      Set up Power Automate to push calendar events here.
    </div>`;
}

function renderPersonal(data) {
  const gmail = data?.gmail?.data;
  const cal = data?.calendar?.data;

  const gmailRows = gmail ? (gmail.filtered || []).slice(0, 8).map((m) => `
    <tr>
      <td class="cd-bold">${m.from}</td>
      <td>${m.subject}</td>
      <td class="cd-col-tag">${chip(m.tag, m.tagColor || 'gray')}</td>
    </tr>`).join('') : null;

  const calRows = cal ? (cal.events || []).filter((e) => e.isPersonal).slice(0, 10).map((ev) => `
    <tr>
      <td class="cd-bold">${ev.day || ''}${ev.isToday ? ' <span class="cd-chip-today">Today</span>' : ''}</td>
      <td class="cd-col-time">${ev.time}</td>
      <td>${ev.title}</td>
      <td class="cd-muted">${ev.location || ''}</td>
      <td class="cd-col-tag">${ev.tag ? chip(ev.tag, ev.tagColor || 'gray') : ''}</td>
    </tr>`).join('') : null;

  const gmailUnread = gmail?.unreadCount ?? '—';
  const gmailUpdated = data?.gmail?.updatedAt ? `<span class="cd-last-updated">${relativeDate(data.gmail.updatedAt)}</span>` : '';

  return `
    <div class="cd-grid-2 cd-personal-grid">
      <div class="cd-card">
        <div class="cd-card-head">
          <div>
            <div class="cd-card-heading">Gmail <span class="cd-badge-negative">${gmailUnread} unread</span> ${gmailUpdated}</div>
            <div class="cd-card-subheading">courtney.remekie@gmail.com</div>
          </div>
          <a class="cd-btn cd-btn-sm" href="https://mail.google.com" target="_blank">Open Gmail</a>
        </div>
        <div class="cd-filter-pill">Family filter: Theo · Soccer · Football · Jayleen · Kyra</div>
        ${gmailRows ? `<table class="cd-ctable cd-mt-16">
          <thead><tr><th>From</th><th>Subject</th><th class="cd-col-tag">Tag</th></tr></thead>
          <tbody>${gmailRows}</tbody>
        </table>` : '<div class="cd-empty-state"><div class="cd-empty-title">Gmail not connected</div>Connect via n8n or OAuth.</div>'}
      </div>

      <div class="cd-card">
        <div class="cd-card-head">
          <div>
            <div class="cd-card-heading">Zyra Spirits</div>
            <div class="cd-card-subheading">courtney@drinkzyra.com</div>
          </div>
          <a class="cd-btn cd-btn-sm" href="https://webmail.dreamhost.com" target="_blank">Open Zyra Mail</a>
        </div>
        <div class="cd-empty-state">
          <div class="cd-empty-title">Connect Zyra email via n8n IMAP</div>
          n8n IMAP node → filter → POST to /data/zyra
        </div>
      </div>

      <div class="cd-card cd-full-width">
        <div class="cd-card-head">
          <div><div class="cd-card-heading">Family Calendar</div><div class="cd-card-subheading">${cal?.weekLabel || 'This week'} · All times MDT</div></div>
          <a class="cd-btn cd-btn-sm" href="https://calendar.google.com" target="_blank">Open Calendar</a>
        </div>
        ${calRows ? `<table class="cd-ctable cd-mt-16">
          <thead><tr><th>Day</th><th class="cd-col-time">Time</th><th>Event</th><th>Location</th><th class="cd-col-tag">Tag</th></tr></thead>
          <tbody>${calRows}</tbody>
        </table>` : '<div class="cd-empty-state"><div class="cd-empty-title">Family calendar not connected</div>Connect Google Calendar via n8n.</div>'}
      </div>
    </div>`;
}

function renderFiles(data) {
  const d = data?.teams?.data;
  const recordings = d?.recordings || [];

  const rows = recordings.map((r) => `
    <tr>
      <td class="cd-bold">${r.name}</td>
      <td>${r.organizer || ''}</td>
      <td class="cd-col-date">${r.date || ''}</td>
      <td class="cd-col-tag">${chip('Teams', 'blue')}</td>
    </tr>`).join('');

  return `
    <div class="cd-card">
      <div class="cd-card-head">
        <div><div class="cd-card-heading">Team Recordings</div><div class="cd-card-subheading">Microsoft Teams</div></div>
        <button class="cd-btn cd-btn-primary cd-btn-sm" data-refresh="recordings">Fetch Recordings</button>
      </div>
      ${rows ? `<table class="cd-ctable cd-mt-16">
        <thead><tr><th>Recording</th><th>Organizer</th><th class="cd-col-date">Date</th><th class="cd-col-tag">Source</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<p style="color:#9d9da1;font-size:13px;margin:6px 0 0">Recordings from your watched meetings will appear here after Power Automate syncs.</p>'}
    </div>
    <div class="cd-card cd-mt-24">
      <div class="cd-card-head">
        <div><div class="cd-card-heading">SharePoint</div><div class="cd-card-subheading">adobe.sharepoint.com</div></div>
        <a class="cd-btn cd-btn-sm" href="https://adobe.sharepoint.com" target="_blank">Open SharePoint</a>
      </div>
      <p style="color:#9d9da1;font-size:13px;margin:8px 0 0">Access shared documents and team sites.</p>
    </div>`;
}

// ── Assistant ─────────────────────────────────────────────────

function buildAssistant(data) {
  const panel = el('div', 'cd-assistant-panel');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="cd-assistant-header">
      <svg viewBox="0 0 133.46 118.11" width="18" height="16" style="flex-shrink:0" aria-hidden="true">
        <polygon fill="#fa0f00" points="84.13 0 133.46 0 133.46 118.11 84.13 0"/>
        <polygon fill="#fa0f00" points="49.37 0 0 0 0 118.11 49.37 0"/>
        <polygon fill="#fa0f00" points="66.75 43.53 98.18 118.11 77.58 118.11 68.18 94.36 45.18 94.36 66.75 43.53"/>
      </svg>
      <div style="flex:1">
        <div class="cd-assistant-title">Court's Co-worker</div>
        <div class="cd-assistant-subtitle">Powered by Claude · knows your context</div>
      </div>
      <button class="cd-assistant-close" aria-label="Close">×</button>
    </div>
    <div class="cd-assistant-messages">
      <div class="cd-msg-assistant cd-msg-suggestions">
        <strong>Hi Courtney! Connected to Slack, Teams, Outlook, Gmail, Zyra, and your calendars. Try:</strong>
        · "What's my day Monday?" · "Any urgent Zyra emails?" · "Theo's games this week?" · "Book with Jake Tuesday 2pm"
      </div>
    </div>
    <div class="cd-assistant-input-area">
      <input type="text" class="cd-assistant-input" placeholder="Ask anything about your day..."/>
      <button class="cd-assistant-send">Send</button>
    </div>`;

  // Close
  panel.querySelector('.cd-assistant-close').addEventListener('click', () => { panel.hidden = true; });

  // Chat
  const messages = panel.querySelector('.cd-assistant-messages');
  const input = panel.querySelector('.cd-assistant-input');
  const sendBtn = panel.querySelector('.cd-assistant-send');

  function addMsg(text, role) {
    const d = el('div', role === 'user' ? 'cd-msg-user' : 'cd-msg-assistant');
    d.style.whiteSpace = 'pre-wrap';
    d.textContent = text;
    messages.appendChild(d);
    messages.scrollTop = messages.scrollHeight;
    return d;
  }

  function reply(text) {
    const lower = text.toLowerCase();
    const typing = addMsg('Thinking…', 'assistant');
    typing.classList.add('cd-msg-typing');
    setTimeout(() => {
      typing.remove();
      let r;
      if (/monday|what.*day|my day|tomorrow|schedule/i.test(lower)) {
        const events = data?.outlook?.data?.calendar?.events?.filter((e) => e.day?.includes('Monday')) || [];
        r = events.length
          ? `Monday:\n${events.map((e) => `• ${e.time} — ${e.title}`).join('\n')}`
          : 'No calendar data yet. Set up Power Automate to see your day.';
      } else if (/urgent|important|action/i.test(lower)) {
        const flagged = data?.outlook?.data?.flagged || [];
        r = flagged.length
          ? `Flagged:\n${flagged.map((f) => `• ${f.subject}`).join('\n')}`
          : 'No flagged items in Outlook. Everything looks clear.';
      } else if (/teams|slack.*unread|unread.*slack/i.test(lower)) {
        const sc = data?.slack?.data?.unreadCount;
        r = sc ? `Slack: ${sc} unread messages` : 'Slack data not yet connected.';
      } else {
        r = 'I can see your connected inboxes, Teams, and calendars. Ask about specific channels, people, meetings, or say "book…" to draft an invite. (Full AI replies available once Claude API key is wired up in the worker.)';
      }
      addMsg(r, 'assistant');
    }, 600);
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    addMsg(text, 'user');
    input.value = '';
    reply(text);
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  return panel;
}

// ── Main block decorator ──────────────────────────────────────

export default async function decorate(block) {
  // Read worker URL from block content (first cell)
  const workerUrl = (block.querySelector('td, p')?.textContent || '').trim()
    || 'https://comms-data.remekie.workers.dev';
  block.textContent = '';

  // ── Top bar
  const topbar = el('div', 'cd-topbar');
  topbar.innerHTML = `
    <svg viewBox="0 0 133.46 118.11" width="28" height="24" aria-label="Adobe">
      <polygon fill="#fa0f00" points="84.13 0 133.46 0 133.46 118.11 84.13 0"/>
      <polygon fill="#fa0f00" points="49.37 0 0 0 0 118.11 49.37 0"/>
      <polygon fill="#fa0f00" points="66.75 43.53 98.18 118.11 77.58 118.11 68.18 94.36 45.18 94.36 66.75 43.53"/>
    </svg>
    <div class="cd-topbar-sep"></div>
    <div>
      <div class="cd-topbar-title">Comms Dashboard</div>
      <div class="cd-topbar-sub">Courtney Remekie · Adobe Solutions Consultant · MDT
        <span class="cd-live-indicator"><span class="cd-live-dot"></span> Live · 60s</span>
      </div>
    </div>
    <div class="cd-topbar-right">
      <span class="cd-badge-negative cd-unread-total">—</span>
      <span class="cd-unread-label">unread across all inboxes</span>
    </div>`;
  block.appendChild(topbar);

  // ── Tab bar
  const tabs = ['work', 'meetings', 'personal', 'files'];
  const tabLabels = { work: 'Work', meetings: 'Meetings', personal: 'Personal', files: 'Files & Recordings' };
  const tabBar = el('div', 'cd-tab-bar');
  tabs.forEach((t, i) => {
    const btn = el('button', `cd-tab-btn${i === 0 ? ' active' : ''}`);
    btn.id = `cd-tab-${t}`;
    btn.textContent = tabLabels[t];
    btn.addEventListener('click', () => {
      block.querySelectorAll('.cd-tab-btn').forEach((b) => b.classList.remove('active'));
      block.querySelectorAll('.cd-tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      block.querySelector(`#cd-panel-${t}`)?.classList.add('active');
    });
    tabBar.appendChild(btn);
  });
  block.appendChild(tabBar);

  // ── Panels
  const panels = {};
  tabs.forEach((t, i) => {
    const panel = el('div', `cd-tab-panel${i === 0 ? ' active' : ''}`);
    panel.id = `cd-panel-${t}`;
    panel.innerHTML = '<div class="cd-loading">Loading…</div>';
    panels[t] = panel;
    block.appendChild(panel);
  });

  // ── Assistant FAB + panel
  const fab = el('div', 'cd-assistant-fab');
  fab.innerHTML = `<button id="cd-assistant-toggle">
    <svg viewBox="0 0 133.46 118.11" width="18" height="16" aria-hidden="true">
      <polygon fill="#fa0f00" points="84.13 0 133.46 0 133.46 118.11 84.13 0"/>
      <polygon fill="#fa0f00" points="49.37 0 0 0 0 118.11 49.37 0"/>
      <polygon fill="#fa0f00" points="66.75 43.53 98.18 118.11 77.58 118.11 68.18 94.36 45.18 94.36 66.75 43.53"/>
    </svg>
    Ask Court's Co-worker
  </button>`;
  block.appendChild(fab);

  let assistantPanel = null;

  // ── Render function
  function renderAll(data) {
    const d = data || {};

    // Work tab
    panels.work.innerHTML = `
      <div class="cd-grid-2 cd-work-top-grid">
        <div class="cd-card">${renderSlack(d)}</div>
        <div class="cd-card">${renderTeams(d)}</div>
      </div>
      <div class="cd-card cd-mt-24">${renderOutlook(d)}</div>`;

    // Meetings tab
    panels.meetings.innerHTML = `<div class="cd-card">${renderMeetings(d)}</div>`;

    // Personal tab
    panels.personal.innerHTML = renderPersonal(d);

    // Files tab
    panels.files.innerHTML = renderFiles(d);

    // Unread total badge
    const outlookUnread = d.outlook?.data?.unreadCount ?? 0;
    const slackUnread = d.slack?.data?.unreadCount ?? 0;
    const total = outlookUnread + slackUnread;
    const badge = block.querySelector('.cd-unread-total');
    if (badge && total > 0) badge.textContent = total.toLocaleString();

    // Re-attach refresh handlers
    block.querySelectorAll('[data-refresh]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lbl = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Refreshing…';
        fetchData(workerUrl).then((fresh) => {
          if (fresh) renderAll(fresh);
          btn.disabled = false;
          btn.textContent = lbl;
        });
      });
    });

    // Assistant rebuild with fresh data
    if (assistantPanel) assistantPanel.remove();
    assistantPanel = buildAssistant(d);
    block.appendChild(assistantPanel);
    fab.querySelector('button').onclick = () => { assistantPanel.hidden = !assistantPanel.hidden; };

    // Recordings nav
    block.querySelectorAll('[data-recordings]').forEach((btn) => {
      btn.addEventListener('click', () => {
        block.querySelectorAll('.cd-tab-btn').forEach((b) => b.classList.remove('active'));
        block.querySelectorAll('.cd-tab-panel').forEach((p) => p.classList.remove('active'));
        block.querySelector('#cd-tab-files')?.classList.add('active');
        panels.files.classList.add('active');
      });
    });
  }

  // ── Initial load
  const data = await fetchData(workerUrl);
  renderAll(data);

  // ── Polling
  setInterval(async () => {
    const fresh = await fetchData(workerUrl);
    if (fresh) renderAll(fresh);
  }, POLL_INTERVAL);
}
