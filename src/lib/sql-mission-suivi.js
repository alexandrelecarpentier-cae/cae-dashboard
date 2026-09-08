// Requêtes SQL pour le dashboard "Suivi de mission" (/mission.html) : vue
// complète d'UNE mission (id_mission, UUID déjà résolu/validé côté
// appelant) — tendance hebdomadaire, performance d'équipe (table +
// camemberts + bulletins/jour, réutilisés depuis sql-rd.js), et un fil
// jour par jour (stats, commentaires de reporting des RD, dons suspects
// en détail). Porté depuis un prototype autonome
// (mission_suivi_standalone.html) qui se connectait directement à
// Metabase depuis le navigateur — ici les mêmes requêtes tournent côté
// serveur, comme partout ailleurs dans ce projet.

import {
  buildRdInfoQuery,
  buildRdRosterQuery,
  buildRdTableQuery,
  buildRdAgePieQuery,
  buildRdGenderPieQuery,
  buildRdBulletinsParJourQuery,
  buildRdBsSuspectsQuery,
  donMotifCase,
  dateFilterClause,
} from './sql-rd.js';

// Comme dateFilterClause, mais par défaut "jusqu'à aujourd'hui" quand
// aucune plage n'est fournie (utilisé pour le fil "par journée" : on ne
// veut jamais promettre des jours futurs qui n'ont pas encore de données).
function dateUpToTodayClause(col, dateRange) {
  return dateRange
    ? `AND ${col} BETWEEN '${dateRange.from}' AND '${dateRange.to}'`
    : `AND ${col} <= CURRENT_DATE`;
}

function buildWeeklyQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  const dateFilter = dateFilterClause('l.date', dateRange);
  return `WITH mission_lots AS (
  SELECT l.id, l.date, l.nombre_horaires_rue, l.presence_recruteur
  FROM lots l
  WHERE l.mission_id = '${id_mission}'
    ${rdFilter}
    ${dateFilter}
),
heures_semaine AS (
  SELECT DATE_TRUNC('week', date)::date AS semaine,
    SUM(CASE WHEN (presence_recruteur <> FALSE) OR (presence_recruteur IS NULL) THEN nombre_horaires_rue ELSE 0 END) AS h_rue
  FROM mission_lots GROUP BY 1
),
bs_semaine AS (
  SELECT DATE_TRUNC('week', lf.date)::date AS semaine,
    COUNT(d.id) FILTER (WHERE d.statut IN ('transmis','nouveau','en_attente')) AS bs_reel
  FROM mission_lots lf LEFT JOIN dons d ON d.lot_id = lf.id GROUP BY 1
)
SELECT hs.semaine AS semaine, bs.bs_reel AS bs_reel,
  ROUND(bs.bs_reel::numeric / NULLIF(hs.h_rue::numeric, 0), 2) AS taux_reel
FROM heures_semaine hs LEFT JOIN bs_semaine bs ON bs.semaine = hs.semaine
ORDER BY hs.semaine;`;
}

function buildAllDaysStatsQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  const dateFilter = dateUpToTodayClause('l.date', dateRange);
  return `WITH lots_all AS (
  SELECT l.id, l.date, l.utilisateur_id, l.presence_recruteur,
    CASE WHEN (l.presence_recruteur <> FALSE OR l.presence_recruteur IS NULL) THEN l.nombre_horaires_rue ELSE 0 END AS heures_rue,
    CASE WHEN (l.presence_recruteur <> FALSE OR l.presence_recruteur IS NULL) THEN l.nombre_horaires_remuneration ELSE 0 END AS heures_rem
  FROM lots l
  WHERE l.mission_id = '${id_mission}'
    ${dateFilter}
    ${rdFilter}
),
dons_all AS (
  SELECT d.id, d.statut, d.montant, la.date AS date,
    CAST((CAST(d.created_at AS DATE) - CAST(dn.date_de_naissance AS DATE)) AS DOUBLE PRECISION) / 365.0 AS age
  FROM dons d JOIN lots_all la ON la.id = d.lot_id
  LEFT JOIN donateurs dn ON dn.id = d.donateur_id
),
heures_jour AS (
  SELECT date, sum(heures_rue) AS heures_rue, sum(heures_rem) AS heures_rem
  FROM lots_all GROUP BY date
),
dons_jour AS (
  SELECT date,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS bs_reel,
    avg(montant) FILTER (WHERE statut IN ('nouveau','en_attente','transmis')) AS don_moyen,
    count(DISTINCT id) FILTER (WHERE statut IN ('nouveau','en_attente','transmis') AND age < 25) AS nb_moins_25
  FROM dons_all GROUP BY date
)
SELECT hj.date AS date,
  coalesce(dj.bs_reel, 0) AS bs_reel,
  round(coalesce(dj.bs_reel,0)::numeric / NULLIF(hj.heures_rue,0)::numeric, 2) AS taux_reel,
  round(hj.heures_rue::numeric / NULLIF(hj.heures_rem,0)::numeric, 2) AS ratio_h,
  round(dj.don_moyen::numeric, 2) AS don_moyen,
  round((100.0 * coalesce(dj.nb_moins_25,0)) / NULLIF(dj.bs_reel,0)::numeric, 1) AS pct_moins_25
FROM heures_jour hj LEFT JOIN dons_jour dj ON dj.date = hj.date
ORDER BY hj.date DESC;`;
}

function buildAllDaysCommentsQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  const dateFilter = dateUpToTodayClause('l.date', dateRange);
  return `SELECT l.date AS date, coalesce(uip.prenom || ' ' || uip.nom, u.email) AS rd, l.commentaire AS commentaire
FROM lots l
LEFT JOIN utilisateurs u ON u.id = l.utilisateur_id
LEFT JOIN utilisateur_informations_personnelles uip ON uip.utilisateur_id = l.utilisateur_id
WHERE l.mission_id = '${id_mission}'
  ${dateFilter}
  ${rdFilter}
  AND l.commentaire IS NOT NULL AND TRIM(l.commentaire) <> ''
ORDER BY l.date DESC, rd;`;
}

function buildAllDaysSuspectsQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  const dateFilter = dateUpToTodayClause('l.date', dateRange);
  return `WITH dons_filtres AS (
    SELECT d.*, l.date AS lot_date, l.utilisateur_id AS lot_utilisateur_id
    FROM dons d
    JOIN lots l ON d.lot_id = l.id
    WHERE l.mission_id = '${id_mission}'
      AND d.statut IN ('nouveau', 'transmis', 'en_attente')
      ${dateFilter}
      ${rdFilter}
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
  LEFT JOIN recruteur_contacts rc_tiers ON (
      (LOWER(don.email) = LOWER(rc_tiers.email) OR NULLIF(don.telephone_mobile,'') = rc_tiers.telephone)
      AND rc_tiers.utilisateur_id <> df.lot_utilisateur_id
  )
) t
WHERE t.motif <> '✅ Ok'
  AND (t.motif <> '👥 Donateur multiple' OR t.nb_dons_total > 5)
ORDER BY t.date DESC, t.montant DESC;`;
}

function buildMissionSuiviQueries(id_mission, id_utilisateur, dateRange) {
  return {
    info: buildRdInfoQuery(id_mission),
    roster: buildRdRosterQuery(id_mission),
    table: buildRdTableQuery(id_mission, dateRange),
    weekly: buildWeeklyQuery(id_mission, id_utilisateur, dateRange),
    age: buildRdAgePieQuery(id_mission, id_utilisateur, dateRange),
    gender: buildRdGenderPieQuery(id_mission, id_utilisateur, dateRange),
    bulletins: buildRdBulletinsParJourQuery(id_mission, id_utilisateur, dateRange),
    suspects: buildRdBsSuspectsQuery(id_mission, dateRange),
    dayStats: buildAllDaysStatsQuery(id_mission, id_utilisateur, dateRange),
    dayComments: buildAllDaysCommentsQuery(id_mission, id_utilisateur, dateRange),
    daySuspects: buildAllDaysSuspectsQuery(id_mission, id_utilisateur, dateRange),
  };
}

export { buildMissionSuiviQueries, buildWeeklyQuery, dateUpToTodayClause };
