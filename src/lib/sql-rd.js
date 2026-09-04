// Requêtes SQL pour le dashboard "Terrain RD" (/rd.html) : vue d'équipe sur
// UNE mission (id_mission, UUID déjà résolu/validé côté appelant), avec
// filtre optionnel par RD (id_utilisateur) et par plage de dates. Porté
// depuis un prototype autonome (terrain_dashboard_rd_standalone.html) qui
// se connectait directement à Metabase depuis le navigateur — ici les
// mêmes requêtes sont exécutées côté serveur comme partout ailleurs dans
// ce projet, id_mission/id_utilisateur étant déjà validés en UUID (RE_UUID)
// et les dates en AAAA-MM-JJ (RE_DATE) par l'appelant avant d'arriver ici.

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";
const STATUTS_RUE = "('nouveau','en_attente','transmis','incomplet','annule')";

function dateFilterClause(col, dateRange) {
  return dateRange ? `AND ${col} BETWEEN '${dateRange.from}' AND '${dateRange.to}'` : '';
}

function buildRdInfoQuery(id_mission) {
  return `select m.code_mission, m.code_mission_client, m.statut_mission, m.date_debut, m.date_fin,
  c.nom as client_nom, c.couleur
from missions m
left join clients c on c.id = m.client_id
where m.id = '${id_mission}'
limit 1;`;
}

function buildRdRosterQuery(id_mission) {
  return `select distinct l.utilisateur_id as id, coalesce(uip.prenom || ' ' || uip.nom, u.email) as nom
from lots l
left join utilisateurs u on u.id = l.utilisateur_id
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = l.utilisateur_id
where l.mission_id = '${id_mission}'
order by nom;`;
}

