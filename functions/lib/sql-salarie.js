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

function buildPerformanceParMissionQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
lots_u as (
  select l.id, l.mission_id, l.nombre_horaires_rue, l.presence_recruteur
  from lots l join u on l.utilisateur_id = u.id
),
heures as (
  select mission_id, sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue
  from lots_u group by 1
),
dons_u as (
  select l.mission_id, count(distinct d.id) as bs_reel
  from lots_u l join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  group by 1
)
select h.mission_id, coalesce(d.bs_reel,0) as bs_reel, coalesce(h.heures_rue,0) as heures_rue,
  case when coalesce(h.heures_rue,0) > 0 then coalesce(d.bs_reel,0)::float / h.heures_rue else null end as taux_reel
from heures h
left join dons_u d on d.mission_id = h.mission_id;`;
}

function buildResumeQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
lots_u as (
  select l.id, l.nombre_horaires_rue, l.presence_recruteur
  from lots l join u on l.utilisateur_id = u.id
),
dons_u as (
  select count(distinct d.id) as bs_reel
  from lots_u l join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
)
select
  (select min(date_debut) from contrats c join u on c.utilisateur_id = u.id) as premiere_mission_le,
  (select count(distinct mission_id) from contrats c join u on c.utilisateur_id = u.id) as nb_missions,
  (select sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) from lots_u) as heures_rue_total,
  (select bs_reel from dons_u) as bs_reel_total;`;
}

// Recherche d'un salarié par nom/prénom pour l'écran de sélection (pas de
// id_utilisateur connu à l'avance côté page). searchTerm doit déjà être
// passé par sanitizeFreeText() côté appelant (apostrophes échappées).
function buildRechercheQuery(searchTerm) {
  return `select u.id as utilisateur_id, uip.prenom, uip.nom,
  max(ctr.statut) as dernier_grade
from utilisateurs u
join utilisateur_informations_personnelles uip on uip.utilisateur_id = u.id
left join contrats ctr on ctr.utilisateur_id = u.id
where u.utilisateur_type = 'salarie'
  and (uip.prenom ilike '%${searchTerm}%' or uip.nom ilike '%${searchTerm}%')
group by 1,2,3
order by uip.nom
limit 20;`;
}

function buildSalarieQueries(id_utilisateur) {
  return {
    identite: buildIdentiteQuery(id_utilisateur),
    missions: buildMissionsQuery(id_utilisateur),
    performance: buildPerformanceParMissionQuery(id_utilisateur),
    resume: buildResumeQuery(id_utilisateur),
  };
}

export { buildSalarieQueries, buildRechercheQuery };
