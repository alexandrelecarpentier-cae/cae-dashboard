// Requêtes SQL pour la fiche individuelle "salarié" (/salarie?id_utilisateur=...).
// Vue centrée sur UNE personne, indépendamment d'une mission précise :
// identité, contrats/missions passés et en cours, indicateurs de performance
// par mission, et un résumé global (ancienneté, cumul BS/heures).
// id_utilisateur est un UUID déjà validé par metabase.js (RE_UUID) avant
// d'arriver ici — donc sûr à interpoler directement, comme dans sql-mission.js.
// Le grade (RD/RDC/RDE/RE...) vient de contrats.statut ; on détecte en plus
// si la personne a été responsable d'équipe (missions.responsable_equipe_id)
// ou responsable de mission (missions.responsable_mission_id) sur chaque
// mission — une même personne peut avoir des rôles différents selon la
// mission.
const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

function buildIdentiteQuery(id_utilisateur) {
  return `select u.id as utilisateur_id, u.email, u.utilisateur_type,
  uip.prenom, uip.nom, uip.date_de_naissance, uip.civilite
from utilisateurs u
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = u.id
where u.id = '${id_utilisateur}'
limit 1;`;
}

function buildMissionsQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id)
select m.id as mission_id, m.code_mission, m.code_mission_client, m.statut_mission,
  m.date_debut, m.date_fin, cl.nom as client_nom,
  ctr.statut as grade, ctr.fonction, ctr.date_debut as contrat_debut, ctr.date_fin as contrat_fin,
  (m.responsable_mission_id = u.id) as est_rm,
  (m.responsable_equipe_id = u.id) as est_re
from contrats ctr
join u on ctr.utilisateur_id = u.id
join missions m on m.id = ctr.mission_id
left join clients cl on cl.id = m.client_id
order by m.date_debut desc nulls last;`;
}

// Performance par mission, incluant :
// - taux_h = heures de rue / heures rémunérées
// - taux_absence = heures rémunérées / (nombre de lots * 7)
// - don_moyen et pct_plus_25 = % de dons dont le donateur avait plus de
//   25 ans au moment du don (date du don - date de naissance, pas l'âge
//   actuel — même convention que sql-mission.js pour bs_moins_25)
// - score_qualite = don_moyen * pct_plus_25 (cf. fichier "Score Qualité"
//   fourni : Don moyen x % de donateurs de + de 25 ans)
function buildPerformanceParMissionQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
lots_u as (
  select l.id, l.mission_id, l.nombre_horaires_rue, l.nombre_horaires_remuneration, l.presence_recruteur, l.heures_remuneration_completes
  from lots l join u on l.utilisateur_id = u.id
),
heures as (
  -- heures_remuneration ne compte que les heures rémunérées déclarées :
  -- coalesce(...,true) garde l'historique (flag jamais renseigné avant la
  -- mise en place de cette déclaration) mais exclut les lots explicitement
  -- marqués comme non déclarés (heures_remuneration_completes = false).
  select mission_id,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue,
    sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true) and coalesce(heures_remuneration_completes,true)) as heures_remuneration,
    count(*) as nb_lots
  from lots_u group by 1
),
dons_u as (
  -- don_moyen se calcule sur tous les dons valides de la mission, qu'on
  -- connaisse ou non la date de naissance du donateur.
  -- nb_dons_avec_naissance = dons dont on connaît la date de naissance du
  -- donateur (donc dont l'âge est calculable). Si aucun don de la mission
  -- n'a cette donnée, pct_plus_25/score_qualite restent null : pas de
  -- calcul faute de donnée fiable (cf. demande utilisateur) — mais
  -- don_moyen reste calculé.
  select l.mission_id,
    count(distinct d.id) as bs_reel,
    count(distinct d.id) filter (where don.date_de_naissance is not null) as nb_dons_avec_naissance,
    avg(d.montant) as don_moyen,
    count(distinct d.id) filter (where (d.created_at::date - don.date_de_naissance) / 365.0 >= 25) as nb_dons_plus_25
  from lots_u l
  join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  left join donateurs don on don.id = d.donateur_id
  group by 1
)
select h.mission_id,
  coalesce(d.bs_reel,0) as bs_reel,
  coalesce(h.heures_rue,0) as heures_rue,
  coalesce(h.heures_remuneration,0) as heures_remuneration,
  h.nb_lots,
  case when coalesce(h.heures_rue,0) > 0 then coalesce(d.bs_reel,0)::float / h.heures_rue else null end as taux_reel,
  case when coalesce(h.heures_remuneration,0) > 0 then coalesce(h.heures_rue,0)::float / h.heures_remuneration else null end as taux_h,
  case when h.nb_lots > 0 then coalesce(h.heures_remuneration,0)::float / (h.nb_lots * 7) else null end as taux_absence,
  d.don_moyen,
  case when coalesce(d.nb_dons_avec_naissance,0) > 0 then coalesce(d.nb_dons_plus_25,0)::float / d.nb_dons_avec_naissance else null end as pct_plus_25,
  case when coalesce(d.nb_dons_avec_naissance,0) > 0 and d.don_moyen is not null
    then d.don_moyen * (coalesce(d.nb_dons_plus_25,0)::float / d.nb_dons_avec_naissance)
    else null end as score_qualite
from heures h
left join dons_u d on d.mission_id = h.mission_id;`;
}