// Table principale : une ligne par RD ayant travaillé sur la mission (dans
// la plage de dates éventuelle), plus une ligne TOTAL. Reprend telle quelle
// la logique du dashboard Metabase "Suivi Qualité" (grade, FPE, taux réel,
// transfo, don moyen, âge médian, %+25/-25, ratio heures, taux d'absence
// injustifiée) — bs_suspects est ajouté après-coup côté handler (cf.
// buildRdBsSuspectsQuery) car c'est une requête séparée plus coûteuse.
function buildRdTableQuery(id_mission, dateRange) {
  const dateFilter = dateFilterClause('l.date', dateRange);
  return `WITH lots_mission AS (
  SELECT l.id, l.utilisateur_id, l.date, l.presence_recruteur, l.absence_id,
    CASE WHEN (l.presence_recruteur <> FALSE OR l.presence_recruteur IS NULL) THEN l.nombre_horaires_rue ELSE 0 END AS heures_rue,
    CASE WHEN (l.presence_recruteur <> FALSE OR l.presence_recruteur IS NULL) THEN l.nombre_horaires_remuneration ELSE 0 END AS heures_rem
  FROM lots l WHERE l.mission_id = '${id_mission}'
    ${dateFilter}
),
dons_mission AS (
  SELECT d.id, d.statut, d.montant, d.lot_id, d.created_at, lm.utilisateur_id,
    CAST((CAST(d.created_at AS DATE) - CAST(dn.date_de_naissance AS DATE)) AS DOUBLE PRECISION) / 365.0 AS age
  FROM dons d JOIN lots_mission lm ON lm.id = d.lot_id
  LEFT JOIN donateurs dn ON dn.id = d.donateur_id
),
agg AS (
  SELECT lm.utilisateur_id, count(DISTINCT lm.id) AS nb_jours,
    sum(CASE WHEN lm.presence_recruteur = TRUE THEN 1 ELSE 0 END) AS jours_presence,
    sum(CASE WHEN lm.presence_recruteur = FALSE THEN 1 ELSE 0 END) AS jours_absence,
    sum(lm.heures_rue) AS heures_rue, sum(lm.heures_rem) AS heures_rem
  FROM lots_mission lm GROUP BY lm.utilisateur_id
),
absence_agg AS (
  SELECT lm.utilisateur_id,
    SUM(CASE WHEN lm.presence_recruteur = FALSE AND (tya.libelle IS NULL OR (tya.libelle NOT ILIKE '%maladie%' AND tya.libelle NOT ILIKE '%autorisée%')) THEN 1 ELSE 0 END) AS jours_absence_injustifiee
  FROM lots_mission lm
  LEFT JOIN absences ab ON ab.id = lm.absence_id
  LEFT JOIN types_absences tya ON tya.id = ab.type_absence_id
  GROUP BY lm.utilisateur_id
),
dons_agg AS (
  SELECT utilisateur_id,
    count(DISTINCT id) FILTER (WHERE statut IN ${STATUTS_RUE}) AS bs_rue,
    count(DISTINCT id) FILTER (WHERE statut IN ${STATUTS_VALIDES}) AS bs_reel,
    count(DISTINCT id) FILTER (WHERE statut = 'incomplet') AS bs_incomplets,
    count(DISTINCT id) FILTER (WHERE statut = 'annule') AS bs_annules,
    avg(montant) FILTER (WHERE statut IN ${STATUTS_VALIDES}) AS don_moyen,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY age) FILTER (WHERE statut IN ${STATUTS_VALIDES}) AS age_median,
    count(DISTINCT id) FILTER (WHERE statut IN ${STATUTS_VALIDES} AND age < 25) AS nb_moins_25
  FROM dons_mission GROUP BY utilisateur_id
),
contrat_rd AS (
  SELECT DISTINCT ON (c.utilisateur_id) c.id AS contrat_id, c.utilisateur_id, c.statut AS grade, c.duree AS heures_contrat
  FROM contrats c WHERE c.mission_id = '${id_mission}'
  ORDER BY c.utilisateur_id, c.date_debut DESC
),
fpe_rd AS (
  SELECT DISTINCT cr.utilisateur_id FROM contrat_rd cr
  JOIN avenants av ON av.contrat_id = cr.contrat_id
  JOIN types_avenants ta ON ta.id = av.type_avenant_id
  WHERE ta.categorie = 'fin_period_essai'
),
rd_rows AS (
  SELECT
    0 AS sort_order,
    a.utilisateur_id AS utilisateur_id,
    coalesce(uip.prenom || ' ' || uip.nom, u.email) AS rd,
    cr.grade AS statut,
    cr.heures_contrat AS contrat_h,
    CASE WHEN fpe.utilisateur_id IS NOT NULL THEN 'FPE' ELSE NULL END AS fpe,
    da.bs_rue AS bs_rue,
    da.bs_reel AS bs_reel,
    da.bs_incomplets AS bs_incomplets,
    da.bs_annules AS bs_annules,
    round((100.0 * da.bs_reel / NULLIF(da.bs_rue, 0))::numeric, 1) AS tx_transfo,
    round((da.bs_reel::numeric / NULLIF(a.heures_rue, 0))::numeric, 2) AS taux_reel,
    round(da.don_moyen::numeric, 2) AS don_moyen,
    round(da.age_median::numeric, 1) AS age_median,
    round((100.0 * da.nb_moins_25 / NULLIF(da.bs_reel, 0))::numeric, 1) AS pct_moins_25,
    round((a.heures_rue::numeric / NULLIF(a.heures_rem, 0))::numeric, 2) AS ratio_h,
    round(a.heures_rue::numeric, 2) AS heures_rue,
    round(a.heures_rem::numeric, 2) AS heures_rem,
    round((100.0 * a.jours_absence / NULLIF(a.jours_presence + a.jours_absence, 0))::numeric, 1) AS taux_absence,
    round((100.0 * coalesce(aa.jours_absence_injustifiee, 0) / NULLIF(a.jours_presence + a.jours_absence, 0))::numeric, 1) AS taux_absence_injustifiee,
    CASE WHEN cr.grade = 'RE' THEN 1 WHEN cr.grade='RDE' THEN 2 WHEN cr.grade='RDC' THEN 3 WHEN cr.grade='RD' THEN 4 ELSE 5 END AS grade_order
  FROM agg a
  LEFT JOIN dons_agg da ON da.utilisateur_id = a.utilisateur_id
  LEFT JOIN absence_agg aa ON aa.utilisateur_id = a.utilisateur_id
  LEFT JOIN contrat_rd cr ON cr.utilisateur_id = a.utilisateur_id
  LEFT JOIN fpe_rd fpe ON fpe.utilisateur_id = a.utilisateur_id
  LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
  LEFT JOIN utilisateur_informations_personnelles uip ON uip.utilisateur_id = a.utilisateur_id
),
total_agg AS (
  SELECT sum(heures_rue) AS heures_rue, sum(heures_rem) AS heures_rem,
    sum(CASE WHEN presence_recruteur = TRUE THEN 1 ELSE 0 END) AS jours_presence,
    sum(CASE WHEN presence_recruteur = FALSE THEN 1 ELSE 0 END) AS jours_absence
  FROM lots_mission
),
total_absence_agg AS (
  SELECT SUM(CASE WHEN lm.presence_recruteur = FALSE AND (tya.libelle IS NULL OR (tya.libelle NOT ILIKE '%maladie%' AND tya.libelle NOT ILIKE '%autorisée%')) THEN 1 ELSE 0 END) AS jours_absence_injustifiee
  FROM lots_mission lm
  LEFT JOIN absences ab ON ab.id = lm.absence_id
  LEFT JOIN types_absences tya ON tya.id = ab.type_absence_id
),
total_dons AS (
  SELECT
    count(DISTINCT id) FILTER (WHERE statut IN ${STATUTS_RUE}) AS bs_rue,
    count(DISTINCT id) FILTER (WHERE statut IN ${STATUTS_VALIDES}) AS bs_reel,
    count(DISTINCT id) FILTER (WHERE statut = 'incomplet') AS bs_incomplets,
    count(DISTINCT id) FILTER (WHERE statut = 'annule') AS bs_annules,
    avg(montant) FILTER (WHERE statut IN ${STATUTS_VALIDES}) AS don_moyen,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY age) FILTER (WHERE statut IN ${STATUTS_VALIDES}) AS age_median,
    count(DISTINCT id) FILTER (WHERE statut IN ${STATUTS_VALIDES} AND age < 25) AS nb_moins_25
  FROM dons_mission
),
total_row AS (
  SELECT
    1 AS sort_order, NULL::uuid AS utilisateur_id, 'TOTAL' AS rd, NULL AS statut, NULL::int AS contrat_h, NULL AS fpe,
    td.bs_rue AS bs_rue,
    td.bs_reel AS bs_reel,
    td.bs_incomplets AS bs_incomplets,
    td.bs_annules AS bs_annules,
    round((100.0 * td.bs_reel / NULLIF(td.bs_rue, 0))::numeric, 1) AS tx_transfo,
    round((td.bs_reel::numeric / NULLIF(ta.heures_rue, 0))::numeric, 2) AS taux_reel,
    round(td.don_moyen::numeric, 2) AS don_moyen,
    round(td.age_median::numeric, 1) AS age_median,
    round((100.0 * td.nb_moins_25 / NULLIF(td.bs_reel, 0))::numeric, 1) AS pct_moins_25,
    round((ta.heures_rue::numeric / NULLIF(ta.heures_rem, 0))::numeric, 2) AS ratio_h,
    round(ta.heures_rue::numeric, 2) AS heures_rue,
    round(ta.heures_rem::numeric, 2) AS heures_rem,
    round((100.0 * ta.jours_absence / NULLIF(ta.jours_presence + ta.jours_absence, 0))::numeric, 1) AS taux_absence,
    round((100.0 * coalesce(taa.jours_absence_injustifiee, 0) / NULLIF(ta.jours_presence + ta.jours_absence, 0))::numeric, 1) AS taux_absence_injustifiee,
    0 AS grade_order
  FROM total_agg ta, total_dons td, total_absence_agg taa
)
SELECT * FROM rd_rows
UNION ALL
SELECT * FROM total_row
ORDER BY sort_order, grade_order, bs_reel DESC NULLS LAST;`;
}

function buildRdAgePieQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  const dateFilter = dateFilterClause('l.date', dateRange);
  return `WITH lots_f AS (
  SELECT l.id
  FROM lots l
  WHERE l.mission_id = '${id_mission}'
    ${rdFilter}
    ${dateFilter}
),
ages AS (
  SELECT
    (CURRENT_DATE - don.date_de_naissance)::float / 365.25 AS age
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

function buildRdGenderPieQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  const dateFilter = dateFilterClause('l.date', dateRange);
  return `WITH lots_f AS (
  SELECT l.id
  FROM lots l
  WHERE l.mission_id = '${id_mission}'
    ${rdFilter}
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

function buildRdBulletinsParJourQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  // Sans plage de dates : borne à aujourd'hui (comme le reste du dashboard,
  // qui ne montre jamais de jours futurs).
  const dateFilter = dateRange
    ? `AND DATE(d.created_at) BETWEEN '${dateRange.from}' AND '${dateRange.to}'`
    : `AND DATE(d.created_at) <= CURRENT_DATE`;
  return `SELECT DATE(d.created_at) AS jour,
  coalesce(uip.prenom || ' ' || uip.nom, u.email) AS rd,
  COUNT(DISTINCT d.id) AS nb
FROM dons d
JOIN lots l ON l.id = d.lot_id
LEFT JOIN utilisateurs u ON u.id = l.utilisateur_id
LEFT JOIN utilisateur_informations_personnelles uip ON uip.utilisateur_id = l.utilisateur_id
WHERE l.mission_id = '${id_mission}'
  AND d.statut IN ('en_attente','nouveau','transmis')
  ${dateFilter}
  ${rdFilter}
GROUP BY 1, 2
ORDER BY 1 DESC, 2;`;
}

