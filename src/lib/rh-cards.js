// ---------------------------------------------------------------
// /api/rh-suivi et /api/rh-export — onglets du "Dashboard RH" Metabase (id 39)
//   rh-suivi  : Acompte et saisie, Commande Swile, Check RH paie, Expiration identité
//   rh-export : Export de paie, Export DPAE
// Chaque onglet = une ou plusieurs cartes du dashboard, appelées avec les
// filtres du dashboard (cf. runDashcardQuery). Pas de SQL du projet ici : la
// logique reste celle des cartes Metabase (source de vérité unique).
// ---------------------------------------------------------------
import { runDashcardQuery, fetchDashboardParamValues, requireConfig, jsonResponse } from './metabase.js';
import { EXCLUDED_CLIENT_NAMES } from './excluded-clients.js';

// Filtres du dashboard 39 : id Metabase + type + forme de la valeur attendue.
const FILTERS = {
  date: { id: '5c991c36', type: 'date/all-options', list: false },
  code: { id: 'c00e6f0c', type: 'string/contains', list: true },
  nom: { id: '8201c7ff', type: 'string/=', list: true },
  client: { id: 'ff6d4236', type: 'string/=', list: true },
  tr: { id: '712d205c', type: 'string/=', list: true },
};

// dashcard = id de la carte dans le dashboard, card = id de la question.
// filters = filtres du dashboard réellement branchés sur cette carte.
const TABS = {
  suivi: {
    acompte: { cards: [{ title: 'Acompte et saisie', dashcard: 686, card: 552, filters: ['date', 'nom', 'code'] }] },
    swile: { cards: [{ title: 'Commande Swile', dashcard: 355, card: 278, filters: ['date', 'tr', 'nom'] }] },
    check: { cards: [{ title: 'Check RH paie', dashcard: 644, card: 519, filters: ['date', 'code', 'client', 'nom'] }] },
    identite: {
      cards: [{ title: 'Expiration identité', dashcard: 687, card: 553, filters: [] }],
      note: "Liste les salariés qui sont planifiés sur une mission dans les 50 prochains jours et dont la date de validité du document renseigné dans le dossier est vide ou expire dans les 30 prochains jours.",
    },
  },
  export: {
    paie: {
      cards: [
        { title: 'Export de paie', dashcard: 351, card: 290, filters: ['date'], postFilters: ['nom'] },
        { title: 'Absences (export paie 2)', dashcard: 665, card: 540, filters: ['code', 'date', 'nom', 'client'] },
      ],
    },
    dpae: { cards: [{ title: 'Export DPAE', dashcard: 502, card: 384, filters: ['date', 'code'] }] },
  },
};

const RE_DATE_PRESET = /^(today|yesterday|past7days|past30days|thisweek|lastweek|thismonth|lastmonth|thisyear|lastyear)$/;
const RE_DATE_RANGE = /^\d{4}-\d{2}-\d{2}(~\d{4}-\d{2}-\d{2})?$/;
const RE_CODE_MISSION = /^[A-Za-z0-9_-]{1,30}$/;

function readFilterValue(url, key) {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === '') return { value: null };
  if (key === 'date') {
    if (!RE_DATE_PRESET.test(raw) && !RE_DATE_RANGE.test(raw)) return { error: 'date invalide' };
    return { value: raw };
  }
  if (key === 'code') {
    if (!RE_CODE_MISSION.test(raw)) return { error: 'code mission invalide' };
    return { value: raw };
  }
  const v = String(raw).trim().slice(0, 100);
  // Ces valeurs partent dans un paramètre Metabase structuré (pas dans du SQL),
  // on écarte seulement les caractères de contrôle.
  if (/[\u0000-\u001f]/.test(v)) return { error: `${key} invalide` };
  return { value: v };
}

function buildParameters(url, filterKeys) {
  const parameters = [];
  for (const key of filterKeys) {
    const { value, error } = readFilterValue(url, key);
    if (error) return { error };
    if (value == null) continue;
    const f = FILTERS[key];
    parameters.push({ id: f.id, type: f.type, value: f.list ? [value] : value });
  }
  return { parameters };
}

// Les cartes ne permettent pas de filtrer les clients exclus en amont : quand
// une colonne "Clients → Nom" est présente, on écarte ces lignes après coup
// (même logique que /api/rm-missions).
function dropExcludedClients(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => !(r && EXCLUDED_CLIENT_NAMES.includes(r['Clients → Nom'])));
}

function applyPostFilters(rows, url, keys) {
  if (!keys || !keys.length) return rows;
  let out = rows;
  for (const key of keys) {
    const { value } = readFilterValue(url, key);
    if (value == null) continue;
    const needle = String(value).toLowerCase();
    out = out.filter((r) => Object.values(r || {}).some((x) => x != null && String(x).toLowerCase().includes(needle)));
  }
  return out;
}

async function handleRhCards(url, env, group) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const tabKey = url.searchParams.get('tab') || '';
  const tab = Object.prototype.hasOwnProperty.call(TABS[group], tabKey) ? TABS[group][tabKey] : null;
  if (!tab) return jsonResponse({ error: 'onglet inconnu' }, 400);

  try {
    const calls = [];
    for (const c of tab.cards) {
      const { parameters, error } = buildParameters(url, c.filters);
      if (error) return jsonResponse({ error }, 400);
      calls.push(runDashcardQuery(env, c.dashcard, c.card, parameters));
    }
    const results = await Promise.all(calls);
    const tables = tab.cards.map((c, i) => ({
      title: c.title,
      filters: c.filters,
      // postFilters = filtres que la carte Metabase ignore : appliqués ici sur le texte des lignes.
      rows: applyPostFilters(dropExcludedClients(results[i]), url, c.postFilters),
      applied: [...c.filters, ...(c.postFilters || [])],
    }));
    return jsonResponse({ tab: tabKey, note: tab.note || null, tables, generated_at: new Date().toISOString() });
  } catch (e) {
    return jsonResponse({ error: 'metabase_error', message: String(e.message || e) }, 502);
  }
}

export function handleRhSuivi(url, env) {
  return handleRhCards(url, env, 'suivi');
}

export function handleRhExport(url, env) {
  return handleRhCards(url, env, 'export');
}

// /api/rh-values?param=client|tr|nom&q=... — options des filtres (menus et
// autocomplétion du nom) lues sur les filtres du dashboard Metabase.
export async function handleRhValues(url, env) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const key = url.searchParams.get('param') || '';
  if (!['client', 'tr', 'nom'].includes(key)) return jsonResponse({ error: 'param invalide' }, 400);
  let q = (url.searchParams.get('q') || '').trim().slice(0, 50);
  if (/[\u0000-\u001f/?#]/.test(q)) return jsonResponse({ error: 'q invalide' }, 400);
  if (key === 'nom' && q.length < 2) return jsonResponse({ values: [] });
  if (key !== 'nom') q = '';

  try {
    let values = await fetchDashboardParamValues(env, FILTERS[key].id, q || null);
    if (key === 'client') values = values.filter((v) => !EXCLUDED_CLIENT_NAMES.includes(v));
    return jsonResponse({ values: values.slice(0, 200) });
  } catch (e) {
    return jsonResponse({ error: 'metabase_error', message: String(e.message || e) }, 502);
  }
}
