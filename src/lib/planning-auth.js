// Protection par mot de passe de /moteur-planning (page statique "données
// figées" : sans ce garde-fou, public/moteur-planning.html est servi à tous).
// Le mot de passe est le secret Worker PLANNING_PASSWORD (jamais dans le
// dépôt). Session = cookie HttpOnly signé HMAC (30 jours) ; changer le
// secret invalide toutes les sessions existantes.

const COOKIE = 'planning_auth';
const MAX_AGE = 60 * 60 * 24 * 30;
const enc = new TextEncoder();

// Couvre /moteur-planning, /moteur-planning/, /moteur-planning.html, /moteur-planning/index.html
export function isPlanningPath(pathname) {
  return /^\/moteur-planning(\.html|\/(index(\.html)?)?)?$/i.test(pathname);
}

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

async function hasValidSession(request, secret, cookie = COOKIE, scope = 'moteur-planning') {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${cookie}=(\\d+)\\.([0-9a-f]+)`));
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  return safeEqual(m[2], await sign(secret, `${scope}:${m[1]}`));
}

function loginPage(error, title = 'Planning CAE') {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — accès protégé</title>
<style>body{font-family:system-ui,sans-serif;background:#f2f4f7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 12px #0002;width:min(92vw,340px)}
h1{font-size:1.1rem;margin:0 0 1rem}input,button{width:100%;padding:.65rem;font-size:1rem;box-sizing:border-box;border-radius:8px}
input{border:1px solid #c9d0db;margin-bottom:.8rem}button{border:0;background:#1d4ed8;color:#fff;cursor:pointer}.e{color:#c23d28;margin:0 0 .8rem;font-size:.9rem}</style></head>
<body><form method="POST"><h1>${title}</h1>${error ? '<p class="e">Mot de passe incorrect.</p>' : ''}
<input type="password" name="password" placeholder="Mot de passe" autofocus required autocomplete="current-password"><button type="submit">Accéder</button></form></body></html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

// Renvoie une Response (login / redirection) ou null si l'accès est autorisé.
export async function guardPlanning(request, env) {
  const secret = env.PLANNING_PASSWORD;
  if (!secret) {
    return new Response('Accès indisponible : secret PLANNING_PASSWORD non configuré.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'POST') {
    let pwd = '';
    try { pwd = String((await request.formData()).get('password') || ''); } catch (_) {}
    if (!safeEqual(pwd, secret)) return loginPage(true);
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
    const token = `${exp}.${await sign(secret, `moteur-planning:${exp}`)}`;
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(request.url).pathname,
        'Set-Cookie': `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      },
    });
  }
  if (await hasValidSession(request, secret)) return null;
  return loginPage(false);
}

// ---------------------------------------------------------------
// /anne (page + /api/anne) : même mot de passe (secret PLANNING_PASSWORD),
// cookie et portée de signature distincts. L'API répond 401 JSON sans session.
// ---------------------------------------------------------------
const ANNE_COOKIE = 'anne_auth';

export function isAnnePath(pathname) {
  return /^\/anne(\.html|\/(index(\.html)?)?)?$/i.test(pathname) || pathname === '/api/anne';
}

export async function guardAnne(request, env) {
  const secret = env.PLANNING_PASSWORD;
  const url = new URL(request.url);
  const isApi = url.pathname === '/api/anne';
  if (!secret) {
    return new Response('Accès indisponible : secret PLANNING_PASSWORD non configuré.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (await hasValidSession(request, secret, ANNE_COOKIE, 'anne')) return null;
  if (isApi) {
    return new Response(JSON.stringify({ error: 'non_authentifie' }), { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'POST') {
    let pwd = '';
    try { pwd = String((await request.formData()).get('password') || ''); } catch (_) {}
    if (!safeEqual(pwd, secret)) return loginPage(true, 'Anne');
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
    const token = `${exp}.${await sign(secret, `anne:${exp}`)}`;
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.pathname + url.search,
        'Set-Cookie': `${ANNE_COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return loginPage(false, 'Anne');
}
