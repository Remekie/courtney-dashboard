/**
 * Comms Data Worker — comms-data.remekie.workers.dev
 *
 * GET  /data          → returns all stored comms data as JSON
 * GET  /data/:source  → returns one source (slack|teams|outlook|gmail|calendar)
 * POST /data/:source  → stores data for a source (requires Bearer token)
 * POST /data          → stores full payload at once (requires Bearer token)
 * POST /chat          → Claude API proxy; body: { message, history[] }
 *
 * KV binding: COMMS_DATA
 * Env secrets: WRITE_TOKEN, ANTHROPIC_API_KEY
 */

const SOURCES = ['slack', 'teams', 'outlook', 'gmail', 'gcalendar', 'messages', 'whatsapp', 'zyra', 'gdrive', 'tasks'];
const CACHE_TTL = 300; // 5 minutes browser cache

function cors(origin) {
  const allowed = [
    'https://main--courtney-dashboard--remekie.aem.live',
    'https://main--courtney-dashboard--remekie.aem.page',
    'https://remekie.github.io',
    'http://localhost:3000',
    'http://localhost:3001',
  ];
  return allowed.includes(origin) ? origin : allowed[0];
}

function jsonResponse(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': cors(origin),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': status === 200 ? `public, max-age=${CACHE_TTL}` : 'no-store',
    },
  });
}

async function handleGet(source, env, origin) {
  if (source && !SOURCES.includes(source)) {
    return jsonResponse({ error: 'Unknown source' }, 400, origin);
  }

  if (source) {
    const raw = await env.COMMS_DATA.get(source);
    if (!raw) return jsonResponse({ source, data: null, updatedAt: null }, 200, origin);
    return jsonResponse(JSON.parse(raw), 200, origin);
  }

  const all = {};
  await Promise.all(
    SOURCES.map(async (s) => {
      const raw = await env.COMMS_DATA.get(s);
      all[s] = raw ? JSON.parse(raw) : null;
    }),
  );
  return jsonResponse(all, 200, origin);
}

async function handlePost(source, request, env, origin) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.WRITE_TOKEN) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
  }

  if (source) {
    if (!SOURCES.includes(source)) {
      return jsonResponse({ error: 'Unknown source' }, 400, origin);
    }
    const payload = { source, updatedAt: new Date().toISOString(), data: body };
    await env.COMMS_DATA.put(source, JSON.stringify(payload));
    return jsonResponse({ ok: true, source, updatedAt: payload.updatedAt }, 200, origin);
  }

  // Full payload: { slack: {...}, teams: {...}, ... }
  const results = {};
  await Promise.all(
    SOURCES.map(async (s) => {
      if (body[s] !== undefined) {
        const payload = { source: s, updatedAt: new Date().toISOString(), data: body[s] };
        await env.COMMS_DATA.put(s, JSON.stringify(payload));
        results[s] = { ok: true, updatedAt: payload.updatedAt };
      }
    }),
  );
  return jsonResponse({ ok: true, results }, 200, origin);
}

async function getBrainProfile(env) {
  try {
    const cached = await env.COMMS_DATA.get('brain:profile:cache', 'json');
    if (cached) return cached;
    const res = await fetch('https://brain.compass-xsc.workers.dev/brain/profile', {
      headers: { Authorization: `Bearer ${env.BRAIN_TOKEN}` },
    });
    if (!res.ok) return null;
    const profile = await res.json();
    await env.COMMS_DATA.put('brain:profile:cache', JSON.stringify(profile), { expirationTtl: 3600 });
    return profile;
  } catch {
    return null;
  }
}

async function webSearch(query) {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    );
    const d = await res.json();
    const parts = [];
    if (d.Answer) parts.push(d.Answer);
    if (d.AbstractText) parts.push(d.AbstractText);
    (d.RelatedTopics || []).slice(0, 4).forEach((t) => { if (t.Text) parts.push(t.Text); });
    return parts.length ? parts.join('\n') : 'No results found.';
  } catch {
    return 'Search unavailable.';
  }
}

