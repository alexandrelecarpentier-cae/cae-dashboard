// /api/logo?client=<nom> — logo d'un client, stocké via Rails ActiveStorage
// (bucket S3 privé Scaleway, même infra que le Worker RM). On récupère la
// clé S3 réelle par jointure clients → active_storage_attachments →
// active_storage_blobs, puis on génère une URL signée (AWS SigV4, Scaleway
// est compatible S3) et on redirige le navigateur dessus.
// Nécessite les secrets SCW_ACCESS_KEY et SCW_SECRET_KEY sur ce projet
// Pages (Settings > Environment variables) — droits lecture seule sur le
// bucket suffisent. Sans ces secrets configurés, l'endpoint renvoie une
// erreur 500 explicite plutôt qu'une image cassée silencieuse.
import { runQuery, requireConfig, jsonResponse, sanitizeFreeText } from '../lib/metabase.js';

const S3_BUCKET = 'captive-cae-production';
const S3_REGION = 'fr-par';
const S3_HOST = `${S3_BUCKET}.s3.${S3_REGION}.scw.cloud`;
const LOGO_CACHE_TTL = 1800; // 30 min — bien en-dessous de l'expiration de l'URL signée (1h)
const LOGO_URL_EXPIRES = 3600; // 1h

export async function onRequestGet({ request, env }) {
  const configError = requireConfig(env);
  if (configError) return jsonResponse({ error: configError }, 500);
  if (!env.SCW_ACCESS_KEY || !env.SCW_SECRET_KEY) {
    return jsonResponse(
      { error: 'missing_s3_credentials', message: "SCW_ACCESS_KEY / SCW_SECRET_KEY ne sont pas configurées sur ce projet Pages." },
      500
    );
  }

  const url = new URL(request.url);
  const clientNameRaw = url.searchParams.get('client');
  if (!clientNameRaw) return jsonResponse({ error: 'missing_client' }, 400);
  const sanitized = sanitizeFreeText(clientNameRaw, 200);
  if (!sanitized || sanitized.error) return jsonResponse({ error: 'client invalide' }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/logo/${encodeURIComponent(clientNameRaw)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const sql = `
    SELECT b.key
    FROM public.clients c
    JOIN public.active_storage_attachments a ON a.record_id = c.id AND a.record_type = 'Client' AND a.name = 'logo'
    JOIN public.active_storage_blobs b ON b.id = a.blob_id
    WHERE c.nom = '${sanitized.value}'
    LIMIT 1`;

  let rows;
  try {
    rows = await runQuery(env, sql);
  } catch (e) {
    return jsonResponse({ error: 'metabase_error', message: String(e.message || e) }, 502);
  }

  const key = rows[0] && rows[0].key;
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
