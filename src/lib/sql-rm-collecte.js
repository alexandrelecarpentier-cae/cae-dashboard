// Requêtes SQL pour le dashboard "RM — Collecte" (/rm-collecte.html) : vue
// cross-missions filtrée par RM (responsable_mission_id) et/ou association
// (client_id), sur une plage de dates optionnelle — table de missions,
// camemberts âge/genre des donateurs, et une liste des bulletins suspects
// toutes missions filtrées confondues (dons annulés inclus, avec leur
// statut affiché et une colonne Mission). Porté depuis un prototype
// autonome (terrain_dashboard_rm_standalone.html) qui se connectait
// directement à Metabase depuis le navigateur — ici les mêmes requêtes
// tournent côté serveur, comme partout ailleurs dans ce projet.
//
// Contrairement aux dashboards /rd, /mission et /re-collecte (scopés sur
// UNE mission via id_mission), ce dashboard n'a pas de mission cible fixe :
// rm_id et client_id sont tous deux optionnels (aucun des deux filtré =
// toutes les missions), et la plage de dates filtre les missions "en
// cours" par chevauchement d'intervalle plutôt que par date des lots.

import { donMotifCase } from './sql-rd.js';
import { excludeClientsClause, excludeClientsDirectClause } from './excluded-clients.js';

// Missions annulées dans la réalité métier mais dont statut_mission n'a
// pas (encore) été mis à jour côté base — à exclure manuellement en plus
// du filtre sur statut_mission. Reprend telle quelle la liste du
// prototype d'origine.
const MANUALLY_CANCELLED_MISSIONS = ['26SAM04PAR'];

function dateRangeClause(col, dateRange) {
  return dateRange ? `AND ${col} BETWEEN '${dateRange.from}' AND '${dateRange.to}'` : '';
}

// Par défaut "jusqu'à aujourd'hui" quand aucune plage n'est fournie —
// utilisé pour la liste des bulletins suspects, pour ne jamais montrer de
// jours futurs qui n'ont pas encore de données.
function dateUpToTodayClause(col, dateRange) {
  return dateRange
    ? `AND ${col} BETWEEN '${dateRange.from}' AND '${dateRange.to}'`
    : `AND ${col} <= CURRENT_DATE`;
}

// Missions "en cours" sur la plage sélectionnée : chevauchement
// d'intervalle. Pas de restriction si aucune plage n'est choisie (Total).
function missionOverlapClause(dateRange) {
  return dateRange ? `AND m.date_debut <= '${dateRange.to}' AND m.date_fin >= '${dateRange.from}'` : '';
}

function missionScopeCTE(rmId, clientId, dateRange, missionId) {
  const rmFilter = rmId ? `AND m.responsable_mission_id = '${rmId}'` : '';
  const clientFilter = clientId ? `AND m.client_id = '${clientId}'` : '';
  // Filtre mission unique, activé par un clic sur une ligne de la table
  // "Suivi des missions" (demande explicite) — mêmes règles de validation
  // (UUID whitelisté côté index.js) que rmId/clientId ci-dessus.
  const missionFilter = missionId ? `AND m.id = '${missionId}'` : '';
  const overlapFilter = missionOverlapClause(dateRange);
  const manualExclusionFilter = MANUALLY_CANCELLED_MISSIONS.length
    ? `AND m.code_mission NOT IN (${MANUALLY_CANCELLED_MISSIONS.map((c) => `'${c}'`).join(', ')})`
    : '';
  return `SELECT m.id, m.code_mission, m.date_debut, m.date_fin, m.format, m.ville_principale,
    m.objectif_bulletin_theorique AS objectif,
    c.nom AS client,
    coalesce(uip_rm.prenom || ' ' || uip_rm.nom, u_rm.email) AS rm,
    coalesce(uip_re.prenom || ' ' || uip_re.nom, u_re.email) AS re
  FROM missions m
  LEFT JOIN clients c ON c.id = m.client_id
  LEFT JOIN utilisateurs u_rm ON u_rm.id = m.responsable_mission_id
  LEFT JOIN utilisateur_informations_personnelles uip_rm ON uip_rm.utilisateur_id = m.responsable_mission_id
  LEFT JOIN utilisateurs u_re ON u_re.id = m.responsable_equipe_id
  LEFT JOIN utilisateur_informations_personnelles uip_re ON uip_re.utilisateur_id = m.responsable_equipe_id
  WHERE m.statut_mission IN ('terminee', 'en_cours')
    ${rmFilter}
    ${clientFilter}
    ${missionFilter}
    ${overlapFilter}
    ${manualExclusionFilter}
    ${excludeClientsClause('m')}`;
}