// Motif de contrôle qualité repris de la logique "Suivi Qualité" (Metabase,
// dashboard 42 / question 389) : détecte les dons dont une caractéristique
// (email, téléphone, adresse, coordonnées partagées avec le recruteur ou un
// tiers, montant élevé, don hors heures ouvrées, donateur multiple...)
// nécessite une vérification qualité avant validation définitive.
function donMotifCase(dfAlias, donAlias, upActuelAlias, ucActuelAlias, rcTiersAlias, dtsAlias) {
  return `CASE
      WHEN ${donAlias}.email ILIKE '%test%' OR ${donAlias}.prenom ILIKE '%test%' OR ${donAlias}.nom ILIKE '%test%' THEN '🧪 Test'
      WHEN ${donAlias}.date_de_naissance > CURRENT_DATE - INTERVAL '18 years' THEN '🚨 Donateur mineur'
      WHEN LOWER(${donAlias}.nom) = LOWER(${upActuelAlias}.nom) THEN '🚩 Suspicion fraude'
      WHEN (LOWER(${donAlias}.email) = LOWER(${ucActuelAlias}.email) OR NULLIF(${donAlias}.telephone_mobile,'') = ${ucActuelAlias}.telephone OR NULLIF(${donAlias}.telephone_fixe,'') = ${ucActuelAlias}.telephone)
           THEN '🆔 Coordonnées du recruteur'
      WHEN ${rcTiersAlias}.utilisateur_id IS NOT NULL THEN '🆔 Coordonnées d''un autre recruteur'
      WHEN CAST(NULLIF(REGEXP_REPLACE(${dfAlias}.montant::text, '[^0-9.]', '', 'g'), '') AS NUMERIC) >= 100 THEN '⚠️ Montant élevé'
      WHEN ${donAlias}.email ILIKE '%nomail%' THEN '🚫 Donateur sans email'
      WHEN ${donAlias}.telephone_mobile ~ '^0[067]0{8}$' OR ${donAlias}.telephone_mobile = '0000000000' THEN '📵 Téléphone non communiqué'
      WHEN (${donAlias}.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'
           OR SPLIT_PART(LOWER(${donAlias}.email), '@', 2) IN ('gamil.com','gmai.com','gmial.com','gmal.com','yahooo.com','yaho.com'))
           THEN '✏️ Email mal orthographié'
      WHEN ${donAlias}.email ~* '@(yopmail|tempmail|trashmail|guerrillamail|sharklasers|mailinator|dispostable|duck\\.com)\\.' THEN '📧 Faux email'
      WHEN (${donAlias}.telephone_mobile ~ '(.)\\1{5,}' AND ${donAlias}.telephone_mobile !~ '^0[067]0{8}$') THEN '📱 Téléphone suspect'
      WHEN LENGTH(${donAlias}.adresse) < 6 THEN '🏠 Adresse trop courte'
      WHEN ${dfAlias}.old_cae_id IS NULL AND (EXTRACT(HOUR FROM ${dfAlias}.created_at) >= 20 OR EXTRACT(HOUR FROM ${dfAlias}.created_at) < 9 OR EXTRACT(DOW FROM ${dfAlias}.created_at) = 0) THEN '🌙 Don hors heures ouvrées'
      WHEN ${dtsAlias}.nb_dons_total > 1 THEN '👥 Donateur multiple'
      ELSE '✅ Ok'
    END`;
}

