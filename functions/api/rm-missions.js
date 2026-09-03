// /api/rm-missions — vue RM globale : liste de TOUTES les missions en cours,
// tous clients confondus. Reprend telle quelle la question Metabase "Missions
// en cours" (id 514) plutôt que de la réécrire en SQL natif — c'est la même
// question qui alimente ce dashboard depuis le début.
import { runCardQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

const CARD_MISSIONS_EN_COURS = 514;

export async function onRequestGet({ env }) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  try {
    const data = await runCardQuery(env, CARD_MISSIONS_EN_COURS);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return jsonResponse({ error: 'metabase_error', message: String(e.message || e) }, 502);
  }
}