async function handleChat(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }

  const { message, history = [], tasks = [] } = body;
  if (!message) return jsonResponse({ error: 'Missing message' }, 400, origin);

  const [all, brain] = await Promise.all([
    Promise.all(SOURCES.map(async (s) => {
      const raw = await env.COMMS_DATA.get(s);
      return [s, raw ? JSON.parse(raw) : null];
    })).then(Object.fromEntries),
    getBrainProfile(env),
  ]);

  const tasksCtx = tasks.length
    ? `\n\nPending tasks: ${tasks.map((t) => `"${t.text}" [${t.tag}]`).join(', ')}`
    : '';

  const brainCtx = brain ? `

BRAIN PROFILE (synthesized from full email, calendar and Drive history):
Key people Adobe: ${(brain.keyPeople?.adobe || []).map((p) => `${p.name} — ${p.role}`).join('; ')}
Key people Zyra: ${(brain.keyPeople?.zyra || []).map((p) => `${p.name} — ${p.role}`).join('; ')}
Family: ${(brain.keyPeople?.family || []).map((p) => `${p.name} — ${p.role}`).join('; ')}
Active projects: ${(brain.activeProjects || []).map((p) => p.name).join(', ')}
Writing style: ${brain.writingStyle?.tone || ''}
Behavior patterns: ${JSON.stringify(brain.behaviorPatterns || {})}
Spending patterns: ${JSON.stringify(brain.spendingPatterns || {})}` : '';

  const system = `You are Jon Jon, personal chief of staff for Courtney Remekie. You know him deeply.

WHO HE IS:
- Senior Manager, Adobe AEM XSC (Expert Solution Consultants) — Americas. Team: John Green, Jim McGowan, Joe Bianco, Lisa Strickland, Liviu Chis.
- Founder, Zyra Spirits Inc. (Alberta craft vodka: Gold, Coco Mist, Root Beer Rush). Retail: Co-op (5 locations). On-premise: Hudson's, GRETA, Public Exchange, Azucar.
- Married to Jayleen (Pop Top Cocktails). Son Theo (club soccer + football). Daughter (Red Deer Polytechnic, college soccer).
- Edmonton, Alberta. Timezone: America/Edmonton. Philosophy: efficiency over optics, no fluff, numbers-forward.

KEY PEOPLE:
Adobe — Bill Lofft (direct manager, flag as urgent), Jeff Figueiredo (skip-level, flag as urgent), John Green, Jim McGowan, Joe Bianco, Lisa Strickland, Liviu Chis
Zyra — Tyler Mulek (sales director, brother-in-law), Scott Laurie (Co-op buyer), Manny (Azucar), Kennedy (Red Bull Edmonton)
Family — Jayleen, Theo, Kyra (daughter)

STYLE: Direct, signs off "Court". Slack: punchy + emoji. Email: structured, plain text URLs. Always include numbers.${brainCtx}

Live comms data: ${JSON.stringify(all)}${tasksCtx}

You can search the web for current information. Be concise. For write actions, describe and confirm before acting.`;

  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];

  const callClaude = (msgs) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'x-api-key': env.ANTHROPIC_API_KEY,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      tools,
      messages: msgs,
    }),
  });

  const msgs = [...history, { role: 'user', content: message }];
  let res = await callClaude(msgs);
  if (!res.ok) return jsonResponse({ error: 'Claude API error' }, 502, origin);
  let data = await res.json();

  // Tool use loop — handles web_search rounds
  let rounds = 0;
  while (data.stop_reason === 'tool_use' && rounds < 3) {
    rounds++;
    const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use');
    msgs.push({ role: 'assistant', content: data.content });
    const toolResults = await Promise.all(toolUseBlocks.map(async (b) => ({
      type: 'tool_result',
      tool_use_id: b.id,
      content: b.name === 'web_search' ? await webSearch(b.input?.query || '') : '',
    })));
    msgs.push({ role: 'user', content: toolResults });
    res = await callClaude(msgs);
    if (!res.ok) break;
    data = await res.json();
  }

  const reply = data.content?.find((b) => b.type === 'text')?.text;
  if (!reply) return jsonResponse({ error: 'Empty response from Claude' }, 502, origin);
  return jsonResponse({ reply }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/+/, '').split('/');

    // OPTIONS preflight
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

    // Chat: POST /chat
    if (parts[0] === 'chat' && request.method === 'POST') return handleChat(request, env, origin);

    // Route: /data or /data/:source
    if (parts[0] === 'data') {
      const source = parts[1] || null;
      if (request.method === 'GET') return handleGet(source, env, origin);
      if (request.method === 'POST') return handlePost(source, request, env, origin);
    }

    // Health check
    if (parts[0] === 'health') {
      return jsonResponse({ ok: true, ts: new Date().toISOString() }, 200, origin);
    }

    return jsonResponse({ error: 'Not found' }, 404, origin);
  },
};
