// /api/salarie-recherche?q=<texte> — recherche d'un salarié par nom/prénom,
// pour l'écran de sélection de /salarie.html quand aucun id_utilisateur
// n'est encore connu dans l'URL.
import { buildRechercheQuery } from '../lib/sql-salarie.js';
import { runQuery, requireConfig, jsonResponse, sanitizeFreeText } from '../lib/metabase.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  if (q.trim().length < 2) {
    return jsonResponse({ error: 'q doit contenir au moins 2 caractères' }, 400);
  }
  const sanitized = sanitizeFreeText(q, 100);
  if (!sanitized || sanitized.error) return jsonResponse({ error: 'q invalide' }, 400);

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  try {
    const rows = await runQuery(env, buildRechercheQuery(sanitized.value));
    return jsonResponse({ results: rows });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}
