import { buildMissionsListQuery } from '../lib/sql-client.js';
import { readClientId, runQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const { id_client, error } = readClientId(url);
  if (error) return jsonResponse({ error }, 400);

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  try {
    const rows = await runQuery(env, buildMissionsListQuery(id_client));
    return jsonResponse(rows);
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