function buildMissionsDataQuery(rmId, clientId, dateRange, missionId) {
  const dateFilter = dateRangeClause('l.date', dateRange);
  return `WITH filtered_missions AS (
  ${missionScopeCTE(rmId, clientId, dateRange, missionId)}
),
lots_mission AS (
  SELECT l.id, l.mission_id, l.utilisateur_id, l.date,
    CASE WHEN coalesce(l.nombre_horaires_remuneration, 0) <> 0 THEN l.nombre_horaires_rue ELSE 0 END AS heures_rue,
    CASE WHEN coalesce(l.nombre_horaires_remuneration, 0) <> 0 THEN l.nombre_horaires_remuneration ELSE 0 END AS heures_rem
  FROM lots l
  WHERE l.mission_id IN (SELECT id FROM filtered_missions)
    ${dateFilter}
),
dons_mission AS (
  SELECT d.id, d.statut, d.montant, d.lot_id, d.created_at, lm.mission_id,
    CAST((CAST(d.created_at AS DATE) - CAST(dn.date_de_naissance AS DATE)) AS DOUBLE PRECISION) / 365.25 AS age
  FROM dons d JOIN lots_mission lm ON lm.id = d.lot_id
  LEFT JOIN donateurs dn ON dn.id = d.donateur_id
),
cumul AS (
  -- BS réels cumulés depuis le début de la mission (toutes dates, hors
  -- filtre de période) : sert à comparer à l'objectif de la mission.
  SELECT l.mission_id, count(DISTINCT d.id) AS bs_cumul
  FROM lots l JOIN dons d ON d.lot_id = l.id AND d.statut IN ('nouveau','en_attente','transmis')
  WHERE l.mission_id IN (SELECT id FROM filtered_missions)
  GROUP BY l.mission_id
),
agg AS (
  SELECT mission_id, count(DISTINCT utilisateur_id) AS nb_rd,
    sum(heures_rue) AS heures_rue, sum(heures_rem) AS heures_rem
  FROM lots_mission GROUP BY mission_id
),
dons_agg AS (
  SELECT mission_id,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis','incomplet','annule')) AS bs_rue,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS bs_reel,
    count(DISTINCT id) FILTER (WHERE statut = 'incomplet') AS bs_incomplets,
    count(DISTINCT id) FILTER (WHERE statut = 'annule') AS bs_annules,
    avg(montant) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS don_moyen,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY age) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS age_median,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis') AND age < 25) AS nb_moins_25,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis') AND age IS NOT NULL) AS nb_dons_avec_naissance
  FROM dons_mission GROUP BY mission_id
),
mission_rows AS (
  SELECT
    0 AS sort_order,
    fm.id AS mission_id,
    fm.code_mission, fm.client, fm.ville_principale, fm.format, fm.date_debut, fm.date_fin, fm.rm, fm.re,
    fm.objectif,
    coalesce(cu.bs_cumul, 0) AS bs_cumul,
    round((100.0 * cu.bs_cumul / NULLIF(fm.objectif, 0))::numeric, 1) AS pct_objectif,
    coalesce(a.nb_rd, 0) AS nb_rd,
    coalesce(da.bs_rue, 0) AS bs_rue,
    coalesce(da.bs_reel, 0) AS bs_reel,
    coalesce(da.bs_incomplets, 0) AS bs_incomplets,
    coalesce(da.bs_annules, 0) AS bs_annules,
    round((100.0 * da.bs_reel / NULLIF(da.bs_rue, 0))::numeric, 1) AS tx_transfo,
    round((da.bs_reel::numeric / NULLIF(a.heures_rue, 0))::numeric, 3) AS taux_reel,
    round(da.don_moyen::numeric, 2) AS don_moyen,
    round(da.age_median::numeric, 1) AS age_median,
    round((100.0 * da.nb_moins_25 / NULLIF(da.nb_dons_avec_naissance, 0))::numeric, 1) AS pct_moins_25,
    round((a.heures_rue::numeric / NULLIF(a.heures_rem, 0))::numeric, 2) AS ratio_h
  FROM filtered_missions fm
  LEFT JOIN agg a ON a.mission_id = fm.id
  LEFT JOIN dons_agg da ON da.mission_id = fm.id
  LEFT JOIN cumul cu ON cu.mission_id = fm.id
),
total_agg AS (
  SELECT sum(heures_rue) AS heures_rue, sum(heures_rem) AS heures_rem, count(DISTINCT utilisateur_id) AS nb_rd
  FROM lots_mission
),
total_dons AS (
  SELECT
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis','incomplet','annule')) AS bs_rue,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS bs_reel,
    count(DISTINCT id) FILTER (WHERE statut = 'incomplet') AS bs_incomplets,
    count(DISTINCT id) FILTER (WHERE statut = 'annule') AS bs_annules,
    avg(montant) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS don_moyen,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY age) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS age_median,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis') AND age < 25) AS nb_moins_25,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis') AND age IS NOT NULL) AS nb_dons_avec_naissance
  FROM dons_mission
),
total_objectif AS (
  -- Total objectif / BS cumulés limité aux missions qui ont un objectif
  -- renseigné, pour que le % atteint compare des périmètres identiques.
  SELECT sum(fm.objectif)::bigint AS objectif, coalesce(sum(cu.bs_cumul), 0)::bigint AS bs_cumul
  FROM filtered_missions fm
  LEFT JOIN cumul cu ON cu.mission_id = fm.id
  WHERE fm.objectif IS NOT NULL
),
total_row AS (
  SELECT
    1 AS sort_order, NULL::uuid AS mission_id,
    'TOTAL' AS code_mission, NULL::text AS client, NULL::text AS ville_principale, NULL::text AS format,
    NULL::date AS date_debut, NULL::date AS date_fin, NULL::text AS rm, NULL::text AS re,
    tobj.objectif AS objectif,
    tobj.bs_cumul AS bs_cumul,
    round((100.0 * tobj.bs_cumul / NULLIF(tobj.objectif, 0))::numeric, 1) AS pct_objectif,
    coalesce(ta.nb_rd, 0) AS nb_rd,
    coalesce(td.bs_rue, 0) AS bs_rue,
    coalesce(td.bs_reel, 0) AS bs_reel,
    coalesce(td.bs_incomplets, 0) AS bs_incomplets,
    coalesce(td.bs_annules, 0) AS bs_annules,
    round((100.0 * td.bs_reel / NULLIF(td.bs_rue, 0))::numeric, 1) AS tx_transfo,
    round((td.bs_reel::numeric / NULLIF(ta.heures_rue, 0))::numeric, 3) AS taux_reel,
    round(td.don_moyen::numeric, 2) AS don_moyen,
    round(td.age_median::numeric, 1) AS age_median,
    round((100.0 * td.nb_moins_25 / NULLIF(td.nb_dons_avec_naissance, 0))::numeric, 1) AS pct_moins_25,
    round((ta.heures_rue::numeric / NULLIF(ta.heures_rem, 0))::numeric, 2) AS ratio_h
  FROM total_agg ta, total_dons td, total_objectif tobj
)
SELECT * FROM mission_rows
UNION ALL
SELECT * FROM total_row
ORDER BY sort_order, date_debut DESC NULLS LAST;`;
}

