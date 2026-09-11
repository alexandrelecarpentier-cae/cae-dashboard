// Requêtes SQL pour le dashboard "Direction" (/direction) : sous-ensemble
// des KPI COMEX listés dans le fichier fourni par l'utilisateur
// ("KPIs Direction") dont la formule est entièrement calculable à partir
// des données déjà en base (missions, lots, dons, contrats). Les KPI du
// fichier source qui reposent sur des données absentes de ce schéma
// (objectifs financiers, seuils "idéal"/"besoin", grille de lancement,
// outils non connectés comme SELLSY/INCIDENTATOR/CIRCLE) ne sont PAS
// construits ici — ils sont listés côté front comme "non disponible".
//
// Filtres optionnels, tous combinables (comme /rh) : association
// (id_client), statut de mission (statut_mission), période (date_from/
// date_to, sur lots.date). Hors clients exclus (excluded-clients.js).
import { excludeClientsClause } from './excluded-clients.js';

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

function filtersClause(p) {
  const clauses = ['1=1'];
  if (p.id_client) clauses.push(`m.client_id = '${p.id_client}'`);
  if (p.statut_mission) clauses.push(`m.statut_mission = '${p.statut_mission}'`);
  if (p.date_from) clauses.push(`l.date >= '${p.date_from}'`);
  if (p.date_to) clauses.push(`l.date <= '${p.date_to}'`);
  return clauses.join(' AND ');
}

// CTE de base : lots filtrés + dons valides associés + éclatement des
// jours de présence/absence (avec motif d'absence, pour l'absentéisme).
function baseCte(p) {
  return `with lots_f as (
  select l.id, l.mission_id, l.presence_recruteur, l.nombre_horaires_rue, l.nombre_horaires_remuneration, l.absence_id
  from lots l
  join missions m on m.id = l.mission_id
  where ${filtersClause(p)}
    ${excludeClientsClause('m')}
),
dons_f as (
  select d.id, d.montant, d.lot_id, d.created_at, dn.date_de_naissance
  from dons d
  join lots_f l on l.id = d.lot_id
  left join donateurs dn on dn.id = d.donateur_id
  where d.statut in ${STATUTS_VALIDES}
),
absences_f as (
  -- "Absentéisme = 1 - taux de présence (hors AM)" (fichier source, règle
  -- non tranchée sur le périmètre exact des AM = arrêts maladie) : on
  -- exclut du numérateur les seuls jours d'absence dont le motif contient
  -- "maladie" (types_absences.libelle), pas les absences "autorisées"
  -- (contrairement à taux_absence_injustifiee de sql-rd.js, qui exclut
  -- les deux) — à ajuster si la définition métier de "AM" est précisée.
  select l.id,
    case when l.presence_recruteur = true then 1 else 0 end as jour_presence,
    case when l.presence_recruteur = false then 1 else 0 end as jour_absence,
    case when l.presence_recruteur = false and (tya.libelle is null or tya.libelle not ilike '%maladie%') then 1 else 0 end as jour_absence_hors_am
  from lots_f l
  left join absences ab on ab.id = l.absence_id
  left join types_absences tya on tya.id = ab.type_absence_id
)`;
}

