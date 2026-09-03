import { buildFacetsQuery } from '../lib/sql-client.js';
import { RE_CODE, RE_UUID, readClientId, runQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const { id_client, error } = readClientId(url);
  if (error) return jsonResponse({ error }, 400);

  const p = { id_client };
  for (const key of ['code_mission_cae', 'code_mission_asso', 'statut_mission']) {
    const v = url.searchParams.get(key);
    if (v) {
      if (!RE_CODE.test(v)) return jsonResponse({ error: `${key} invalide` }, 400);
      p[key] = v;
    }
  }

  const missionIds = url.searchParams.get('mission_ids');
  if (missionIds) {
    const ids = [...new Set(missionIds.split(',').map((v) => v.trim()).filter(Boolean))];
    for (const id of ids) {
      if (!RE_UUID.test(id)) return jsonResponse({ error: 'mission_ids invalide' }, 400);
    }
    p.mission_ids = ids;
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  try {
    const rows = await runQuery(env, buildFacetsQuery(p));
    const villes = [...new Set(rows.map((r) => r.ville_emplacement).filter(Boolean))].sort();
    const emplacements = [...new Set(rows.map((r) => r.nom_emplacement).filter(Boolean))].sort();
    return jsonResponse({ villes, emplacements });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
