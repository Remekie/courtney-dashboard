/**
 * Comms Data Worker — comms-data.remekie.workers.dev
 *
 * GET  /data          → returns all stored comms data as JSON
 * GET  /data/:source  → returns one source (slack|teams|outlook|gmail|calendar)
 * POST /data/:source  → stores data for a source (requires Bearer token)
 * POST /data          → stores full payload at once (requires Bearer token)
 *
 * KV binding: COMMS_DATA
 * Env secret: WRITE_TOKEN
 */

const SOURCES = ['slack', 'teams', 'outlook', 'gmail', 'gcalendar', 'messages', 'whatsapp', 'zyra', 'gdrive'];
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
