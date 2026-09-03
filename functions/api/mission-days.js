import { buildMissionDaysQuery } from '../lib/sql-mission.js';
import { RE_UUID, runQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id_mission = url.searchParams.get('id_mission') || '';
  if (!RE_UUID.test(id_mission)) {
    return jsonResponse({ error: 'id_mission manquant ou invalide' }, 400);
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  try {
    const rows = await runQuery(env, buildMissionDaysQuery(id_mission));
    return jsonResponse(rows.map((r) => r.date));
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
