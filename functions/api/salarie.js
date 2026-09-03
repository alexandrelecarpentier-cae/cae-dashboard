// /api/salarie?id_utilisateur=<uuid> — fiche individuelle d'un salarié
// (RD/RDC/RDE/RE/RM) : identité, historique de missions/contrats, indicateurs
// de performance par mission, résumé global.
import { buildSalarieQueries } from '../lib/sql-salarie.js';
import { RE_UUID, runQuery, requireConfig, jsonResponse } from '../lib/metabase.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id_utilisateur = url.searchParams.get('id_utilisateur') || '';
  if (!RE_UUID.test(id_utilisateur)) {
    return jsonResponse({ error: 'id_utilisateur manquant ou invalide' }, 400);
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildSalarieQueries(id_utilisateur);

  try {
    const [identite, missions, performance, resume] = await Promise.all([
      runQuery(env, queries.identite),
      runQuery(env, queries.missions),
      runQuery(env, queries.performance),
      runQuery(env, queries.resume),
    ]);

    // On fusionne missions + performance par mission_id côté serveur pour
    // simplifier le rendu côté client (une seule liste, pas deux à recroiser).
    const perfByMission = new Map(performance.map((p) => [p.mission_id, p]));
    const missionsAvecPerf = missions.map((m) => ({
      ...m,
      ...(perfByMission.get(m.mission_id) || { bs_reel: 0, heures_rue: 0, taux_reel: null }),
    }));

    return jsonResponse({
      identite: identite[0] || null,
      missions: missionsAvecPerf,
      resume: resume[0] || null,
    });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
