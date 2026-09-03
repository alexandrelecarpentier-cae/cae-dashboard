export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RE_CODE = /^[A-Za-z0-9_-]{1,30}$/;
export const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const GENRES = ['monsieur', 'madame'];
export const TRANCHES_AGE = ['18-20', '21-25', '26-35', '36-50', '50 et +'];
export const DATABASE_ID = 3; // base "Production" dans Metabase

export function readClientId(url) {
  const id_client = url.searchParams.get('id_client') || '';
  if (!RE_UUID.test(id_client)) return { error: 'id_client manquant ou invalide' };
  return { id_client };
}

// Pour les valeurs libres (ville, nom d'emplacement) : accents et apostrophes
// autorisés (données réelles type "INTERMARCHÉ GRADIGNAN", "L'Isle-Adam"),
// mais on échappe les apostrophes pour l'injection dans une chaîne SQL
// littérale, et on rejette tout ce qui ressemble à une tentative d'évasion
// (commentaires SQL, points-virgules).
export function sanitizeFreeText(value, maxLen = 100) {
  if (!value) return null;
  const v = String(value).slice(0, maxLen);
  if (/(--|\/\*|\*\/|;)/.test(v)) return { error: 'valeur invalide' };
  return { value: v.replace(/'/g, "''") };
}

export async function runQuery(env, sql) {
  const res = await fetch(`${env.METABASE_URL}/api/dataset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.METABASE_API_KEY,
    },
    body: JSON.stringify({
      database: DATABASE_ID,
      type: 'native',
      native: { query: sql },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Metabase ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const cols = (json.data?.cols || []).map((c) => c.name);
  const rows = json.data?.rows || [];
  return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// Interroge une question Metabase déjà construite par son ID (au lieu de SQL
// natif) — utilisé pour la vue RM globale, qui reprend telle quelle la
// question Metabase "Missions en cours" (id 514, toutes missions tous
// clients confondus) plutôt que de réécrire cette agrégation en SQL.
export async function runCardQuery(env, cardId, missionId) {
  const payload = {};
  if (missionId) {
    payload.parameters = [
      { type: 'id', target: ['variable', ['template-tag', 'mission_id']], value: missionId },
    ];
  }
  const res = await fetch(`${env.METABASE_URL}/api/card/${cardId}/query/json`, {
    method: 'POST',
    headers: { 'x-api-key': env.METABASE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Metabase ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function requireConfig(env) {
  if (!env.METABASE_URL || !env.METABASE_API_KEY) {
    return 'Configuration serveur incomplète (METABASE_URL / METABASE_API_KEY manquants)';
  }
  return null;
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
