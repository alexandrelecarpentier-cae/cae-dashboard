// Route /api/rrh — exécute les requêtes d'une section du dashboard RRH.
// Les requêtes d'une section sont lancées UNE PAR UNE (jamais en parallèle) :
// l'API Metabase renvoie un corps vide quand le pool de connexions est saturé.
import { runQuery, requireConfig, jsonResponse, RE_CODE, RE_DATE } from './metabase.js';
import { buildRrhQueries, SECTIONS } from './sql-rrh.js';

const MAX_LIGNES = 2000; // plafond de /api/dataset : au-delà, on prévient la page

export async function handleRrh(url, env) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const section = url.searchParams.get('section') || '';
  if (!Object.prototype.hasOwnProperty.call(SECTIONS, section)) return jsonResponse({ error: 'section inconnue' }, 400);

  const du = url.searchParams.get('du') || '';
  const au = url.searchParams.get('au') || '';
  if (du && !RE_DATE.test(du)) return jsonResponse({ error: 'du invalide' }, 400);
  if (au && !RE_DATE.test(au)) return jsonResponse({ error: 'au invalide' }, 400);
  if (du && au && du > au) return jsonResponse({ error: 'la date de début est après la date de fin' }, 400);
  const mission = url.searchParams.get('mission') || '';
  if (mission && !RE_CODE.test(mission)) return jsonResponse({ error: 'mission invalide' }, 400);
  const ville = url.searchParams.get('ville') || '';
  if (ville && !/^[A-Za-z]{3}$/.test(ville)) return jsonResponse({ error: 'ville invalide' }, 400);

  const queries = buildRrhQueries(section, {
    du, au, mission, ville,
    statut: url.searchParams.get('statut') || '',
    nature: url.searchParams.get('nature') || '',
  });

  const data = {};
  const truncated = [];
  try {
    for (const [name, sql] of Object.entries(queries)) {
      const rows = await runQuery(env, sql);
      if (rows.length >= MAX_LIGNES) truncated.push(name);
      data[name] = rows;
    }
  } catch (err) {
    return jsonResponse({ error: String((err && err.message) || err) }, 502);
  }
  return jsonResponse({ section, data, truncated });
}