function buildAgePieQuery(rmId, clientId, dateRange, missionId) {
  const dateFilter = dateRangeClause('l.date', dateRange);
  return `WITH filtered_missions AS (
  ${missionScopeCTE(rmId, clientId, dateRange, missionId)}
),
lots_f AS (
  SELECT l.id
  FROM lots l
  WHERE l.mission_id IN (SELECT id FROM filtered_missions)
    ${dateFilter}
),
ages AS (
  -- Âge au moment du don (date de signature), pas l'âge actuel — même
  -- convention que partout ailleurs dans le projet.
  SELECT
    (d.created_at::date - don.date_de_naissance)::float / 365.25 AS age
  FROM lots_f lf
  JOIN dons d ON d.lot_id = lf.id
  JOIN donateurs don ON don.id = d.donateur_id
  WHERE d.statut IN ('transmis','nouveau','en_attente')
    AND don.date_de_naissance IS NOT NULL
)
SELECT
  CASE
    WHEN age BETWEEN 18 AND 20.999 THEN '18-20'
    WHEN age BETWEEN 21 AND 25.999 THEN '21-25'
    WHEN age BETWEEN 26 AND 35.999 THEN '26-35'
    WHEN age BETWEEN 36 AND 50.999 THEN '36-50'
    WHEN age >= 51                 THEN '50+'
    ELSE 'Autre'
  END AS tranche_age,
  COUNT(*) AS nb
FROM ages
GROUP BY 1
ORDER BY MIN(age);`;
}

