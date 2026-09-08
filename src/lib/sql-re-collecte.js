// Requêtes SQL pour le dashboard "RE — Collecte" (/re-collecte.html) : vue
// d'équipe complète sur UNE mission (id_mission, UUID déjà résolu/validé
// côté appelant) — tendance hebdomadaire, table d'équipe, camemberts,
// bulletins/jour, et une liste détaillée des bulletins suspects (y compris
// les dons annulés, avec leur statut affiché). Porté depuis un prototype
// autonome (terrain_dashboard_re_standalone.html) qui se connectait
// directement à Metabase depuis le navigateur — ici les mêmes requêtes
// tournent côté serveur, comme partout ailleurs dans ce projet.
//
// La quasi-totalité des requêtes de ce dashboard sont identiques à celles
// déjà validées pour /rd.html et /mission.html — on les réutilise telles
// quelles plutôt que de les dupliquer ; seule la liste détaillée des
// bulletins suspects (avec statut annulé inclus) est nouvelle ici.

import {
  buildRdInfoQuery,
  buildRdRosterQuery,
  buildRdTableQuery,
  buildRdAgePieQuery,
  buildRdGenderPieQuery,
  buildRdBulletinsParJourQuery,
  buildRdBsSuspectsQuery,
  donMotifCase,
} from './sql-rd.js';
import { buildWeeklyQuery, dateUpToTodayClause } from './sql-mission-suivi.js';

// Liste détaillée des bulletins suspects (section "Bulletins Suspects") :
// contrairement à buildRdBsSuspectsQuery (qui ne renvoie qu'un compte par
// RD), ici on renvoie une ligne par don suspect avec son motif et ses
// coordonnées, en incluant aussi les dons annulés (statut affiché) pour
// garder une trace visible même après annulation.
function buildBulletinsSuspectsListQuery(id_mission, id_utilisateur, dateRange) {
  const rdFilter = id_utilisateur ? `AND l.utilisateur_id = '${id_utilisateur}'` : '';
  const dateFilter = dateUpToTodayClause('l.date', dateRange);
  return `WITH dons_filtres AS (
    SELECT d.*, l.date AS lot_date, l.utilisateur_id AS lot_utilisateur_id
    FROM dons d
    JOIN lots l ON d.lot_id = l.id
    WHERE l.mission_id = '${id_mission}'
      AND d.statut IN ('nouveau', 'transmis', 'en_attente', 'annule')
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
    df.statut AS statut,
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

function buildReCollecteQueries(id_mission, id_utilisateur, dateRange) {
  return {
    info: buildRdInfoQuery(id_mission),
    roster: buildRdRosterQuery(id_mission),
    table: buildRdTableQuery(id_mission, dateRange),
    weekly: buildWeeklyQuery(id_mission, id_utilisateur, dateRange),
    age: buildRdAgePieQuery(id_mission, id_utilisateur, dateRange),
    gender: buildRdGenderPieQuery(id_mission, id_utilisateur, dateRange),
    bulletins: buildRdBulletinsParJourQuery(id_mission, id_utilisateur, dateRange),
    suspects: buildRdBsSuspectsQuery(id_mission, dateRange),
    suspectsList: buildBulletinsSuspectsListQuery(id_mission, id_utilisateur, dateRange),
  };
}

export { buildReCollecteQueries };
