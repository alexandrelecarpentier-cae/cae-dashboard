// Protection par mot de passe de /planning-cae (page statique "données
// figées" : sans ce garde-fou, public/planning-cae.html est servi à tous).
// Le mot de passe est le secret Worker PLANNING_PASSWORD (jamais dans le
// dépôt). Session = cookie HttpOnly signé HMAC (30 jours) ; changer le
// secret invalide toutes les sessions existantes.

const COOKIE = 'planning_auth';
const MAX_AGE = 60 * 60 * 24 * 30;
const enc = new TextEncoder();

// Couvre /planning-cae, /planning-cae/, /planning-cae.html, /planning-cae/index.html
export function isPlanningPath(pathname) {
  return /^\/planning-cae(\.html|\/(index(\.html)?)?)?$/i.test(pathname);
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

async function hasValidSession(request, secret) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]+)`));
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  return safeEqual(m[2], await sign(secret, `planning-cae:${m[1]}`));
}

function loginPage(error) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Planning CAE — accès protégé</title>
<style>body{font-family:system-ui,sans-serif;background:#f2f4f7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 12px #0002;width:min(92vw,340px)}
h1{font-size:1.1rem;margin:0 0 1rem}input,button{width:100%;padding:.65rem;font-size:1rem;box-sizing:border-box;border-radius:8px}
input{border:1px solid #c9d0db;margin-bottom:.8rem}button{border:0;background:#1d4ed8;color:#fff;cursor:pointer}.e{color:#c23d28;margin:0 0 .8rem;font-size:.9rem}</style></head>
<body><form method="POST"><h1>Planning CAE</h1>${error ? '<p class="e">Mot de passe incorrect.</p>' : ''}
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
    const token = `${exp}.${await sign(secret, `planning-cae:${exp}`)}`;
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