function buildGenderPieQuery(rmId, clientId, dateRange, missionId) {
  const dateFilter = dateRangeClause('l.date', dateRange);
  return `WITH filtered_missions AS (
  ${missionScopeCTE(rmId, clientId, dateRange, missionId)}
),
lots_f AS (
  SELECT l.id
  FROM lots l
  WHERE l.mission_id IN (SELECT id FROM filtered_missions)
    ${dateFilter}
)
SELECT
  CASE
    WHEN don.civilite = 'monsieur' THEN 'Hommes'
    WHEN don.civilite = 'madame'   THEN 'Femmes'
    ELSE 'Autre/NC'
  END AS genre,
  COUNT(*) AS nb
FROM lots_f lf
JOIN dons d ON d.lot_id = lf.id
JOIN donateurs don ON don.id = d.donateur_id
WHERE d.statut IN ('transmis','nouveau','en_attente')
GROUP BY 1
ORDER BY nb DESC;`;
}

function buildRmListQuery() {
  return `SELECT DISTINCT m.responsable_mission_id AS id, coalesce(uip.prenom || ' ' || uip.nom, u.email) AS nom
FROM missions m
LEFT JOIN utilisateurs u ON u.id = m.responsable_mission_id
LEFT JOIN utilisateur_informations_personnelles uip ON uip.utilisateur_id = m.responsable_mission_id
WHERE m.responsable_mission_id IS NOT NULL
  ${excludeClientsClause('m')}
ORDER BY nom;`;
}

function buildClientListQuery() {
  return `SELECT DISTINCT c.id, c.nom
FROM clients c
JOIN missions m ON m.client_id = c.id
WHERE c.nom IS NOT NULL
  ${excludeClientsDirectClause('c')}
ORDER BY c.nom;`;
}

