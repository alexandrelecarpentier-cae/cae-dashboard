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
import { excludeClientsClause } from './excluded-clients.js';

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

function buildIdentiteQuery(id_utilisateur) {
  return `select u.id as utilisateur_id, u.email, u.utilisateur_type,
  uip.prenom, uip.nom, uip.date_de_naissance, uip.civilite
from utilisateurs u
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = u.id
where u.id = '${id_utilisateur}'
limit 1;`;
}

// Missions de la personne = missions où elle a un contrat OU au moins un lot
// (10/2026 : l'historique ancien — migration depuis l'ancien système — a des
// lots mais pas de contrat ; partir des seuls contrats masquait la majorité
// des missions de certains salariés). Une ligne par mission ; grade/fonction
// et dates de contrat viennent du contrat le plus récent sur la mission
// (null si aucun contrat n'existe en base pour cette mission).
function buildMissionsQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
ms as (
  select c.mission_id from contrats c join u on c.utilisateur_id = u.id
  union
  select l.mission_id from lots l join u on l.utilisateur_id = u.id
),
ctr as (
  select distinct on (c.mission_id) c.mission_id, c.statut, c.fonction, c.date_debut, c.date_fin
  from contrats c join u on c.utilisateur_id = u.id
  order by c.mission_id, c.date_debut desc nulls last
)
select m.id as mission_id, m.code_mission, m.code_mission_client, m.statut_mission,
  m.date_debut, m.date_fin, m.format, cl.nom as client_nom,
  ctr.statut as grade, ctr.fonction, ctr.date_debut as contrat_debut, ctr.date_fin as contrat_fin,
  (m.responsable_mission_id = u.id) as est_rm,
  (m.responsable_equipe_id = u.id) as est_re,
  coalesce(uip_rm.prenom || ' ' || uip_rm.nom, u_rm.email) as rm,
  coalesce(uip_re.prenom || ' ' || uip_re.nom, u_re.email) as re
from ms
join u on true
join missions m on m.id = ms.mission_id
left join ctr on ctr.mission_id = m.id
left join clients cl on cl.id = m.client_id
left join utilisateurs u_rm on u_rm.id = m.responsable_mission_id
left join utilisateur_informations_personnelles uip_rm on uip_rm.utilisateur_id = m.responsable_mission_id
left join utilisateurs u_re on u_re.id = m.responsable_equipe_id
left join utilisateur_informations_personnelles uip_re on uip_re.utilisateur_id = m.responsable_equipe_id
where 1=1 ${excludeClientsClause('m')}
order by m.date_debut desc nulls last;`;
}

// Performance par mission, incluant :
// - taux_h = heures de rue / heures rémunérées
// - taux_presence = jours avec heures rémunérées / nombre de lots prévus — formule
//   canonique du projet (alignée le 9/2026 sur sql-rd.js et sql-rh.js, qui
//   utilisaient auparavant jours_absence/(jours_presence+jours_absence) ;
//   jours_presence/nb_lots est désormais la même formule partout ;
//   champ renommé taux_absence -> taux_presence pour éviter la confusion).
// - don_moyen et pct_plus_25 = % de dons dont le donateur avait plus de
//   25 ans au moment du don (date du don - date de naissance, pas l'âge
//   actuel — même convention que sql-mission.js pour bs_moins_25)
// - score_qualite = don_moyen * pct_plus_25 (cf. fichier "Score Qualité"
//   fourni : Don moyen x % de donateurs de + de 25 ans)
function buildPerformanceParMissionQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
lots_u as (
  select l.id, l.mission_id, l.nombre_horaires_rue, l.nombre_horaires_remuneration, l.heures_remuneration_completes
  from lots l
  join u on l.utilisateur_id = u.id
  join missions m on m.id = l.mission_id
  where 1=1 ${excludeClientsClause('m')}
),
heures as (
  -- heures_remuneration ne compte que les heures rémunérées déclarées :
  -- coalesce(...,true) garde l'historique (flag jamais renseigné avant la
  -- mise en place de cette déclaration) mais exclut les lots explicitement
  -- marqués comme non déclarés (heures_remuneration_completes = false).
  select mission_id,
    sum(nombre_horaires_rue) filter (where coalesce(nombre_horaires_remuneration, 0) <> 0) as heures_rue,
    sum(nombre_horaires_remuneration) filter (where coalesce(nombre_horaires_remuneration, 0) <> 0 and coalesce(heures_remuneration_completes,true)) as heures_remuneration,
    count(*) filter (where coalesce(nombre_horaires_remuneration, 0) <> 0) as jours_presence,
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
    count(distinct d.id) filter (where (d.created_at::date - don.date_de_naissance) / 365.25 >= 25) as nb_dons_plus_25
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
  case when h.nb_lots > 0 then coalesce(h.jours_presence,0)::float / h.nb_lots else null end as taux_presence,
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
ms as (
  select c.mission_id from contrats c join u on c.utilisateur_id = u.id
  union
  select l.mission_id from lots l join u on l.utilisateur_id = u.id
),
lots_u as (
  select l.id, l.nombre_horaires_rue, l.nombre_horaires_remuneration, l.heures_remuneration_completes
  from lots l
  join u on l.utilisateur_id = u.id
  join missions m on m.id = l.mission_id
  where 1=1 ${excludeClientsClause('m')}
),
heures as (
  -- cf. buildPerformanceParMissionQuery : heures_remuneration ne compte
  -- que les heures rémunérées déclarées (coalesce(...,true) préserve
  -- l'historique où ce flag n'existait pas encore).
  select
    sum(nombre_horaires_rue) filter (where coalesce(nombre_horaires_remuneration, 0) <> 0) as heures_rue_total,
    sum(nombre_horaires_remuneration) filter (where coalesce(nombre_horaires_remuneration, 0) <> 0 and coalesce(heures_remuneration_completes,true)) as heures_remuneration_total,
    count(*) filter (where coalesce(nombre_horaires_remuneration, 0) <> 0) as jours_presence_total,
    count(*) as nb_lots_total
  from lots_u
),
dons_u as (
  select count(distinct d.id) as bs_reel
  from lots_u l join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
)
select
  (select min(m.date_debut) from missions m join ms on ms.mission_id = m.id where 1=1 ${excludeClientsClause('m')}) as premiere_mission_le,
  (select max(m.date_debut) from missions m join ms on ms.mission_id = m.id where 1=1 ${excludeClientsClause('m')}) as derniere_mission_le,
  (select count(distinct m.id) from missions m join ms on ms.mission_id = m.id where 1=1 ${excludeClientsClause('m')}) as nb_missions,
  h.heures_rue_total, h.heures_remuneration_total, h.nb_lots_total,
  case when coalesce(h.heures_remuneration_total,0) > 0 then coalesce(h.heures_rue_total,0)::float / h.heures_remuneration_total else null end as taux_h_total,
  case when h.nb_lots_total > 0 then coalesce(h.jours_presence_total,0)::float / h.nb_lots_total else null end as taux_presence_total,
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
  from lots l
  join u on l.utilisateur_id = u.id
  join missions m on m.id = l.mission_id
  where coalesce(l.nombre_horaires_remuneration, 0) <> 0 and coalesce(l.heures_remuneration_completes, true)
    ${excludeClientsClause('m')}
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
    count(distinct d.id) filter (where (d.created_at::date - don.date_de_naissance) / 365.25 >= 25) as nb_dons_plus_25
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

// Profil de recherche (demande explicite 10/2026) :
// - villes_mission : villes distinctes des emplacements où la personne a eu
//   un lot (lots.emplacement_id -> emplacements.ville), clients exclus
//   écartés ; ville_residence : utilisateur_informations_contact.ville.
// - permis : utilisateur_situations.permis_de_conduire (true/false, null si
//   non renseigné).
// - fin_dernier_contrat / contrat_en_cours : date de fin du dernier contrat
//   (max date_fin) ; contrat_en_cours = un contrat n'est pas terminé.
// - jours_depuis_derniere_mission : aujourd'hui - date du dernier lot passé
//   (date <= aujourd'hui) du salarié ; null s'il n'a jamais eu de lot.
// - actif : au jour de la recherche, un lot à venir (aujourd'hui compris) sur
//   une mission en cours OU un contrat non terminé ; sinon inactif.
function buildProfilQuery(id_utilisateur) {
  return `with u as (select '${id_utilisateur}'::uuid as id),
