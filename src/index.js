// Point d'entrée unique du Worker (Cloudflare Workers + assets binding).
// Toutes les routes /api/* sont gérées ici ; le reste (HTML, CSS, JS
// statiques) est servi depuis ./public via le binding ASSETS.
//
// NB architecture : ce projet est provisionné côté Cloudflare comme un
// Worker avec build Git ("Workers Builds", commande de déploiement
// `npx wrangler deploy`), pas comme un projet Pages — d'où ce point
// d'entrée unique plutôt qu'un dossier functions/ (convention Pages
// Functions, incompatible avec `wrangler deploy`).

import {
  RE_UUID,
  RE_CODE,
  RE_DATE,
  readClientId,
  runQuery,
  runCardQuery,
  requireConfig,
  jsonResponse,
  sanitizeFreeText,
} from './lib/metabase.js';
import { buildQueries, buildFacetsQuery, buildMissionsListQuery } from './lib/sql-client.js';
import {
  buildMissionDaysQuery,
  buildMissionPerformanceQueries,
  buildRecruteurPerformanceQueries,
  buildResolveMissionIdQuery,
} from './lib/sql-mission.js';
import { buildChallengeQueries } from './lib/sql-challenge.js';
import { buildSalarieQueries } from './lib/sql-salarie.js';
import { buildEmplacementQueries } from './lib/sql-emplacement.js';
import { buildMobilisationQueries, rdInfoQuery } from './lib/sql-mobilisation.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/client') return await handleClient(url, env);
      if (url.pathname === '/api/facets') return await handleFacets(url, env);
      if (url.pathname === '/api/client-missions') return await handleClientMissions(url, env);
      if (url.pathname === '/api/mission-days') return await handleMissionDays(url, env);
      if (url.pathname === '/api/mission-performance') return await handleMissionPerformance(url, env);
      if (url.pathname === '/api/recruteur-performance') return await handleRecruteurPerformance(url, env);
      if (url.pathname === '/api/challenge') return await handleChallenge(env);
      if (url.pathname === '/api/salarie') return await handleSalarie(url, env);
      if (url.pathname === '/api/emplacement') return await handleEmplacement(url, env);
      if (url.pathname === '/api/re-mobilisation') return await handleReMobilisation(url, env);
      if (url.pathname === '/api/rd-mobilisation') return await handleRdMobilisation(url, env);
      if (url.pathname === '/api/rm-missions') return await handleRmMissions(env);
      if (url.pathname === '/api/logo') return await handleLogo(url, env);
    } catch (err) {
      return jsonResponse({ error: 'worker_exception', message: String((err && err.stack) || err) }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

// ---------------------------------------------------------------
// /api/client — dashboard client (client.html)
// ---------------------------------------------------------------
function readClientParams(url) {
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

async function handleClient(url, env) {
  const { params, error } = readClientParams(url);
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

async function handleFacets(url, env) {
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

async function handleClientMissions(url, env) {
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

// ---------------------------------------------------------------
// /api/mission-days, /api/mission-performance, /api/recruteur-performance
// ---------------------------------------------------------------

// Résout id_mission à partir des paramètres d'URL : accepte soit id_mission
// (UUID direct, cas normal — lien fourni depuis client.html/salarie.html/
// etc.), soit code_mission (résolu via une requête Metabase — cas de la
// modale ouverte depuis rm.html, qui ne connaît que le code puisque la
// question Metabase "Missions en cours" n'expose pas l'id).
async function resolveMissionId(url, env) {
  const idParam = url.searchParams.get('id_mission') || '';
  if (idParam) {
    if (!RE_UUID.test(idParam)) return { error: 'id_mission invalide' };
    return { id_mission: idParam };
  }

  const codeParam = url.searchParams.get('code_mission') || '';
  if (!codeParam) return { error: 'id_mission ou code_mission manquant' };
  if (!RE_CODE.test(codeParam)) return { error: 'code_mission invalide' };

  try {
    const rows = await runQuery(env, buildResolveMissionIdQuery(codeParam));
    if (!rows[0] || !rows[0].id) return { error: 'mission introuvable pour ce code_mission', notFound: true };
    return { id_mission: rows[0].id };
  } catch (e) {
    return { error: String(e.message || e), upstream: true };
  }
}

async function handleMissionDays(url, env) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const { id_mission, error, notFound, upstream } = await resolveMissionId(url, env);
  if (error) return jsonResponse({ error }, upstream ? 502 : notFound ? 404 : 400);

  try {
    const rows = await runQuery(env, buildMissionDaysQuery(id_mission));
    return jsonResponse(rows.map((r) => r.date));
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}

function readDatesParam(url) {
  const datesParam = url.searchParams.get('dates') || url.searchParams.get('date') || '';
  let dates = [];
  if (datesParam) {
    dates = [...new Set(datesParam.split(',').map((d) => d.trim()).filter(Boolean))];
    for (const d of dates) {
      if (!RE_DATE.test(d)) return { error: 'date invalide (format attendu AAAA-MM-JJ)' };
    }
  }
  return { dates };
}

async function handleMissionPerformance(url, env) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const resolved = await resolveMissionId(url, env);
  if (resolved.error) return jsonResponse({ error: resolved.error }, resolved.upstream ? 502 : resolved.notFound ? 404 : 400);
  const { id_mission } = resolved;

  const { dates, error } = readDatesParam(url);
  if (error) return jsonResponse({ error }, 400);

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

async function handleRecruteurPerformance(url, env) {
  const id_mission = url.searchParams.get('id_mission') || '';
  const id_utilisateur = url.searchParams.get('id_utilisateur') || '';

  if (!RE_UUID.test(id_mission)) {
    return jsonResponse({ error: 'id_mission manquant ou invalide' }, 400);
  }
  if (!RE_UUID.test(id_utilisateur)) {
    return jsonResponse({ error: 'id_utilisateur manquant ou invalide' }, 400);
  }

  const { dates, error } = readDatesParam(url);
  if (error) return jsonResponse({ error }, 400);

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildRecruteurPerformanceQueries(id_mission, id_utilisateur, dates);

  try {
    const [info, kpis, daily] = await Promise.all([
      runQuery(env, queries.info),
      runQuery(env, queries.kpis),
      runQuery(env, queries.daily),
    ]);
    return jsonResponse({ info: info[0] || null, kpis: kpis[0] || null, daily });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}

// ---------------------------------------------------------------
// /api/challenge
// ---------------------------------------------------------------
async function handleChallenge(env) {
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

// ---------------------------------------------------------------
// /api/salarie, /api/salarie-recherche
// ---------------------------------------------------------------
async function handleSalarie(url, env) {
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

// ---------------------------------------------------------------
// /api/emplacement
// ---------------------------------------------------------------
async function handleEmplacement(url, env) {
  const id_emplacement = url.searchParams.get('id_emplacement') || '';
  if (!RE_UUID.test(id_emplacement)) {
    return jsonResponse({ error: 'id_emplacement manquant ou invalide' }, 400);
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildEmplacementQueries(id_emplacement);

  try {
    const [info, missions, recruteurs] = await Promise.all([
      runQuery(env, queries.info),
      runQuery(env, queries.missions),
      runQuery(env, queries.recruteurs),
    ]);
    return jsonResponse({
      info: info[0] || null,
      missions,
      nb_recruteurs_distincts: (recruteurs[0] && recruteurs[0].nb_recruteurs) || 0,
    });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}

// ---------------------------------------------------------------
// /api/re-mobilisation, /api/rd-mobilisation
// ---------------------------------------------------------------
async function handleReMobilisation(url, env) {
  const id_mission = url.searchParams.get('mission_id') || '';
  if (!RE_UUID.test(id_mission)) {
    return jsonResponse({ error: 'mission_id manquant ou invalide' }, 400);
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildMobilisationQueries(id_mission, null);

  try {
    const [info, logementsGlobal, statut, tauxRencontre, habitations, parRd] = await Promise.all([
      runQuery(env, queries.info),
      runQuery(env, queries.logementsGlobal),
      runQuery(env, queries.statut),
      runQuery(env, queries.tauxRencontre),
      runQuery(env, queries.habitations),
      runQuery(env, queries.parRd),
    ]);
    return jsonResponse({
      info: info[0] || null,
      logementsGlobal: logementsGlobal[0] || null,
      statut,
      tauxRencontre: tauxRencontre[0] || null,
      habitations,
      parRd,
    });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}

async function handleRdMobilisation(url, env) {
  const id_mission = url.searchParams.get('mission_id') || '';
  const id_utilisateur = url.searchParams.get('user_id') || '';
  if (!RE_UUID.test(id_mission)) {
    return jsonResponse({ error: 'mission_id manquant ou invalide' }, 400);
  }
  if (!RE_UUID.test(id_utilisateur)) {
    return jsonResponse({ error: 'user_id manquant ou invalide' }, 400);
  }

  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);

  const queries = buildMobilisationQueries(id_mission, id_utilisateur);

  try {
    const [info, rd, logementsGlobal, statut, tauxRencontre, habitations] = await Promise.all([
      runQuery(env, queries.info),
      runQuery(env, rdInfoQuery(id_utilisateur)),
      runQuery(env, queries.logementsGlobal),
      runQuery(env, queries.statut),
      runQuery(env, queries.tauxRencontre),
      runQuery(env, queries.habitations),
    ]);
    return jsonResponse({
      info: info[0] || null,
      rd: rd[0] || null,
      logementsGlobal: logementsGlobal[0] || null,
      statut,
      tauxRencontre: tauxRencontre[0] || null,
      habitations,
    });
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 502);
  }
}

// ---------------------------------------------------------------
// /api/rm-missions
// ---------------------------------------------------------------
const CARD_MISSIONS_EN_COURS = 514;

async function handleRmMissions(env) {
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

// ---------------------------------------------------------------
// /api/logo — logo client via URL S3 pré-signée (Scaleway Object Storage)
// ---------------------------------------------------------------
const S3_BUCKET = 'captive-cae-production';
const S3_REGION = 'fr-par';
const S3_HOST = `${S3_BUCKET}.s3.${S3_REGION}.scw.cloud`;
const LOGO_CACHE_TTL = 1800;
const LOGO_URL_EXPIRES = 3600;

async function handleLogo(url, env) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);
  if (!env.SCW_ACCESS_KEY || !env.SCW_SECRET_KEY) {
    return jsonResponse(
      { error: 'missing_s3_credentials', message: 'SCW_ACCESS_KEY / SCW_SECRET_KEY ne sont pas configurées sur ce Worker.' },
      500
    );
  }

  const clientNameRaw = url.searchParams.get('client');
  if (!clientNameRaw) return jsonResponse({ error: 'missing_client' }, 400);
  const sanitized = sanitizeFreeText(clientNameRaw, 200);
  if (!sanitized || sanitized.error) return jsonResponse({ error: 'client invalide' }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/logo/${encodeURIComponent(clientNameRaw)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // logo_url_source (colonne directe sur clients, ex.
  // "gallery/2025-01-27/logosnsm....jpg") est la source privilégiée —
  // vérifié empiriquement : la clé pointe vers un objet du même bucket S3
  // (captive-cae-production), juste non public (403 sans signature), donc
  // signable avec presignS3GetUrl comme l'ancienne clé ActiveStorage.
  // Repli sur l'attachment ActiveStorage (clients.logo) pour les clients
  // qui n'ont pas encore de logo_url_source renseigné.
  const sql = `
    SELECT c.logo_url_source, b.key AS legacy_key
    FROM public.clients c
    LEFT JOIN public.active_storage_attachments a ON a.record_id = c.id AND a.record_type = 'Client' AND a.name = 'logo'
    LEFT JOIN public.active_storage_blobs b ON b.id = a.blob_id
    WHERE c.nom = '${sanitized.value}'
    LIMIT 1`;

  let rows;
  try {
    rows = await runQuery(env, sql);
  } catch (e) {
    return jsonResponse({ error: 'metabase_error', message: String(e.message || e) }, 502);
  }

  const row = rows[0];
  const key = row && (row.logo_url_source || row.legacy_key);
  if (!key) {
    return jsonResponse({ error: 'logo_not_found', client: clientNameRaw }, 404);
  }

  const signedUrl = await presignS3GetUrl(env, key, LOGO_URL_EXPIRES);
  const cacheable = new Response(null, {
    status: 302,
    headers: { Location: signedUrl, 'Cache-Control': `public, max-age=${LOGO_CACHE_TTL}` },
  });
  await cache.put(cacheKey, cacheable.clone());
  return cacheable;
}

async function presignS3GetUrl(env, objectKey, expiresSeconds) {
  const accessKey = env.SCW_ACCESS_KEY;
  const secretKey = env.SCW_SECRET_KEY;

  const now = new Date();
  const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const datestamp = amzdate.slice(0, 8);
  const credentialScope = `${datestamp}/${S3_REGION}/s3/aws4_request`;
  const canonicalURI = '/' + objectKey.split('/').map(encodeURIComponent).join('/');

  const queryParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${credentialScope}`,
    'X-Amz-Date': amzdate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuerystring = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${S3_HOST}\n`;
  const canonicalRequest = ['GET', canonicalURI, canonicalQuerystring, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzdate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmacRaw('AWS4' + secretKey, datestamp);
  const kRegion = await hmacRaw(kDate, S3_REGION);
  const kService = await hmacRaw(kRegion, 's3');
  const kSigning = await hmacRaw(kService, 'aws4_request');
  const signature = await hmacHex(kSigning, stringToSign);

  return `https://${S3_HOST}${canonicalURI}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
}

async function sha256Hex(message) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacRaw(key, message) {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)));
}
async function hmacHex(key, message) {
  const raw = await hmacRaw(key, message);
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}
