/* ═══════════════════════════════════════════════════════════════
   Comms Dashboard – Courtney Remekie
   dashboard.js — tabs, assistant, polling, button wiring
   ═══════════════════════════════════════════════════════════════ */

// ────── Tab switching ──────────────────────────────────────
window.switchTab = function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    const btn = document.getElementById(`tab-${name}`);
    const panel = document.getElementById(`panel-${name}`);
    if (btn) btn.classList.add('active');
    if (panel) panel.classList.add('active');
  };

  // ────── Assistant Panel toggle ─────────────────────────────
  const fab = document.getElementById('assistant-toggle');
  const panel = document.getElementById('assistant-panel');
  const closeBtn = document.getElementById('assistant-close');

  if (fab && panel) {
    fab.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });
  }
  if (closeBtn && panel) {
    closeBtn.addEventListener('click', () => {
      panel.hidden = true;
    });
  }

  // ────── Assistant Chat ─────────────────────────────────────
  const messagesEl = document.getElementById('assistant-messages');
  const inputEl = document.getElementById('assistant-input');
  const sendBtn = document.getElementById('assistant-send');

  function addMessage(text, role) {
    if (!messagesEl) return;
    const div = document.createElement('div');
    div.className = role === 'user' ? 'msg-user' : 'msg-assistant';
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function handleBookingIntent(text) {
    /* Pattern: "book ... with PERSON ... TIME" */
    const bookRe = /\bbook\b.*\bwith\b\s+(.+?)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next\s+\w+)/i;
    const m = text.match(bookRe);
    if (!m) return false;

    const person = m[1].replace(/\b\w/g, c => c.toUpperCase());
    const when = m[2];
    const timeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    const time = timeMatch ? timeMatch[1] : '10:00 AM';
    const subjectMatch = text.match(/(?:about|re|regarding|for)\s+["']?([^"']+?)["']?\s*(?:on|$)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : 'Meeting';

    /* Show typing first */
    const typing = addMessage('Checking calendars...', 'assistant');
    typing.classList.add('msg-typing');

    setTimeout(() => {
      if (typing.parentNode) typing.parentNode.removeChild(typing);

      const card = document.createElement('div');
      card.className = 'msg-booking-card';
      card.innerHTML = `
        <div class="booking-label">Draft Meeting</div>
        <div class="booking-subject">${subject}</div>
        <div class="booking-meta">With ${person} &middot; ${when} at ${time} MDT</div>
        <div class="booking-meta">Via Teams &middot; 30 min</div>
        <div class="booking-actions">
          <button class="booking-confirm">Send Invite</button>
          <button class="booking-cancel">Cancel</button>
        </div>`;
      messagesEl.appendChild(card);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      card.querySelector('.booking-confirm').addEventListener('click', () => {
        card.querySelector('.booking-actions').innerHTML = '<span class="booking-sent">Invite sent.</span>';
      });
      card.querySelector('.booking-cancel')?.addEventListener('click', () => {
        card.querySelector('.booking-actions').innerHTML = '<span style="color:#9d9da1;font-size:12px">Cancelled.</span>';
      });
    }, 800);

    return true;
  }

  function handleAssistantReply(text) {
    const lower = text.toLowerCase();

    /* Booking intent */
    if (handleBookingIntent(text)) return;

    /* Quick-reply patterns */
    const typing = addMessage('Thinking...', 'assistant');
    typing.classList.add('msg-typing');

    setTimeout(() => {
      if (typing.parentNode) typing.parentNode.removeChild(typing);

      let reply;
      if (/monday|what.*day|my day|tomorrow|schedule/i.test(lower)) {
        reply = 'Monday May 4:\n• 9 AM — B2B Edition Technical Office Hours\n• 10 AM — AEM XSC Manager Meeting (Bill Lofft)\n• 11 AM — AEM XSC Office Hours - Demo Help\n• 1:05 PM — Court/Lisa 1:1\n\nPersonal:\n• 10 AM — Theo Dr. Ryan appointment\n• 2 PM — Theo U10 Raiders Black Practice';
      } else if (/theo.*game|game.*theo|soccer.*week|this week.*soccer/i.test(lower)) {
        reply = 'Theo\'s games this week:\n• Sun May 3, 9:00 AM — Exhibition vs. Juventus (Schaefer), Northmount School\n• Sun May 3, 12:30 PM — Raiders vs Leduc Cats Yellow, Field 11\n• Sun May 3, 1:30 PM — Raiders vs SAMFA 1, Field 10\n• Sat May 9, 5:00 AM — Football Game Week 3, EFFA Fields';
      } else if (/zyra|spirits|drink/i.test(lower)) {
        reply = 'Zyra Spirits inbox (40 unread, filtered):\n• Suits Staffing — re: Greg at Cariwest referral\n• Nate Reinhart — Zyra x O\'Byrne\'s partnership\n• Jasmine K. (SNDL) — Introduction\n• Orchard Lane Media — Rate Card + Dates\n\nThe Suits Staffing + SNDL threads look highest-priority.';
      } else if (/whatsapp|unread.*family|family.*chat/i.test(lower)) {
        reply = 'WhatsApp: 34 unread total. Noisiest group: TH.I.N.K YeG.\n\nTip: to mute it, open the group → tap the group name → Mute notifications → Always.';
      } else if (/urgent|important|action/i.test(lower)) {
        reply = 'Urgent items I can see:\n1. CDMFA Flag Football Schedule — URGENT UPDATE for May 2/3\n2. Kyra RDP Tuition Deadline — Mon May 4\n3. Suits Staffing reply re: Cariwest referral (Zyra)\n4. Summit 26 Campaign RECORDS Dashboard — Chiyomi waiting on reply';
      } else {
        reply = 'I can see your Slack, Teams, Outlook, Gmail, Zyra, Messages, WhatsApp, and calendars. Ask me about specific channels, people, meetings, or say "book..." to draft an invite.';
      }

      addMessage(reply, 'assistant');
    }, 600);
  }

  function sendChat() {
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    inputEl.value = '';
    handleAssistantReply(text);
  }

  if (sendBtn) sendBtn.addEventListener('click', sendChat);
  if (inputEl) inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  // ────── Recordings buttons ─────────────────────────────────
  document.querySelectorAll('.rec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.meeting;
      switchTab('files');
      /* Could flash-highlight the recordings card */
    });
  });

  // ────── Refresh buttons (stubs) ────────────────────────────
  function flashButton(btn, label) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = label || 'Refreshing...';
    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 1200);
  }

  const btnSlack = document.getElementById('btn-refresh-slack');
  const btnTeams = document.getElementById('btn-refresh-teams');
  const btnMessages = document.getElementById('btn-refresh-messages');
  const btnWhatsapp = document.getElementById('btn-refresh-whatsapp');
  const btnRecordings = document.getElementById('btn-fetch-recordings');

  if (btnSlack) btnSlack.addEventListener('click', () => flashButton(btnSlack));
  if (btnTeams) btnTeams.addEventListener('click', () => flashButton(btnTeams));
  if (btnMessages) btnMessages.addEventListener('click', () => flashButton(btnMessages));
  if (btnWhatsapp) btnWhatsapp.addEventListener('click', () => flashButton(btnWhatsapp));
  if (btnRecordings) btnRecordings.addEventListener('click', () => flashButton(btnRecordings, 'Fetching...'));

  // ────── Client-side polling (60s) ──────────────────────────
  let pollTimer = null;

  function updateTimestamp(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const now = new Date();
    const h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    el.textContent = `Updated ${h12}:${m} ${ampm}`;
  }

  function pollDashboard() {
    /* Update timestamps */
    updateTimestamp('slack-last-updated');
    updateTimestamp('outlook-last-updated');
    updateTimestamp('messages-last-updated');
    updateTimestamp('whatsapp-last-updated');

    /* Placeholder: In production, these would fetch real data via APIs.
       For now, update the badges to show they refresh. */
  }

  function startPolling() {
    pollDashboard(); // immediate first run
    pollTimer = setInterval(pollDashboard, 60000); // 60s
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // Pause polling when tab hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
    }
  });

  // ────── Init ───────────────────────────────────────────────
  startPolling();
})();
