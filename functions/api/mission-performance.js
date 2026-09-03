import { buildMissionPerformanceQueries } from '../lib/sql-mission.js';
import { RE_UUID, RE_DATE, runQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id_mission = url.searchParams.get('id_mission') || '';
  if (!RE_UUID.test(id_mission)) {
    return jsonResponse({ error: 'id_mission manquant ou invalide' }, 400);
  }

  const datesParam = url.searchParams.get('dates') || url.searchParams.get('date') || '';
  let dates = [];
  if (datesParam) {
    dates = [...new Set(datesParam.split(',').map((d) => d.trim()).filter(Boolean))];
    for (const d of dates) {
      if (!RE_DATE.test(d)) return jsonResponse({ error: 'date invalide (format attendu AAAA-MM-JJ)' }, 400);
    }
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildMissionPerformanceQueries(id_mission, dates);

  try {
    const [info, recruteurs] = await Promise.all([
      runQuery(env, queries.info),
      runQuery(env, queries.recruteurs),
    ]);
    return jsonResponse({ info: info[0] || null, recruteurs });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