// Indicateurs globaux du périmètre filtré :
// - taux_reel_point_mort = BS réel / heures rémunérées (formule spécifique
//   du fichier source — différente du "taux réel" = BS/heures RUE utilisé
//   partout ailleurs dans le projet ; 0,28 = point mort selon le fichier).
// - ratio_h = heures de rue / heures rémunérées.
// - don_moyen, age_median, pct_plus_25 ans = mêmes formules que /rd
//   ("3 critères qualité"), sur les dons valides du périmètre.
// - absenteisme = 1 - taux de présence hors AM (voir baseCte).
function buildGlobalStatsQuery(p) {
  return `${baseCte(p)}
select
  (select count(*) from lots_f) as nb_lots,
  (select count(distinct mission_id) from lots_f) as nb_missions,
  (select sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) from lots_f) as heures_rue,
  (select sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) from lots_f) as heures_remuneration,
  (select count(distinct id) from dons_f) as bs_reel,
  case when (select sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) from lots_f) > 0
    then (select count(distinct id) from dons_f)::float / (select sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) from lots_f)
    else null end as taux_reel_point_mort,
  case when (select sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) from lots_f) > 0
    then (select sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) from lots_f)::float / (select sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) from lots_f)
    else null end as ratio_h,
  (select avg(montant) from dons_f) as don_moyen,
  (select percentile_cont(0.5) within group (order by (created_at::date - date_de_naissance)::float / 365.0) from dons_f where date_de_naissance is not null) as age_median,
  case when (select count(*) from dons_f where date_de_naissance is not null) > 0
    then (select count(*) from dons_f where date_de_naissance is not null and (created_at::date - date_de_naissance)::float / 365.0 >= 25)::float
         / (select count(*) from dons_f where date_de_naissance is not null)
    else null end as pct_plus_25,
  case when (select sum(jour_presence) + sum(jour_absence) from absences_f) > 0
    then (select sum(jour_absence_hors_am) from absences_f)::float / (select sum(jour_presence) + sum(jour_absence) from absences_f)
    else null end as absenteisme;`;
}

// Composition de l'effectif actif sur le périmètre filtré (recruteurs
// ayant au moins un lot filtré) :
// - ratio anciens/nouveaux : "anciens" = >= 3 missions au total (toute
//   leur carrière, pas seulement le périmètre filtré), "nouveaux" = < 3 —
//   règle donnée par le fichier source.
// - grades RD/RDC/RDE : dernier contrat (le plus récent, toutes missions)
//   de chaque recruteur actif, pour les ratios "RDC vs RD" et "RDE vs
//   RDC" du fichier source (le grade "RDD" cité dans le fichier n'existe
//   pas dans contrats.statut — voir NOTE-INDICATEURS / non disponible).
function buildEffectifQuery(p) {
  return `with lots_f as (
  select l.id, l.utilisateur_id
  from lots l
  join missions m on m.id = l.mission_id
  where ${filtersClause(p)}
    ${excludeClientsClause('m')}
),
recruteurs_actifs as (
  select distinct utilisateur_id from lots_f where utilisateur_id is not null
),
mission_count as (
  select c.utilisateur_id, count(distinct c.mission_id) as nb_missions
  from contrats c
  join missions m on m.id = c.mission_id
  where c.utilisateur_id in (select utilisateur_id from recruteurs_actifs)
    ${excludeClientsClause('m')}
  group by 1
),
dernier_contrat as (
  select distinct on (c.utilisateur_id) c.utilisateur_id, c.statut as grade
  from contrats c
  where c.utilisateur_id in (select utilisateur_id from recruteurs_actifs)
  order by c.utilisateur_id, c.date_debut desc nulls last
),
classif as (
  select ra.utilisateur_id,
    coalesce(mc.nb_missions, 0) as nb_missions,
    case when coalesce(mc.nb_missions, 0) >= 3 then 'ancien' else 'nouveau' end as categorie,
    dc.grade
  from recruteurs_actifs ra
  left join mission_count mc on mc.utilisateur_id = ra.utilisateur_id
  left join dernier_contrat dc on dc.utilisateur_id = ra.utilisateur_id
)
select
  count(*) as nb_recruteurs_actifs,
  count(*) filter (where categorie = 'ancien') as nb_anciens,
  count(*) filter (where categorie = 'nouveau') as nb_nouveaux,
  case when count(*) filter (where categorie = 'nouveau') > 0
    then count(*) filter (where categorie = 'ancien')::float / count(*) filter (where categorie = 'nouveau')
    else null end as ratio_anciens_nouveaux,
  count(*) filter (where grade = 'RD') as nb_rd,
  count(*) filter (where grade = 'RDC') as nb_rdc,
  count(*) filter (where grade = 'RDE') as nb_rde,
  case when count(*) filter (where grade = 'RD') > 0
    then count(*) filter (where grade = 'RDC')::float / count(*) filter (where grade = 'RD')
    else null end as ratio_rdc_rd,
  case when count(*) filter (where grade = 'RDC') > 0
    then count(*) filter (where grade = 'RDE')::float / count(*) filter (where grade = 'RDC')
    else null end as ratio_rde_rdc
from classif;`;
}