// Résumé global (toutes missions confondues) : ancienneté (première/dernière
// mission), cumul d'heures et taux globaux. Le score qualité global n'est
// PAS ici — il vit dans buildStatutGlobalQuery, limité aux 270 dernières
// heures de rue (cf. demande utilisateur), donc calculé séparément.
function buildResumeQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
lots_u as (
  select l.id, l.nombre_horaires_rue, l.nombre_horaires_remuneration, l.presence_recruteur, l.heures_remuneration_completes
  from lots l join u on l.utilisateur_id = u.id
),
heures as (
  -- cf. buildPerformanceParMissionQuery : heures_remuneration ne compte
  -- que les heures rémunérées déclarées (coalesce(...,true) préserve
  -- l'historique où ce flag n'existait pas encore).
  select
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue_total,
    sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true) and coalesce(heures_remuneration_completes,true)) as heures_remuneration_total,
    count(*) as nb_lots_total
  from lots_u
),
dons_u as (
  select count(distinct d.id) as bs_reel
  from lots_u l join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
)
select
  (select min(date_debut) from contrats c join u on c.utilisateur_id = u.id) as premiere_mission_le,
  (select max(date_debut) from contrats c join u on c.utilisateur_id = u.id) as derniere_mission_le,
  (select count(distinct mission_id) from contrats c join u on c.utilisateur_id = u.id) as nb_missions,
  h.heures_rue_total, h.heures_remuneration_total, h.nb_lots_total,
  case when coalesce(h.heures_remuneration_total,0) > 0 then coalesce(h.heures_rue_total,0)::float / h.heures_remuneration_total else null end as taux_h_total,
  case when h.nb_lots_total > 0 then coalesce(h.heures_remuneration_total,0)::float / (h.nb_lots_total * 7) else null end as taux_absence_total,
  d.bs_reel as bs_reel_total
from heures h cross join dons_u d;`;
}

// Statut global (score qualité) calculé sur les lots des 270 dernières
// heures RÉMUNÉRÉES déclarées uniquement (les plus récentes en premier,
// cumul jusqu'à 270h) — pas sur toute la carrière, pour refléter la
// fiabilité récente plutôt qu'un historique potentiellement ancien/sans
// donnée donateur. coalesce(heures_remuneration_completes,true) exclut les
// lots explicitement non déclarés tout en préservant l'historique où ce
// flag n'existait pas encore.
function buildStatutGlobalQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
lots_u as (
  select l.id, l.date, l.nombre_horaires_remuneration
  from lots l join u on l.utilisateur_id = u.id
  where coalesce(l.presence_recruteur, true) and coalesce(l.heures_remuneration_completes, true)
),
lots_cumul as (
  select id, nombre_horaires_remuneration,
    sum(nombre_horaires_remuneration) over (order by date desc nulls last, id) as cumul_remuneration
  from lots_u
),
lots_270 as (
  select id, nombre_horaires_remuneration from lots_cumul
  where cumul_remuneration - nombre_horaires_remuneration < 270
),
dons_270 as (
  select
    count(distinct d.id) as bs_reel,
    count(distinct d.id) filter (where don.date_de_naissance is not null) as nb_dons_avec_naissance,
    avg(d.montant) as don_moyen,
    count(distinct d.id) filter (where (d.created_at::date - don.date_de_naissance) / 365.0 >= 25) as nb_dons_plus_25
  from lots_270 l
  join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  left join donateurs don on don.id = d.donateur_id
)
select
  (select coalesce(sum(nombre_horaires_remuneration),0) from lots_270) as heures_remuneration_270,
  d.bs_reel as bs_reel_270,
  d.don_moyen as don_moyen_270,
  case when coalesce(d.nb_dons_avec_naissance,0) > 0 then coalesce(d.nb_dons_plus_25,0)::float / d.nb_dons_avec_naissance else null end as pct_plus_25_270,
  case when coalesce(d.nb_dons_avec_naissance,0) > 0 and d.don_moyen is not null
    then d.don_moyen * (coalesce(d.nb_dons_plus_25,0)::float / d.nb_dons_avec_naissance)
    else null end as score_qualite_270
from dons_270 d;`;
}

function buildSalarieQueries(id_utilisateur) {
  return {
    identite: buildIdentiteQuery(id_utilisateur),
    missions: buildMissionsQuery(id_utilisateur),
    performance: buildPerformanceParMissionQuery(id_utilisateur),
    resume: buildResumeQuery(id_utilisateur),
    statutGlobal: buildStatutGlobalQuery(id_utilisateur),
  };
}

export { buildSalarieQueries };
