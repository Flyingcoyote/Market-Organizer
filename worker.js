// Cloudflare Worker — Finnhub proxy (Service Worker format)
// Upload this file at dash.cloudflare.com → Workers & Pages → Create → Upload
// After deploying: Settings → Variables and Secrets → add Secret named FINNHUB_KEY

const ALLOWED_ORIGIN = '*'; // Change to your GitHub Pages URL once live
                             // e.g. 'https://yourusername.github.io'

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const symbol = url.searchParams.get('symbol');

  if (path === '/quote') {
    if (!symbol) return jsonError('Missing symbol', 400);
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return jsonError('Finnhub error', res.status);
    return jsonResponse(await res.json());
  }

  if (path === '/profile') {
    if (!symbol) return jsonError('Missing symbol', 400);
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return jsonError('Finnhub error', res.status);
    return jsonResponse(await res.json());
  }

  if (path === '/ws-token') {
    return jsonResponse({ token: FINNHUB_KEY });
  }

  return jsonError('Not found', 404);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=15',
      ...corsHeaders(),
    },
  });
}

function jsonError(msg, status) {
  return jsonResponse({ error: msg }, status);
}
