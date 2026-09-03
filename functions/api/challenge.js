import { buildChallengeQueries } from '../lib/sql-challenge.js';
import { runQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

// Page interne "Challenge" : aucune donnée d'entrée utilisateur, pas de
// scope client/mission — classements cross-client sur toutes les missions
// en_cours. Voir sql-challenge.js pour le détail des règles.
export async function onRequestGet({ env }) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildChallengeQueries();

  try {
    const [hourlyTop, dailyTop, weeklyTop, weeklyTeams, ageMoyenTop, activeRecruteurs] = await Promise.all([
      runQuery(env, queries.hourlyTop),
      runQuery(env, queries.dailyTop),
      runQuery(env, queries.weeklyTop),
      runQuery(env, queries.weeklyTeams),
      runQuery(env, queries.ageMoyenTop),
      runQuery(env, queries.activeRecruteurs),
    ]);
    return jsonResponse({ hourlyTop, dailyTop, weeklyTop, weeklyTeams, ageMoyenTop, activeRecruteurs });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