// Liste des bulletins suspects, toutes missions filtrées confondues
// (structure identique à /re-collecte, avec une colonne Mission en plus
// puisque le RM couvre plusieurs missions à la fois). On inclut les dons
// annulés (avec leur statut affiché, pour garder une trace visible), mais
// pas les dons déjà transmis : une fois transmis, le contrôle qualité est
// considéré comme fait, ils n'ont plus besoin d'apparaître dans cette liste.
function buildBulletinsSuspectsListQuery(rmId, clientId, dateRange, missionId) {
  const dateFilter = dateUpToTodayClause('l.date', dateRange);
  return `WITH filtered_missions AS (
  ${missionScopeCTE(rmId, clientId, dateRange, missionId)}
),
dons_filtres AS (
    SELECT d.*, l.date AS lot_date, l.utilisateur_id AS lot_utilisateur_id, l.mission_id AS mission_id
    FROM dons d
    JOIN lots l ON d.lot_id = l.id
    WHERE l.mission_id IN (SELECT id FROM filtered_missions)
      AND d.statut IN ('nouveau', 'en_attente', 'annule')
      ${dateFilter}
),
recruteur_contacts AS (
    SELECT u_c.email, u_c.telephone, u_c.utilisateur_id
    FROM utilisateur_informations_contact u_c
    WHERE EXISTS (SELECT 1 FROM donateurs don WHERE LOWER(don.email) = LOWER(u_c.email))
),
donateur_stats AS (
    SELECT email, COUNT(*) AS nb_dons_total
    FROM donateurs
    WHERE email IN (SELECT email FROM donateurs WHERE id IN (SELECT donateur_id FROM dons_filtres))
      AND email NOT ILIKE '%nomail%'
    GROUP BY email
)
SELECT * FROM (
  SELECT
    df.lot_date AS date,
    df.statut AS statut,
    fm.code_mission AS mission,
    coalesce(uip_actuel.prenom || ' ' || uip_actuel.nom, u_actuel.email) AS rd,
    INITCAP(LOWER(don.prenom)) || ' ' || UPPER(don.nom) AS donateur,
    don.adresse AS adresse,
    don.email AS email_donateur,
    df.montant AS montant,
    df.id AS don_id,
    coalesce(dts.nb_dons_total, 0) AS nb_dons_total,
    ${donMotifCase('df', 'don', 'uip_actuel', 'uc_actuel', 'rc_tiers', 'dts')} AS motif
  FROM dons_filtres df
  JOIN donateurs don ON df.donateur_id = don.id
  LEFT JOIN donateur_stats dts ON don.email = dts.email
  LEFT JOIN utilisateurs u_actuel ON u_actuel.id = df.lot_utilisateur_id
  LEFT JOIN utilisateur_informations_personnelles uip_actuel ON uip_actuel.utilisateur_id = df.lot_utilisateur_id
  LEFT JOIN utilisateur_informations_contact uc_actuel ON uc_actuel.utilisateur_id = df.lot_utilisateur_id
  LEFT JOIN filtered_missions fm ON fm.id = df.mission_id
  LEFT JOIN recruteur_contacts rc_tiers ON (
      (LOWER(don.email) = LOWER(rc_tiers.email) OR NULLIF(don.telephone_mobile,'') = rc_tiers.telephone)
      AND rc_tiers.utilisateur_id <> df.lot_utilisateur_id
  )
) t
WHERE t.motif <> '✅ Ok'
  AND (t.motif <> '👥 Donateur multiple' OR t.nb_dons_total > 5)
ORDER BY t.date DESC, t.montant DESC;`;
}

// Suivi quotidien par mission (demande explicite, 10/2026) : une ligne par
// mission et par jour (jusqu'à aujourd'hui si aucune plage n'est choisie).
// - rd_attendus : RD (hors responsable d'équipe de la mission) ayant un lot
//   ce jour-là ; rd_presents : parmi eux, ceux dont les heures rémunérées
//   du lot sont non nulles (présence = heures rémunérées <> 0, partout).
// - bs_reel / bs_re : dons valides du jour, dont ceux réalisés par le
//   responsable d'équipe de la mission (BS RE).
// - premier_bs / dernier_bs : heure de création (Paris) du premier et du
//   dernier don valide du jour.
// - objectif_jour / objectif_semaine : l'objectif de la mission
//   (objectif_bulletin_theorique) est réparti à parts égales sur ses jours
//   de lots (tous lots de la mission, y compris à venir) ; l'objectif d'une
//   semaine ISO = objectif x (jours de lots de la semaine / jours de lots
//   de la mission). Approximation : la base ne porte pas d'objectif par jour.
function buildSuiviJourQuery(rmId, clientId, dateRange, missionId) {
  const dateFilter = dateUpToTodayClause('l.date', dateRange);
  return `WITH filtered_missions AS (
  ${missionScopeCTE(rmId, clientId, dateRange, missionId)}
),
jours_all AS (
  SELECT DISTINCT l.mission_id, l.date, date_trunc('week', l.date)::date AS semaine
  FROM lots l
  WHERE l.mission_id IN (SELECT id FROM filtered_missions)
),
jours_calc AS (
  SELECT mission_id, date, semaine,
    count(*) OVER (PARTITION BY mission_id) AS nb_jours_mission,
    count(*) OVER (PARTITION BY mission_id, semaine) AS nb_jours_semaine
  FROM jours_all
),
lots_f AS (
  SELECT l.id, l.mission_id, l.date, l.utilisateur_id,
    (coalesce(l.nombre_horaires_remuneration, 0) <> 0) AS present,
    coalesce(l.utilisateur_id = m.responsable_equipe_id, FALSE) AS est_re
  FROM lots l
  JOIN missions m ON m.id = l.mission_id
  WHERE l.mission_id IN (SELECT id FROM filtered_missions)
    ${dateFilter}
),
jours AS (
  SELECT mission_id, date,
    count(DISTINCT utilisateur_id) FILTER (WHERE NOT est_re) AS rd_attendus,
    count(DISTINCT utilisateur_id) FILTER (WHERE NOT est_re AND present) AS rd_presents
  FROM lots_f
  GROUP BY mission_id, date
),
dons_j AS (
  SELECT l.mission_id, l.date,
    count(DISTINCT d.id) AS bs_reel,
    count(DISTINCT d.id) FILTER (WHERE l.est_re) AS bs_re,
    min(d.created_at) AS premier,
    max(d.created_at) AS dernier
  FROM lots_f l
  JOIN dons d ON d.lot_id = l.id AND d.statut IN ('nouveau','en_attente','transmis')
  GROUP BY l.mission_id, l.date
)
SELECT j.date, jc.semaine, fm.id AS mission_id, fm.code_mission,
  j.rd_attendus, j.rd_presents,
  coalesce(dj.bs_reel, 0) AS bs_reel,
  coalesce(dj.bs_re, 0) AS bs_re,
  to_char(dj.premier AT TIME ZONE 'Europe/Paris', 'HH24:MI') AS premier_bs,
  to_char(dj.dernier AT TIME ZONE 'Europe/Paris', 'HH24:MI') AS dernier_bs,
  fm.objectif AS objectif_mission,
  CASE WHEN fm.objectif IS NOT NULL THEN fm.objectif::float / jc.nb_jours_mission END AS objectif_jour,
  CASE WHEN fm.objectif IS NOT NULL THEN fm.objectif::float * jc.nb_jours_semaine / jc.nb_jours_mission END AS objectif_semaine
FROM jours j
JOIN filtered_missions fm ON fm.id = j.mission_id
JOIN jours_calc jc ON jc.mission_id = j.mission_id AND jc.date = j.date
LEFT JOIN dons_j dj ON dj.mission_id = j.mission_id AND dj.date = j.date
ORDER BY j.date DESC, fm.code_mission;`;
}