contrats_u as (
  select c.date_debut, c.date_fin
  from contrats c
  join u on c.utilisateur_id = u.id
  join missions m on m.id = c.mission_id
  where 1=1 ${excludeClientsClause('m')}
),
flags as (
  select
    exists(select 1 from contrats_u where date_fin is null or date_fin >= current_date) as contrat_non_termine,
    (select max(date_fin) from contrats_u where date_fin is not null) as derniere_fin,
    exists(
      select 1 from lots l
      join u on l.utilisateur_id = u.id
      join missions m on m.id = l.mission_id
      where l.date >= current_date and m.statut_mission = 'en_cours' ${excludeClientsClause('m')}
    ) as lot_a_venir
)
select
  (select ct.ville from utilisateur_informations_contact ct join u on ct.utilisateur_id = u.id limit 1) as ville_residence,
  (select string_agg(v.ville, ', ' order by lower(v.ville)) from (
    -- une ville par nom (casse ignorée : « PARIS » et « Paris » = même ville),
    -- en préférant la graphie qui n'est pas tout en majuscules
    select distinct on (lower(trim(e.ville))) trim(e.ville) as ville
    from lots l
    join u on l.utilisateur_id = u.id
    join missions m on m.id = l.mission_id
    join emplacements e on e.id = l.emplacement_id
    where e.ville is not null and trim(e.ville) <> '' ${excludeClientsClause('m')}
    order by lower(trim(e.ville)), (trim(e.ville) = upper(trim(e.ville))), trim(e.ville)
  ) v) as villes_mission,
  (select s.permis_de_conduire from utilisateur_situations s join u on s.utilisateur_id = u.id order by s.updated_at desc nulls last limit 1) as permis,
  (select current_date - max(l.date) from lots l join u on l.utilisateur_id = u.id
    join missions m on m.id = l.mission_id
    where l.date <= current_date AND m.client_id NOT IN ('0990fd74-bd60-4bd9-9d28-dbf941c72567', '8f732ffd-ffa7-44ab-a741-f51d92a9c4a9', 'f17e1174-b8a3-4d73-a7ed-ea6f81cb3e3d')) as jours_depuis_derniere_mission,
  f.derniere_fin as fin_dernier_contrat,
  f.contrat_non_termine as contrat_en_cours,
  (f.contrat_non_termine or f.lot_a_venir) as actif
from flags f;`;
}

function buildSalarieQueries(id_utilisateur) {
  return {
    identite: buildIdentiteQuery(id_utilisateur),
    missions: buildMissionsQuery(id_utilisateur),
    performance: buildPerformanceParMissionQuery(id_utilisateur),
    resume: buildResumeQuery(id_utilisateur),
    statutGlobal: buildStatutGlobalQuery(id_utilisateur),
    profil: buildProfilQuery(id_utilisateur),
  };
}

export { buildSalarieQueries };
