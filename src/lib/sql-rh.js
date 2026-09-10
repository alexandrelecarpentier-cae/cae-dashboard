// Requêtes SQL pour le dashboard "RH" (/rh) : suivi du taux réel, du taux
// d'absence et de la qualité de saisie des lots (complétion de la présence
// recruteur et de l'emplacement), mission par mission, avec la possibilité
// de détailler la performance de chaque recruteur d'une mission donnée.
//
// Conventions :
// - taux_reel = BS réel / heures de rue (moyenne pondérée : somme des BS
//   réels / somme des heures rue, jamais une moyenne de taux journaliers),
//   comme partout ailleurs dans ce projet.
// - taux_absence = jours d'absence / (jours de présence + jours d'absence),
//   où présence/absence sont déterminés par lots.presence_recruteur
//   (TRUE/FALSE) ; les lots où ce champ n'est pas renseigné (NULL) sont
//   exclus de ce calcul (ni présence ni absence connue) — même logique que
//   /rd.html (Suivi Qualité).
// - taux_completion_presence = part des lots où presence_recruteur EST
//   renseigné (non NULL) parmi tous les lots. Vérifié en base : sur les 12
//   derniers mois, environ 15% des lots n'ont pas ce champ rempli — un vrai
//   indicateur de qualité de saisie, pas un cas marginal.
// - taux_completion_emplacement = part des lots où emplacement_id EST
//   renseigné parmi tous les lots. Vérifié en base : environ la moitié des
//   lots n'ont pas d'emplacement associé sur la même période.
import { excludeClientsClause } from './excluded-clients.js';

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

// Filtres optionnels de la vue d'ensemble (cross-missions) : association,
// statut de mission, période (sur la date des lots). Tous combinables,
// aucun requis.
function filtersClause(p) {
  const clauses = ['1=1'];
  if (p.id_client) clauses.push(`m.client_id = '${p.id_client}'`);
  if (p.statut_mission) clauses.push(`m.statut_mission = '${p.statut_mission}'`);
  if (p.date_from) clauses.push(`l.date >= '${p.date_from}'`);
  if (p.date_to) clauses.push(`l.date <= '${p.date_to}'`);
  return clauses.join(' AND ');
}

// CTE de base partagée par les requêtes cross-missions (indicateurs
// globaux + tableau missions) : les lots filtrés, plus les dons valides
// associés, hors clients exclus.
function baseCte(p) {
  return `with lots_f as (
  select l.id, l.mission_id, l.utilisateur_id, l.presence_recruteur, l.emplacement_id, l.nombre_horaires_rue
  from lots l
  join missions m on m.id = l.mission_id
  where ${filtersClause(p)}
    ${excludeClientsClause('m')}
),
dons_f as (
  select d.id, d.lot_id
  from dons d
  join lots_f l on l.id = d.lot_id
  where d.statut in ${STATUTS_VALIDES}
)`;
}

// Indicateurs globaux, tous les missions du périmètre filtré confondues :
// nb de missions couvertes, heures rue, BS réel, taux réel, taux
// d'absence, et les deux taux de complétion de saisie des lots.
function buildGlobalStatsQuery(p) {
  return `${baseCte(p)},
agg as (
  select
    count(*) as nb_lots,
    count(distinct mission_id) as nb_missions,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
    count(*) filter (where presence_recruteur = true) as jours_presence,
    count(*) filter (where presence_recruteur = false) as jours_absence,
    count(*) filter (where emplacement_id is not null) as lots_emplacement_renseigne
  from lots_f
),
dons_agg as (
  select count(distinct id) as bs_reel from dons_f
)
select
  a.nb_missions, a.heures_rue,
  coalesce(da.bs_reel, 0) as bs_reel,
  case when coalesce(a.heures_rue,0) > 0 then coalesce(da.bs_reel,0)::float / a.heures_rue else null end as taux_reel,
  case when (a.jours_presence + a.jours_absence) > 0 then a.jours_absence::float / (a.jours_presence + a.jours_absence) else null end as taux_absence,
  case when a.nb_lots > 0 then a.lots_presence_renseignee::float / a.nb_lots else null end as taux_completion_presence,
  case when a.nb_lots > 0 then a.lots_emplacement_renseigne::float / a.nb_lots else null end as taux_completion_emplacement
from agg a, dons_agg da;`;
}

// Tableau principal : une ligne par mission du périmètre filtré, triée par
// heures de rue décroissantes (missions les plus actives en premier).
function buildMissionsOverviewQuery(p) {
  return `${baseCte(p)},
par_mission as (
  select mission_id,
    count(*) as nb_lots,
    count(distinct utilisateur_id) as nb_recruteurs,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
    count(*) filter (where presence_recruteur = true) as jours_presence,
    count(*) filter (where presence_recruteur = false) as jours_absence,
    count(*) filter (where emplacement_id is not null) as lots_emplacement_renseigne
  from lots_f
  group by 1
),
dons_mission as (
  select l.mission_id, count(distinct d.id) as bs_reel
  from dons_f d
  join lots_f l on l.id = d.lot_id
  group by 1
)
select m.id as mission_id, m.code_mission, m.code_mission_client, m.statut_mission, cl.nom as client_nom,
  pm.nb_recruteurs, pm.heures_rue,
  coalesce(dm.bs_reel, 0) as bs_reel,
  case when coalesce(pm.heures_rue,0) > 0 then coalesce(dm.bs_reel,0)::float / pm.heures_rue else null end as taux_reel,
  case when (pm.jours_presence + pm.jours_absence) > 0 then pm.jours_absence::float / (pm.jours_presence + pm.jours_absence) else null end as taux_absence,
  case when pm.nb_lots > 0 then pm.lots_presence_renseignee::float / pm.nb_lots else null end as taux_completion_presence,
  case when pm.nb_lots > 0 then pm.lots_emplacement_renseigne::float / pm.nb_lots else null end as taux_completion_emplacement
from par_mission pm
join missions m on m.id = pm.mission_id
left join clients cl on cl.id = m.client_id
left join dons_mission dm on dm.mission_id = pm.mission_id
order by pm.heures_rue desc nulls last;`;
}

