// /api/emplacement?id_emplacement=<uuid> — fiche d'un emplacement : info,
// missions passées à cet endroit avec indicateurs, comparaison aux autres
// emplacements.
import { buildEmplacementQueries } from '../lib/sql-emplacement.js';
import { RE_UUID, runQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id_emplacement = url.searchParams.get('id_emplacement') || '';
  if (!RE_UUID.test(id_emplacement)) {
    return jsonResponse({ error: 'id_emplacement manquant ou invalide' }, 400);
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildEmplacementQueries(id_emplacement);

  try {
    const [info, missions, comparaison] = await Promise.all([
      runQuery(env, queries.info),
      runQuery(env, queries.missions),
      runQuery(env, queries.comparaison),
    ]);
    return jsonResponse({ info: info[0] || null, missions, comparaison });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
