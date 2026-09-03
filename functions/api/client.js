import { buildQueries } from '../lib/sql-client.js';
import {
  RE_CODE, RE_DATE, RE_UUID,
  readClientId, runQuery, requireConfig, jsonResponse, sanitizeFreeText,
} from '../lib/metabase.js';

function readParams(url) {
  const { id_client, error } = readClientId(url);
  if (error) return { error };

  const p = { id_client };
  const q = url.searchParams;

  for (const key of ['code_mission_cae', 'code_mission_asso', 'statut_mission']) {
    const v = q.get(key);
    if (v) {
      if (!RE_CODE.test(v)) return { error: `${key} invalide` };
      p[key] = v;
    }
  }

  for (const key of ['debut_mission', 'fin_mission', 'date_min', 'date_max']) {
    const v = q.get(key);
    if (v) {
      if (!RE_DATE.test(v)) return { error: `${key} invalide (format attendu AAAA-MM-JJ)` };
      p[key] = v;
    }
  }

  const jour = q.get('jour_semaine');
  if (jour) {
    const n = Number(jour);
    if (!Number.isInteger(n) || n < 1 || n > 7) return { error: 'jour_semaine invalide (1=lundi..7=dimanche)' };
    p.jour_semaine = n;
  }

  for (const key of ['emplacement']) {
    const v = q.get(key);
    if (v) {
      const r = sanitizeFreeText(v);
      if (r.error) return { error: `${key} invalide` };
      p[key] = r.value;
    }
  }

  const missionIds = q.get('mission_ids');
  if (missionIds) {
    const ids = [...new Set(missionIds.split(',').map((v) => v.trim()).filter(Boolean))];
    for (const id of ids) {
      if (!RE_UUID.test(id)) return { error: 'mission_ids invalide' };
    }
    p.mission_ids = ids;
  }

  return { params: p };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const { params, error } = readParams(url);
  if (error) return jsonResponse({ error }, 400);

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildQueries(params);

  try {
    const entries = Object.entries(queries);
    const results = await Promise.all(entries.map(([, sql]) => runQuery(env, sql)));
    const payload = Object.fromEntries(entries.map(([key], i) => [key, results[i]]));
    payload.kpis = payload.kpis[0] || null;
    payload.info = payload.info[0] || null;
    return jsonResponse(payload);
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