function dateFilterClause(col, dateRange) {
  return dateRange ? `AND ${col} >= '${dateRange.from}' AND ${col} <= '${dateRange.to}'` : '';
}

// Détail par recruteur pour UNE mission (id_mission déjà validé en UUID et
// vérifié non exclu côté appelant, comme /rd.html) : une ligne par
// recruteur ayant au moins un lot sur la mission (dans la plage de dates
// éventuelle), plus une ligne TOTAL. Mêmes indicateurs que la vue
// d'ensemble, au niveau recruteur, complétés par le don moyen.
function buildRecruteursParMissionQuery(id_mission, dateRange) {
  const dateFilter = dateFilterClause('l.date', dateRange);
  return `with lots_f as (
  select l.id, l.utilisateur_id, l.presence_recruteur, l.emplacement_id, l.nombre_horaires_rue
  from lots l
  where l.mission_id = '${id_mission}'
    ${dateFilter}
),
dons_f as (
  select d.id, d.lot_id, d.montant
  from dons d
  join lots_f l on l.id = d.lot_id
  where d.statut in ${STATUTS_VALIDES}
),
par_recruteur as (
  select utilisateur_id,
    count(*) as nb_lots,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
    count(*) filter (where presence_recruteur = true) as jours_presence,
    count(*) filter (where presence_recruteur = false) as jours_absence,
    count(*) filter (where emplacement_id is not null) as lots_emplacement_renseigne
  from lots_f
  group by 1
),
dons_recruteur as (
  select l.utilisateur_id, count(distinct d.id) as bs_reel, avg(d.montant) as don_moyen
  from dons_f d
  join lots_f l on l.id = d.lot_id
  group by 1
),
recruteur_rows as (
  select
    0 as sort_order,
    pr.utilisateur_id,
    coalesce(uip.prenom || ' ' || uip.nom, u.email) as recruteur,
    pr.nb_lots, pr.heures_rue,
    coalesce(dr.bs_reel, 0) as bs_reel,
    case when coalesce(pr.heures_rue,0) > 0 then coalesce(dr.bs_reel,0)::float / pr.heures_rue else null end as taux_reel,
    case when (pr.jours_presence + pr.jours_absence) > 0 then pr.jours_absence::float / (pr.jours_presence + pr.jours_absence) else null end as taux_absence,
    case when pr.nb_lots > 0 then pr.lots_presence_renseignee::float / pr.nb_lots else null end as taux_completion_presence,
    case when pr.nb_lots > 0 then pr.lots_emplacement_renseigne::float / pr.nb_lots else null end as taux_completion_emplacement,
    dr.don_moyen
  from par_recruteur pr
  left join dons_recruteur dr on dr.utilisateur_id = pr.utilisateur_id
  left join utilisateurs u on u.id = pr.utilisateur_id
  left join utilisateur_informations_personnelles uip on uip.utilisateur_id = pr.utilisateur_id
),
total_agg as (
  select
    count(*) as nb_lots,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
    count(*) filter (where presence_recruteur = true) as jours_presence,
    count(*) filter (where presence_recruteur = false) as jours_absence,
    count(*) filter (where emplacement_id is not null) as lots_emplacement_renseigne
  from lots_f
),
total_dons as (
  select count(distinct id) as bs_reel, avg(montant) as don_moyen from dons_f
),
total_row as (
  select
    1 as sort_order, null::uuid as utilisateur_id, 'TOTAL' as recruteur,
    ta.nb_lots, ta.heures_rue,
    coalesce(td.bs_reel, 0) as bs_reel,
    case when coalesce(ta.heures_rue,0) > 0 then coalesce(td.bs_reel,0)::float / ta.heures_rue else null end as taux_reel,
    case when (ta.jours_presence + ta.jours_absence) > 0 then ta.jours_absence::float / (ta.jours_presence + ta.jours_absence) else null end as taux_absence,
    case when ta.nb_lots > 0 then ta.lots_presence_renseignee::float / ta.nb_lots else null end as taux_completion_presence,
    case when ta.nb_lots > 0 then ta.lots_emplacement_renseigne::float / ta.nb_lots else null end as taux_completion_emplacement,
    td.don_moyen
  from total_agg ta, total_dons td
)
select * from recruteur_rows
union all
select * from total_row
order by sort_order, bs_reel desc nulls last;`;
}

// Listes de référence pour les filtres (associations / missions), toutes
// missions confondues (pas seulement celles avec des emplacements privés,
// contrairement à /site-prive) — construites une seule fois côté front.
function buildClientListQuery() {
  return `select distinct c.id, c.nom
from missions m
join clients c on c.id = m.client_id
where c.nom is not null
  ${excludeClientsClause('m')}
order by c.nom;`;
}

function buildMissionListQuery() {
  return `select distinct m.id, m.code_mission, c.nom as client_nom
from missions m
left join clients c on c.id = m.client_id
where 1=1 ${excludeClientsClause('m')}
order by m.code_mission;`;
}

function buildRhQueries(p) {
  return {
    globalStats: buildGlobalStatsQuery(p),
    missionsOverview: buildMissionsOverviewQuery(p),
  };
}

export {
  buildRhQueries,
  buildRecruteursParMissionQuery,
  buildClientListQuery,
  buildMissionListQuery,
};
