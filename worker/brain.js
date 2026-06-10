/**
 * Jon Jon Brain Worker — brain.compass-xsc.workers.dev
 *
 * Bindings:
 *   DB        — D1 (jon-jon-brain)
 *   KV        — KV namespace (JON_JON_KV)
 *   R2        — R2 bucket (jon-jon-brain-uploads)
 *   VECTORIZE — Vectorize index (jon-jon-brain-embeddings)
 *
 * Secrets:
 *   ANTHROPIC_API_KEY, BRAIN_TOKEN
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

const REDIRECT_URI = 'https://brain.compass-xsc.workers.dev/auth/google/callback';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

// ── D1 schema ─────────────────────────────────────────────

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    world TEXT CHECK(world IN ('adobe','zyra','family','personal')),
    role TEXT,
    company TEXT,
    relationship_strength INTEGER DEFAULT 0,
    last_contact TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT,
    start_time TEXT,
    end_time TEXT,
    attendees TEXT,
    source TEXT,
    world TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT,
    merchant TEXT,
    amount REAL,
    category TEXT,
    world TEXT CHECK(world IN ('adobe','zyra','personal','family')),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    type TEXT,
    source TEXT,
    content_summary TEXT,
    world TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    world TEXT,
    status TEXT DEFAULT 'active',
    key_people TEXT,
    last_activity TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS ingestion_log (
    id TEXT PRIMARY KEY,
    source TEXT,
    record_count INTEGER,
    status TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
];

// ── Helpers ───────────────────────────────────────────────

function cors(origin) {
  const allowed = [
    'https://main--courtney-dashboard--remekie.aem.live',
    'https://main--courtney-dashboard--remekie.aem.page',
    'http://localhost:3000',
    'http://localhost:3001',
  ];
  return allowed.includes(origin) ? origin : allowed[0];
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': cors(origin),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    },
  });
}

function authOk(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.BRAIN_TOKEN}`;
}

function parseEmail(header) {
  // "Bill Lofft <blofft@adobe.com>" → { name: "Bill Lofft", email: "blofft@adobe.com" }
  const match = header.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  if (header.includes('@')) return { name: header.split('@')[0], email: header.trim() };
  return { name: header.trim(), email: null };
}

function classifyWorld(email, subject) {
  const e = (email || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  if (e.includes('adobe.com') || s.includes('adobe') || s.includes('aem') || s.includes('eds')) return 'adobe';
  if (e.includes('drinkzyra') || s.includes('zyra') || s.includes('vodka') || s.includes('spirits')) return 'zyra';
  return 'personal';
}

// ── Google OAuth token management ─────────────────────────

async function getGoogleToken(env) {
  const tokens = await env.KV.get('oauth:google:tokens', 'json');
  if (!tokens) throw new Error('Google not connected — visit /auth/google');

  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  if (Date.now() < expiresAt - 60_000) return tokens.access_token;

  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }
  const fresh = await res.json();
  fresh.refresh_token = tokens.refresh_token;
  fresh.obtained_at = Date.now();
  await env.KV.put('oauth:google:tokens', JSON.stringify(fresh));
  return fresh.access_token;
}

// ── Ingest: Gmail ─────────────────────────────────────────

async function ingestGmail(env, db) {
  const token = await getGoogleToken(env);

  // Pagination cursors — resumes from last position across calls
  const inboxCursor = await env.KV.get('brain:cursor:gmail:inbox') || '';
  const sentCursor = await env.KV.get('brain:cursor:gmail:sent') || '';

  const inboxUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=200&labelIds=INBOX${inboxCursor ? `&pageToken=${inboxCursor}` : ''}`;
  const sentUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=200&labelIds=SENT${sentCursor ? `&pageToken=${sentCursor}` : ''}`;

  const [inboxRes, sentRes] = await Promise.all([
    fetch(inboxUrl, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(sentUrl, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (!inboxRes.ok) throw new Error(`Gmail inbox list failed: ${inboxRes.status}`);
  if (!sentRes.ok) throw new Error(`Gmail sent list failed: ${sentRes.status}`);

  const inboxData = await inboxRes.json();
  const sentData = await sentRes.json();
  const { messages: inboxMsgs = [], nextPageToken: inboxNext } = inboxData;
  const { messages: sentMsgs = [], nextPageToken: sentNext } = sentData;

  // Save next cursors (delete if last page)
  if (inboxNext) await env.KV.put('brain:cursor:gmail:inbox', inboxNext);
  else await env.KV.delete('brain:cursor:gmail:inbox');
  if (sentNext) await env.KV.put('brain:cursor:gmail:sent', sentNext);
  else await env.KV.delete('brain:cursor:gmail:sent');

  // Tag each message with its source so we know which header to extract
  const toFetch = [
    ...inboxMsgs.map((m) => ({ id: m.id, isSent: false })),
    ...sentMsgs.map((m) => ({ id: m.id, isSent: true })),
  ];

  // Fetch metadata in batches of 8 to stay within connection limits
  const metas = [];
  for (let i = 0; i < toFetch.length; i += 8) {
    const chunk = toFetch.slice(i, i + 8);
    const responses = await Promise.all(
      chunk.map(({ id }) => fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } },
      )),
    );
    const parsed = await Promise.all(responses.map((r) => r.json()));
    metas.push(...parsed);
  }

  let personCount = 0;
  let interactionCount = 0;

  const interactionStmt = db.prepare(
    `INSERT OR IGNORE INTO interactions (id, type, source, content_summary, world, created_at)
     VALUES (?, 'email', 'gmail', ?, ?, ?)`,
  );

  for (let i = 0; i < metas.length; i++) {
    const msg = metas[i];
    const { isSent } = toFetch[i];
    if (!msg.payload?.headers) continue;

    const h = Object.fromEntries(msg.payload.headers.map((x) => [x.name, x.value]));
    // Sent: use To (who Courtney emailed) — stronger relationship signal
    // Inbox: use From (who emailed Courtney)
    const contactHeader = isSent ? (h.To || '') : (h.From || '');
    const contact = parseEmail(contactHeader);
    if (!contact.email) continue;

    // Skip Courtney's own address from sent-to
    if (contact.email.toLowerCase().includes('remekie@adobe') || contact.email.toLowerCase().includes('courtney.remekie@gmail')) continue;

    const world = classifyWorld(contact.email, h.Subject);
    const date = h.Date ? new Date(h.Date).toISOString() : new Date().toISOString();
    const personId = `gmail-${contact.email.replace(/[^a-z0-9]/gi, '-')}`;

    // Sent emails get double strength boost — proactive outreach matters more
    const strengthBoost = isSent ? 2 : 1;
    await db.batch([
      db.prepare(
        `INSERT OR REPLACE INTO people (id, name, email, world, last_contact, relationship_strength)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT relationship_strength + ? FROM people WHERE id = ?), ?))`,
      ).bind(personId, contact.name, contact.email, world, date, strengthBoost, personId, strengthBoost),
      interactionStmt.bind(
        `gmail-${msg.id}`,
        `${isSent ? '→ Sent to' : '← From'} ${contact.name}: ${h.Subject || '(no subject)'}`,
        world,
        date,
      ),
    ]);
    personCount++;
    interactionCount++;
  }

  await db.prepare(
    `INSERT INTO ingestion_log (id, source, record_count, status) VALUES (?, 'gmail', ?, 'ok')`,
  ).bind(`log-${Date.now()}`, personCount).run();

  return { people: personCount, interactions: interactionCount, inbox: inboxMsgs.length, sent: sentMsgs.length, hasMore: !!(inboxNext || sentNext) };
}

// ── Ingest: Google Calendar ───────────────────────────────

async function ingestCalendar(env, db) {
  const token = await getGoogleToken(env);

  const cursor = await env.KV.get('brain:cursor:gcalendar') || '';
  const timeMin = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=2500&singleEvents=true&orderBy=startTime${cursor ? `&pageToken=${cursor}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Calendar fetch failed: ${res.status}`);
  const { items = [], nextPageToken } = await res.json();

  if (nextPageToken) await env.KV.put('brain:cursor:gcalendar', nextPageToken);
  else await env.KV.delete('brain:cursor:gcalendar');

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO events (id, title, start_time, end_time, attendees, source, world)
     VALUES (?, ?, ?, ?, ?, 'gcalendar', ?)`,
  );

  let count = 0;
  for (const ev of items) {
    const attendees = JSON.stringify((ev.attendees || []).map((a) => a.email));
    const world = classifyWorld('', ev.summary || '');
    const start = ev.start?.dateTime || ev.start?.date || '';
    const end = ev.end?.dateTime || ev.end?.date || '';
    await stmt.bind(ev.id, ev.summary || '(untitled)', start, end, attendees, world).run();
    count++;
  }

  await db.prepare(
    `INSERT INTO ingestion_log (id, source, record_count, status) VALUES (?, 'gcalendar', ?, 'ok')`,
  ).bind(`log-${Date.now()}`, count).run();

  return { events: count, hasMore: !!nextPageToken };
}

// ── Ingest: Google Drive ─────────────────────────────────

async function ingestDrive(env, db) {
  const token = await getGoogleToken(env);

  const cursor = await env.KV.get('brain:cursor:gdrive') || '';
  const url = `https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime+desc&pageSize=1000&fields=files(id,name,mimeType,modifiedTime,sharingUser,lastModifyingUser,sharedWithMeTime),nextPageToken${cursor ? `&pageToken=${cursor}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive fetch failed: ${res.status}`);
  const { files = [], nextPageToken } = await res.json();

  if (nextPageToken) await env.KV.put('brain:cursor:gdrive', nextPageToken);
  else await env.KV.delete('brain:cursor:gdrive');

  let personCount = 0;
  let projectCount = 0;

  for (const file of files) {
    // People: whoever shared a file with Courtney or last modified a shared doc
    const sharer = file.sharingUser || file.lastModifyingUser;
    if (sharer?.emailAddress) {
      const ce = sharer.emailAddress.toLowerCase();
      if (!ce.includes('remekie@adobe') && !ce.includes('courtney.remekie@gmail') && !ce.includes('courtney@drinkzyra')) {
        const personId = `drive-${sharer.emailAddress.replace(/[^a-z0-9]/gi, '-')}`;
        const world = classifyWorld(sharer.emailAddress, file.name);
        const date = file.sharedWithMeTime || file.modifiedTime || new Date().toISOString();
        await db.prepare(
          `INSERT OR REPLACE INTO people (id, name, email, world, last_contact, relationship_strength)
           VALUES (?, ?, ?, ?, ?, COALESCE((SELECT relationship_strength + 1 FROM people WHERE id = ?), 1))`,
        ).bind(personId, sharer.displayName || sharer.emailAddress, sharer.emailAddress, world, date, personId).run();
        personCount++;
      }
    }

    // Projects: folders and documents indicate active work
    const isDoc = file.mimeType?.includes('google-apps.folder') || file.mimeType?.includes('google-apps.document')
      || file.mimeType?.includes('google-apps.spreadsheet') || file.mimeType?.includes('google-apps.presentation');
    if (isDoc && file.name) {
      const world = classifyWorld('', file.name);
      await db.prepare(
        `INSERT OR REPLACE INTO projects (id, name, world, status, last_activity, notes)
         VALUES (?, ?, ?, 'active', ?, 'Google Drive')`,
      ).bind(`drive-${file.id}`, file.name, world, file.modifiedTime || new Date().toISOString()).run();
      projectCount++;
    }
  }

  await db.prepare(
    `INSERT INTO ingestion_log (id, source, record_count, status) VALUES (?, 'gdrive', ?, 'ok')`,
  ).bind(`log-${Date.now()}`, personCount + projectCount).run();

  return { people: personCount, projects: projectCount, hasMore: !!nextPageToken };
}

// ── Ingest: manual JSON ───────────────────────────────────

async function ingestJson(db, body) {
  const { type, data } = body;

  if (type === 'person' && data) {
    const id = data.id || `person-${Date.now()}`;
    await db.prepare(
      `INSERT OR REPLACE INTO people (id, name, email, phone, world, role, company, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, data.name, data.email || null, data.phone || null, data.world || 'personal',
      data.role || null, data.company || null, data.notes || null).run();
    return { inserted: 'person', id };
  }

  if (type === 'project' && data) {
    const id = data.id || `project-${Date.now()}`;
    await db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, world, status, key_people, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, data.name, data.world || 'adobe', data.status || 'active',
      JSON.stringify(data.key_people || []), data.notes || null).run();
    return { inserted: 'project', id };
  }

  if (type === 'transaction' && data) {
    const id = data.id || `txn-${Date.now()}`;
    await db.prepare(
      `INSERT OR REPLACE INTO transactions (id, date, merchant, amount, category, world, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, data.date, data.merchant, data.amount || 0, data.category || null,
      data.world || 'personal', data.notes || null).run();
    return { inserted: 'transaction', id };
  }

  return { ok: true, message: `No handler for type: ${type}` };
}

// ── Ingest: Zyra emails (from n8n IMAP) ──────────────────

async function ingestZyraEmail(db, body) {
  const { emails = [] } = body;
  let personCount = 0;
  let interactionCount = 0;

  const interactionStmt = db.prepare(
    `INSERT OR IGNORE INTO interactions (id, type, source, content_summary, world, created_at)
     VALUES (?, 'email', 'zyra', ?, 'zyra', ?)`,
  );

  for (const email of emails) {
    // Sent: extract To (who Courtney emailed). Inbox: extract From.
    const contactHeader = email.isSent ? (email.to || '') : (email.from || '');
    const contact = parseEmail(contactHeader);
    if (!contact.email) continue;

    // Skip Courtney's own addresses only
    const ce = contact.email.toLowerCase();
    if (ce === 'courtney@drinkzyra.com' || ce.includes('remekie@adobe') || ce.includes('courtney.remekie@gmail')) continue;

    const date = email.date ? new Date(email.date).toISOString() : new Date().toISOString();
    const personId = `zyra-${contact.email.replace(/[^a-z0-9]/gi, '-')}`;
    const strengthBoost = email.isSent ? 2 : 1;
    const uniqueId = `zyra-email-${personId}-${date}`;

    await db.batch([
      db.prepare(
        `INSERT OR REPLACE INTO people (id, name, email, world, last_contact, relationship_strength)
         VALUES (?, ?, ?, 'zyra', ?, COALESCE((SELECT relationship_strength + ? FROM people WHERE id = ?), ?))`,
      ).bind(personId, contact.name, contact.email, date, strengthBoost, personId, strengthBoost),
      interactionStmt.bind(
        uniqueId,
        `${email.isSent ? '→ Sent to' : '← From'} ${contact.name}: ${email.subject || '(no subject)'}`,
        date,
      ),
    ]);
    personCount++;
    interactionCount++;
  }

  await db.prepare(
    `INSERT INTO ingestion_log (id, source, record_count, status) VALUES (?, 'zyra_email', ?, 'ok')`,
  ).bind(`log-${Date.now()}`, personCount).run();

  return { people: personCount, interactions: interactionCount };
}

// ── Synthesize profile ────────────────────────────────────

async function synthesize(env, db) {
  const [people, events, interactions, projects, transactions] = await Promise.all([
    db.prepare('SELECT * FROM people ORDER BY relationship_strength DESC LIMIT 100').all(),
    db.prepare('SELECT * FROM events ORDER BY start_time DESC LIMIT 250').all(),
    db.prepare('SELECT * FROM interactions ORDER BY created_at DESC LIMIT 500').all(),
    db.prepare('SELECT * FROM projects WHERE status = "active" LIMIT 100').all(),
    db.prepare('SELECT * FROM transactions ORDER BY date DESC LIMIT 100').all(),
  ]);

  const data = {
    people: people.results,
    events: events.results,
    interactions: interactions.results,
    projects: projects.results,
    transactions: transactions.results,
  };

  const prompt = `You are building a deeply reasoned personal intelligence profile for Courtney Remekie. This is NOT a data-formatting task. You must REASON and INFER the way a perceptive chief of staff would after reading thousands of emails and calendar entries.

REASONING RULES — apply these:
1. Infer people's real jobs from email domains and context. If Jayleen appears in emails from or related to @casa.ab.ca or CASA (Child and Adolescent Services Association of Alberta), note her day job. Same logic for any contact — domain = employer.
2. Infer relationship depth from frequency, directionality (who initiates), and response patterns.
3. Identify recurring commitments from calendar patterns — weekly/bi-weekly = standing obligation.
4. Detect project status from email thread activity — active thread = live project, silence = stalled.
5. Extract business intel from vendor, distributor, and retail email patterns (what products, volumes, suppliers).
6. Surface anything surprising or non-obvious — unexpected contacts, unusual spending, pattern breaks.
7. For family members especially: what do they actually DO? Cross-reference their emails, calendar invites, and communication patterns to build a full picture.
8. Writing style: infer from subject line patterns in sent emails — how does he phrase asks? How direct?

Base context (treat as confirmed, enrich from data):
- Senior Manager, Adobe AEM XSC, Americas. Team: John Green, Jim McGowan, Joe Bianco, Lisa Strickland, Liviu Chis.
- Founder, Zyra Spirits Inc. (Alberta craft vodka). Tyler Mulek = sales director + brother-in-law.
- Married to Jayleen. Son Theo (club soccer + football). Daughter Kyra (Red Deer Polytechnic).
- Edmonton, Alberta.

Data corpus (${interactions.results.length} interactions, ${people.results.length} people, ${events.results.length} events):
${JSON.stringify(data, null, 2)}

Return a JSON profile (pure JSON, no prose, no markdown fences):
{
  "identity": { "name": "Courtney Remekie", "pronouns": "he/him", "location": "Edmonton, Alberta", "timezone": "America/Edmonton", "roles": [], "philosophy": "" },
  "writingStyle": { "tone": "", "signoff": "Court", "slackStyle": "", "emailStyle": "", "patterns": [] },
  "keyPeople": {
    "adobe": [{"name":"","role":"","email":"","notes":""}],
    "zyra": [{"name":"","role":"","email":"","notes":""}],
    "family": [{"name":"","role":"","dayJob":"","email":"","notes":""}],
    "community": [{"name":"","role":"","email":"","notes":""}]
  },
  "activeProjects": [{"name":"","world":"","status":"","notes":""}],
  "spendingPatterns": {},
  "behaviorPatterns": { "peakHours": [], "ignoredTopics": [], "prioritySignals": [], "communicationPatterns": [] },
  "lastSynthesized": "${new Date().toISOString()}"
}`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': env.ANTHROPIC_API_KEY,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`);
  const claudeData = await claudeRes.json();
  const text = claudeData.content?.[0]?.text || '';

  // Extract JSON from response (Claude may wrap in ```json blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON');

  const profile = JSON.parse(jsonMatch[0]);
  await env.KV.put('brain:profile', JSON.stringify(profile));
  await env.KV.put('brain:lastsynced', new Date().toISOString());

  return { ok: true, synthesized_at: profile.lastSynthesized };
}

// ── Main worker ───────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': cors(origin),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Health check — no auth required
    if (path === '/' || path === '/health') {
      return json({
        status: 'ok',
        worker: 'jon-jon-brain',
        version: '1.0.0',
        ts: new Date().toISOString(),
        bindings: {
          d1: !!env.DB,
          kv: !!env.KV,
          r2: !!env.R2,
          vectorize: !!env.VECTORIZE,
        },
      }, 200, origin);
    }

    // ── Google OAuth — no brain token required ──

    if (path === '/auth/google' && request.method === 'GET') {
      const state = crypto.randomUUID();
      await env.KV.put('oauth:state', state, { expirationTtl: 600 });
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
    }

    if (path === '/auth/google/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const savedState = await env.KV.get('oauth:state');

      if (!code) return new Response('Missing code', { status: 400 });
      if (state !== savedState) return new Response('Invalid state — possible CSRF', { status: 403 });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return new Response(`Token exchange failed: ${err}`, { status: 500 });
      }

      const tokens = await tokenRes.json();
      tokens.obtained_at = Date.now();
      await env.KV.put('oauth:google:tokens', JSON.stringify(tokens));
      await env.KV.delete('oauth:state');

      return new Response(`
        <html><body style="font-family:sans-serif;padding:40px;max-width:400px;margin:auto">
          <h2>✅ Google connected</h2>
          <p>Jon Jon now has access to your Gmail, Calendar, and Drive.</p>
          <p>You can close this tab.</p>
        </body></html>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (path === '/auth/google/status' && request.method === 'GET') {
      const tokens = await env.KV.get('oauth:google:tokens', 'json');
      if (!tokens) return json({ connected: false, message: 'Visit /auth/google to connect' }, 200, origin);
      const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
      const expired = Date.now() > expiresAt;
      return json({
        connected: true,
        expired,
        expires_at: new Date(expiresAt).toISOString(),
        has_refresh_token: !!tokens.refresh_token,
        scopes: tokens.scope,
      }, 200, origin);
    }

    // ── All brain routes require Bearer auth ──

    if (!authOk(request, env)) {
      return json({ error: 'Unauthorized' }, 401, origin);
    }

    // POST /brain/init — create D1 schema (call once after deploy)
    if (path === '/brain/init' && request.method === 'POST') {
      try {
        await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
        return json({ ok: true, message: 'Schema initialized', tables: SCHEMA.length }, 200, origin);
      } catch (err) {
        return json({ error: err.message }, 500, origin);
      }
    }

    // GET /brain/status
    if (path === '/brain/status' && request.method === 'GET') {
      try {
        const [p, ev, tx, in_, pr] = await Promise.all([
          env.DB.prepare('SELECT COUNT(*) as n FROM people').first(),
          env.DB.prepare('SELECT COUNT(*) as n FROM events').first(),
          env.DB.prepare('SELECT COUNT(*) as n FROM transactions').first(),
          env.DB.prepare('SELECT COUNT(*) as n FROM interactions').first(),
          env.DB.prepare('SELECT COUNT(*) as n FROM projects').first(),
        ]);
        const lastSynced = await env.KV.get('brain:lastsynced');
        const googleStatus = await env.KV.get('oauth:google:tokens', 'json');
        return json({
          status: 'ok',
          counts: {
            people: p?.n ?? 0,
            events: ev?.n ?? 0,
            transactions: tx?.n ?? 0,
            interactions: in_?.n ?? 0,
            projects: pr?.n ?? 0,
          },
          last_synthesized: lastSynced,
          google_connected: !!googleStatus,
          ts: new Date().toISOString(),
        }, 200, origin);
      } catch {
        return json({ status: 'ok', counts: {}, note: 'Run POST /brain/init first' }, 200, origin);
      }
    }

    // GET /brain/profile
    if (path === '/brain/profile' && request.method === 'GET') {
      const profile = await env.KV.get('brain:profile', 'json');
      if (!profile) return json({ error: 'No profile yet — run POST /brain/synthesize' }, 404, origin);
      return json(profile, 200, origin);
    }

    // GET /brain/people
    if (path === '/brain/people' && request.method === 'GET') {
      const world = url.searchParams.get('world');
      const limit = Math.min(Number(url.searchParams.get('limit') || 50) || 50, 200);
      const stmt = world
        ? env.DB.prepare('SELECT * FROM people WHERE world = ? ORDER BY relationship_strength DESC LIMIT ?').bind(world, limit)
        : env.DB.prepare('SELECT * FROM people ORDER BY relationship_strength DESC LIMIT ?').bind(limit);
      const { results } = await stmt.all();
      return json({ people: results, count: results.length }, 200, origin);
    }

    // POST /brain/ingest
    if (path === '/brain/ingest' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }

      const { type } = body;

      try {
        let result;
        if (type === 'gmail') {
          result = await ingestGmail(env, env.DB);
        } else if (type === 'gcalendar') {
          result = await ingestCalendar(env, env.DB);
        } else if (type === 'gdrive') {
          result = await ingestDrive(env, env.DB);
        } else if (type === 'zyra_email') {
          result = await ingestZyraEmail(env.DB, body);
        } else if (['person', 'project', 'transaction'].includes(type)) {
          result = await ingestJson(env.DB, body);
        } else {
          return json({ error: `Unknown ingest type: ${type}. Supported: gmail, gcalendar, gdrive, zyra_email, person, project, transaction` }, 400, origin);
        }

        await env.KV.put('brain:needs_synthesis', 'true');
        return json({ ok: true, type, ...result }, 200, origin);
      } catch (err) {
        return json({ error: err.message }, 500, origin);
      }
    }

    // POST /brain/synthesize
    if (path === '/brain/synthesize' && request.method === 'POST') {
      try {
        const result = await synthesize(env, env.DB);
        await env.KV.delete('brain:needs_synthesis');
        return json(result, 200, origin);
      } catch (err) {
        return json({ error: err.message }, 500, origin);
      }
    }

    // POST /brain/interaction
    if (path === '/brain/interaction' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }

      const { type, source, content_summary, world } = body;
      if (!type || !source) return json({ error: 'Missing required fields: type, source' }, 400, origin);

      const id = `int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await env.DB.prepare(
        `INSERT INTO interactions (id, type, source, content_summary, world) VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, type, source, content_summary || null, world || null).run();

      return json({ ok: true, id }, 200, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  },
};
