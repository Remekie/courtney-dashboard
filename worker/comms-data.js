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

async function handleChat(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }

  const { message, history = [], tasks = [] } = body;
  if (!message) return jsonResponse({ error: 'Missing message' }, 400, origin);

  const all = {};
  await Promise.all(SOURCES.map(async (s) => {
    const raw = await env.COMMS_DATA.get(s);
    all[s] = raw ? JSON.parse(raw) : null;
  }));

  const tasksCtx = tasks.length
    ? `\n\nPending tasks: ${tasks.map((t) => `"${t.text}" [${t.tag}]`).join(', ')}`
    : '';
  const system = `You are Court's Co-worker, a personal assistant for Courtney Remekie (Adobe Solutions Consultant, Edmonton MDT).
Live comms data: ${JSON.stringify(all)}${tasksCtx}
Be concise. For write actions (send email, post to Slack, create calendar event), describe what you will do and ask for confirmation before acting.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': env.ANTHROPIC_API_KEY,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: [...history, { role: 'user', content: message }],
    }),
  });

  if (!res.ok) return jsonResponse({ error: 'Claude API error' }, 502, origin);
  const data = await res.json();
  const reply = data.content?.[0]?.text;
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