// BS suspects par RD = dons flagués par le contrôle qualité ci-dessus, sauf
// motif "Donateur multiple" à moins que le donateur totalise plus de 5 dons
// (dans ce cas on le compte quand même comme suspect).
function buildRdBsSuspectsQuery(id_mission, dateRange) {
  const dateFilter = dateFilterClause('l.date', dateRange);
  return `WITH dons_filtres AS (
    SELECT d.*, l.utilisateur_id AS lot_utilisateur_id
    FROM dons d
    JOIN lots l ON d.lot_id = l.id
    WHERE l.mission_id = '${id_mission}'
      AND d.statut IN ('nouveau', 'transmis', 'en_attente')
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
),
dons_motif AS (
  SELECT df.lot_utilisateur_id, df.id AS don_id, coalesce(dts.nb_dons_total,0) AS nb_dons_total,
    ${donMotifCase('df', 'don', 'u_p_actuel', 'u_c_actuel', 'rc_tiers', 'dts')} AS motif
  FROM dons_filtres df
  JOIN donateurs don ON df.donateur_id = don.id
  LEFT JOIN donateur_stats dts ON don.email = dts.email
  JOIN utilisateur_informations_personnelles u_p_actuel ON df.lot_utilisateur_id = u_p_actuel.utilisateur_id
  JOIN utilisateur_informations_contact u_c_actuel ON df.lot_utilisateur_id = u_c_actuel.utilisateur_id
  LEFT JOIN recruteur_contacts rc_tiers ON (
      (LOWER(don.email) = LOWER(rc_tiers.email) OR NULLIF(don.telephone_mobile,'') = rc_tiers.telephone)
      AND rc_tiers.utilisateur_id <> df.lot_utilisateur_id
  )
)
SELECT lot_utilisateur_id AS utilisateur_id, count(*) AS bs_suspects
FROM dons_motif
WHERE motif <> '✅ Ok'
  AND (motif <> '👥 Donateur multiple' OR nb_dons_total > 5)
GROUP BY lot_utilisateur_id;`;
}

function buildRdDashboardQueries(id_mission, id_utilisateur, dateRange) {
  return {
    info: buildRdInfoQuery(id_mission),
    roster: buildRdRosterQuery(id_mission),
    table: buildRdTableQuery(id_mission, dateRange),
    age: buildRdAgePieQuery(id_mission, id_utilisateur, dateRange),
    gender: buildRdGenderPieQuery(id_mission, id_utilisateur, dateRange),
    bulletins: buildRdBulletinsParJourQuery(id_mission, id_utilisateur, dateRange),
    suspects: buildRdBsSuspectsQuery(id_mission, dateRange),
  };
}

export { buildRdDashboardQueries };