// Taux de FPE (fin de période d'essai) sur les contrats des missions du
// périmètre (demande explicite, 10/2026), ventilé employeur / salarié selon
// le libellé de l'avenant (même détection que sql-rh.js). Taux = nb de
// contrats avec FPE de cette initiative / nb de contrats du périmètre ; un
// contrat n'est compté qu'une fois par initiative.
function buildFpeQuery(rmId, clientId, dateRange, missionId) {
  return `WITH filtered_missions AS (
  ${missionScopeCTE(rmId, clientId, dateRange, missionId)}
),
contrats_f AS (
  SELECT c.id FROM contrats c WHERE c.mission_id IN (SELECT id FROM filtered_missions)
),
fpe_f AS (
  SELECT av.contrat_id, ta.libelle
  FROM avenants av
  JOIN types_avenants ta ON ta.id = av.type_avenant_id
  JOIN contrats_f cf ON cf.id = av.contrat_id
  WHERE ta.categorie = 'fin_period_essai'
)
SELECT
  count(DISTINCT cf.id) AS nb_contrats,
  count(DISTINCT fpe_f.contrat_id) FILTER (WHERE fpe_f.libelle ILIKE '%employeur%') AS nb_fpe_employeur,
  count(DISTINCT fpe_f.contrat_id) FILTER (WHERE fpe_f.libelle ILIKE '%salarié%') AS nb_fpe_salarie
FROM contrats_f cf
LEFT JOIN fpe_f ON fpe_f.contrat_id = cf.id;`;
}

function buildRmCollecteQueries(rmId, clientId, dateRange, missionId) {
  return {
    missions: buildMissionsDataQuery(rmId, clientId, dateRange, missionId),
    age: buildAgePieQuery(rmId, clientId, dateRange, missionId),
    gender: buildGenderPieQuery(rmId, clientId, dateRange, missionId),
    suspectsList: buildBulletinsSuspectsListQuery(rmId, clientId, dateRange, missionId),
    suiviJour: buildSuiviJourQuery(rmId, clientId, dateRange, missionId),
    fpe: buildFpeQuery(rmId, clientId, dateRange, missionId),
  };
}

export {
  buildRmCollecteQueries,
  buildMissionsDataQuery,
  buildAgePieQuery,
  buildGenderPieQuery,
  buildRmListQuery,
  buildClientListQuery,
  buildBulletinsSuspectsListQuery,
};