// Taux de FPE (fin de période d'essai) du périmètre, basé sur la date de
// contrat (contrats.date_debut) — même logique que sql-rh.js, mais sans
// distinction d'initiative employeur/salarié (le fichier source ne la
// demande pas au niveau COMEX : "Taux de FPE (à mesurer mais pas à
// objectiver)").
function contratsFiltersClause(p) {
  const clauses = ['c.date_debut is not null'];
  if (p.id_client) clauses.push(`m.client_id = '${p.id_client}'`);
  if (p.statut_mission) clauses.push(`m.statut_mission = '${p.statut_mission}'`);
  if (p.date_from) clauses.push(`c.date_debut >= '${p.date_from}'`);
  if (p.date_to) clauses.push(`c.date_debut <= '${p.date_to}'`);
  return clauses.join(' AND ');
}
function buildFpeQuery(p) {
  return `with contrats_f as (
  select c.id
  from contrats c
  join missions m on m.id = c.mission_id
  where ${contratsFiltersClause(p)}
    ${excludeClientsClause('m')}
),
fpe_f as (
  select av.contrat_id
  from avenants av
  join types_avenants ta on ta.id = av.type_avenant_id
  join contrats_f cf on cf.id = av.contrat_id
  where ta.categorie = 'fin_period_essai'
)
select
  count(distinct cf.id) as nb_contrats,
  count(distinct fpe_f.contrat_id) as nb_fpe,
  case when count(distinct cf.id) > 0
    then count(distinct fpe_f.contrat_id)::float / count(distinct cf.id)
    else null end as taux_fpe
from contrats_f cf
left join fpe_f on fpe_f.contrat_id = cf.id;`;
}

// Avancement de l'objectif BS par mission : BS réel cumulé (tous dons
// valides de la mission, indépendamment de la période filtrée — c'est un
// avancement de mission, pas un flux périodique) vs
// missions.objectif_bulletin_theorique (le seul champ d'objectif présent
// en base ; "Volume prévisionnel" et "objectif prévisionnel" du fichier
// source, qui seraient deux valeurs distinctes, n'existent pas). Limité
// aux missions avec un objectif renseigné.
function missionOnlyFiltersClause(p) {
  const clauses = ['m.objectif_bulletin_theorique is not null'];
  if (p.id_client) clauses.push(`m.client_id = '${p.id_client}'`);
  if (p.statut_mission) clauses.push(`m.statut_mission = '${p.statut_mission}'`);
  return clauses.join(' AND ');
}
function buildObjectifMissionsQuery(p) {
  return `with scoped_missions as (
  select m.id, m.code_mission, m.statut_mission, cl.nom as client_nom, m.objectif_bulletin_theorique
  from missions m
  left join clients cl on cl.id = m.client_id
  where ${missionOnlyFiltersClause(p)}
    ${excludeClientsClause('m')}
),
dons_mission as (
  select l.mission_id, count(distinct d.id) as bs_reel
  from lots l
  join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  where l.mission_id in (select id from scoped_missions)
  group by 1
)
select sm.id as mission_id, sm.code_mission, sm.client_nom, sm.statut_mission, sm.objectif_bulletin_theorique,
  coalesce(dm.bs_reel, 0) as bs_reel,
  case when sm.objectif_bulletin_theorique > 0
    then coalesce(dm.bs_reel, 0)::float / sm.objectif_bulletin_theorique
    else null end as avancement
from scoped_missions sm
left join dons_mission dm on dm.mission_id = sm.id
order by avancement asc nulls last
limit 300;`;
}

function buildClientListQuery() {
  return `select distinct c.id, c.nom
from missions m
join clients c on c.id = m.client_id
where c.nom is not null
  ${excludeClientsClause('m')}
order by c.nom;`;
}

function buildDirectionQueries(p) {
  return {
    globalStats: buildGlobalStatsQuery(p),
    effectif: buildEffectifQuery(p),
    fpe: buildFpeQuery(p),
    objectifMissions: buildObjectifMissionsQuery(p),
  };
}

export { buildDirectionQueries, buildClientListQuery };
