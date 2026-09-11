// Requêtes SQL pour le dashboard "RH" (/rh) : suivi du taux réel, du taux
// d'absence et de la qualité de saisie des lots (complétion de la présence
// recruteur et de l'emplacement), mission par mission, avec la possibilité
// de détailler la performance de chaque recruteur d'une mission donnée.
//
// Conventions :
// - taux_reel = BS réel / heures de rue (moyenne pondérée : somme des BS
//   réels / somme des heures rue, jamais une moyenne de taux journaliers),
//   comme partout ailleurs dans ce projet.
// - taux_absence = heures rémunérées / (nombre de lots * 7) — formule
//   canonique du projet (identique à /rd.html et /salarie.html).
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
  select l.id, l.mission_id, l.utilisateur_id, l.presence_recruteur, l.emplacement_id, l.nombre_horaires_rue, l.nombre_horaires_remuneration
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
    sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) as heures_remuneration,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
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
  case when a.nb_lots > 0 then coalesce(a.heures_remuneration,0)::float / (a.nb_lots * 7) else null end as taux_absence,
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
    sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) as heures_remuneration,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
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
  case when pm.nb_lots > 0 then coalesce(pm.heures_remuneration,0)::float / (pm.nb_lots * 7) else null end as taux_absence,
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

// ---------------------------------------------------------------
// Requêtes basées sur les CONTRATS (date de contrat = contrats.date_debut,
// pas lots.date) : fin de période d'essai, recrutements dans le temps,
// délai de complétion d'équipe. Mêmes filtres association/statut/période
// que la vue d'ensemble ci-dessus, mais appliqués à la date de début de
// contrat plutôt qu'à la date des lots — deux dimensions temporelles
// différentes sur la même page, comme des filtres globaux appliqués à
// des données de nature différente. Les contrats sans date_debut (rares)
// sont exclus : ils ne peuvent être placés sur aucune ligne du temps.
function contratsFiltersClause(p) {
  const clauses = ['c.date_debut is not null'];
  if (p.id_client) clauses.push(`m.client_id = '${p.id_client}'`);
  if (p.statut_mission) clauses.push(`m.statut_mission = '${p.statut_mission}'`);
  if (p.date_from) clauses.push(`c.date_debut >= '${p.date_from}'`);
  if (p.date_to) clauses.push(`c.date_debut <= '${p.date_to}'`);
  return clauses.join(' AND ');
}

function contratsBaseCte(p) {
  return `with contrats_f as (
  select c.id, c.mission_id, c.date_debut
  from contrats c
  join missions m on m.id = c.mission_id
  where ${contratsFiltersClause(p)}
    ${excludeClientsClause('m')}
)`;
}

// Taux de fin de période d'essai (rupture du contrat au terme de l'essai,
// cf. types_avenants.categorie = 'fin_period_essai' — rupture_contrat=true
// pour ce type), sur le périmètre de contrats filtré, splitté entre
// initiative employeur et initiative salarié via le libellé de l'avenant
// ("Fin de période d'essai à l'initiative de l'employeur"/"du salarié" —
// deux autres libellés legacy de gabarit portent le même sens, d'où le
// filtre par mot-clé plutôt que par id figé).
function buildFpeQuery(p) {
  return `${contratsBaseCte(p)},
fpe_f as (
  select av.contrat_id, ta.libelle
  from avenants av
  join types_avenants ta on ta.id = av.type_avenant_id
  join contrats_f cf on cf.id = av.contrat_id
  where ta.categorie = 'fin_period_essai'
)
select
  count(distinct cf.id) as nb_contrats,
  count(distinct fpe_f.contrat_id) filter (where fpe_f.libelle ilike '%employeur%') as nb_fpe_employeur,
  count(distinct fpe_f.contrat_id) filter (where fpe_f.libelle ilike '%salarié%') as nb_fpe_salarie
from contrats_f cf
left join fpe_f on fpe_f.contrat_id = cf.id;`;
}

// Nombre de recrutements (contrats signés) par jour / semaine / mois
// calendaires réels, sur la base de la date de début de contrat.
function recrutementsBucketSql(granularity) {
  if (granularity === 'semaine') return `date_trunc('week', date_debut)::date`;
  if (granularity === 'mois') return `date_trunc('month', date_debut)::date`;
  return 'date_debut'; // 'jour'
}
function buildRecrutementsQuery(p, granularity) {
  return `${contratsBaseCte(p)}
select ${recrutementsBucketSql(granularity)} as periode, count(distinct id) as nb_recrutements
from contrats_f
group by 1
order by 1;`;
}

// Taux de FPE par jour / semaine / mois (même base contrats que ci-dessus,
// même détection d'avenant que buildFpeQuery), pour le graphe empilé
// employeur/salarié : une ligne par période avec le nb de contrats du
// périmètre et le nb de FPE par initiative, pour que le taux (nb_fpe /
// nb_contrats) soit calculé côté front, cohérent avec le reste du projet
// où les ratios sont recalculés au dernier moment plutôt que moyennés.
function buildFpeEvolutionQuery(p, granularity) {
  return `${contratsBaseCte(p)},
fpe_f as (
  select av.contrat_id, ta.libelle
  from avenants av
  join types_avenants ta on ta.id = av.type_avenant_id
  join contrats_f cf on cf.id = av.contrat_id
  where ta.categorie = 'fin_period_essai'
)
select ${recrutementsBucketSql(granularity)} as periode,
  count(distinct cf.id) as nb_contrats,
  count(distinct fpe_f.contrat_id) filter (where fpe_f.libelle ilike '%employeur%') as nb_fpe_employeur,
  count(distinct fpe_f.contrat_id) filter (where fpe_f.libelle ilike '%salarié%') as nb_fpe_salarie
from contrats_f cf
left join fpe_f on fpe_f.contrat_id = cf.id
group by 1
order by 1;`;
}

// Candidatures (nouveaux candidats créés côté TeamTailor, remontés par
// webhook) par jour / semaine / mois. webhooks_team_tailors est une table
// brute d'événements TeamTailor (jsonb) sans lien direct vers missions ou
// clients : contrairement aux autres requêtes RH, ce périmètre n'est donc
// filtré QUE par la période globale (date_from/date_to), pas par
// association ni statut de mission, qui n'ont pas de sens pour cette
// source. Pour l'événement 'candidate.create', le payload jsonb EST
// directement l'objet candidat (pas de clé "candidate" imbriquée comme
// pour job_application.*, vérifié en base) : id, created_at, etc. sont à
// la racine. Un même candidat peut avoir plusieurs webhooks de création
// (doublons de livraison constatés en base : ~4% des lignes), d'où la
// déduplication par id candidat (on garde la première réception).
function candidaturesFiltersClause(p) {
  const clauses = ["data->>'event_name' = 'candidate.create'"];
  if (p.date_from) clauses.push(`created_at >= '${p.date_from}'`);
  if (p.date_to) clauses.push(`created_at < ('${p.date_to}'::date + interval '1 day')`);
  return clauses.join(' AND ');
}
function candidaturesBucketSql(granularity) {
  if (granularity === 'semaine') return `date_trunc('week', event_date)::date`;
  if (granularity === 'mois') return `date_trunc('month', event_date)::date`;
  return 'event_date::date'; // 'jour'
}
function buildCandidaturesQuery(p, granularity) {
  return `with candidatures_f as (
  select data->>'id' as candidate_id, min(created_at) as event_date
  from webhooks_team_tailors
  where ${candidaturesFiltersClause(p)}
  group by 1
)
select ${candidaturesBucketSql(granularity)} as periode, count(*) as nb_candidatures
from candidatures_f
group by 1
order by 1;`;
}

// Délai de complétion d'équipe par mission : nombre de jours entre le
// début de la mission et l'arrivée du DERNIER recruteur qui l'a rejointe
// (date de début de son contrat) — après cette date, l'équipe n'a plus
// grandi. Il n'existe aucun champ d'effectif cible en base (vérifié :
// missions n'a que des objectifs de bulletins, pas de taille d'équipe
// visée), donc ce délai n'est pas mesuré contre un objectif mais reflète
// combien de temps la constitution de l'équipe a mis à se stabiliser —
// l'indicateur le plus proche de "complétion d'équipe" que les données
// permettent. Utilisé pour la moyenne globale (calculée côté front à
// partir de ces lignes) comme pour la colonne par mission.
function buildCompletionEquipeQuery(p) {
  return `${contratsBaseCte(p)},
par_mission as (
  select cf.mission_id, max(cf.date_debut) as derniere_arrivee, count(distinct cf.id) as nb_recrues
  from contrats_f cf
  group by 1
)
select pm.mission_id, m.code_mission, cl.nom as client_nom,
  m.date_debut as debut_mission, pm.derniere_arrivee, pm.nb_recrues,
  (pm.derniere_arrivee - m.date_debut) as jours_completion_equipe
from par_mission pm
join missions m on m.id = pm.mission_id
left join clients cl on cl.id = m.client_id
where m.date_debut is not null
order by pm.derniere_arrivee desc;`;
}

// Détail par recruteur pour UNE mission (id_mission déjà validé en UUID et
// vérifié non exclu côté appelant, comme /rd.html) : une ligne par
// recruteur ayant au moins un lot sur la mission (dans la plage de dates
// éventuelle), plus une ligne TOTAL. Mêmes indicateurs que la vue
// d'ensemble, au niveau recruteur, complétés par le don moyen.
function buildRecruteursParMissionQuery(id_mission, dateRange) {
  const dateFilter = dateFilterClause('l.date', dateRange);
  return `with lots_f as (
  select l.id, l.utilisateur_id, l.presence_recruteur, l.emplacement_id, l.nombre_horaires_rue, l.nombre_horaires_remuneration
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
    sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) as heures_remuneration,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
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
-- Badge FPE par recruteur : même pattern que contrat_rd/fpe_rd dans
-- sql-rd.js (repris par mission.html / re-collecte.html) — on regarde le
-- contrat le PLUS RECENT du recruteur sur cette mission (pas forcément
-- dans la plage de dates filtrée sur les lots, un contrat n'a qu'une
-- date), et on marque 'FPE' si cet avenant y figure, peu importe
-- l'initiative (contrairement au graphe agrégé employeur/salarié plus
-- haut, ce badge ne distingue pas l'initiative).
contrat_recent as (
  select distinct on (c.utilisateur_id) c.id as contrat_id, c.utilisateur_id
  from contrats c
  where c.mission_id = '${id_mission}'
  order by c.utilisateur_id, c.date_debut desc
),
fpe_recent as (
  select distinct cr.utilisateur_id
  from contrat_recent cr
  join avenants av on av.contrat_id = cr.contrat_id
  join types_avenants ta on ta.id = av.type_avenant_id
  where ta.categorie = 'fin_period_essai'
),
recruteur_rows as (
  select
    0 as sort_order,
    pr.utilisateur_id,
    coalesce(uip.prenom || ' ' || uip.nom, u.email) as recruteur,
    pr.nb_lots, pr.heures_rue,
    coalesce(dr.bs_reel, 0) as bs_reel,
    case when coalesce(pr.heures_rue,0) > 0 then coalesce(dr.bs_reel,0)::float / pr.heures_rue else null end as taux_reel,
    case when pr.nb_lots > 0 then coalesce(pr.heures_remuneration,0)::float / (pr.nb_lots * 7) else null end as taux_absence,
    case when pr.nb_lots > 0 then pr.lots_presence_renseignee::float / pr.nb_lots else null end as taux_completion_presence,
    case when pr.nb_lots > 0 then pr.lots_emplacement_renseigne::float / pr.nb_lots else null end as taux_completion_emplacement,
    dr.don_moyen,
    case when fpe.utilisateur_id is not null then 'FPE' else null end as fpe
  from par_recruteur pr
  left join dons_recruteur dr on dr.utilisateur_id = pr.utilisateur_id
  left join utilisateurs u on u.id = pr.utilisateur_id
  left join utilisateur_informations_personnelles uip on uip.utilisateur_id = pr.utilisateur_id
  left join fpe_recent fpe on fpe.utilisateur_id = pr.utilisateur_id
),
total_agg as (
  select
    count(*) as nb_lots,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue,
    sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur,true)) as heures_remuneration,
    count(*) filter (where presence_recruteur is not null) as lots_presence_renseignee,
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
    case when ta.nb_lots > 0 then coalesce(ta.heures_remuneration,0)::float / (ta.nb_lots * 7) else null end as taux_absence,
    case when ta.nb_lots > 0 then ta.lots_presence_renseignee::float / ta.nb_lots else null end as taux_completion_presence,
    case when ta.nb_lots > 0 then ta.lots_emplacement_renseigne::float / ta.nb_lots else null end as taux_completion_emplacement,
    td.don_moyen,
    null::text as fpe
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
    fpe: buildFpeQuery(p),
    recrutementsParJour: buildRecrutementsQuery(p, 'jour'),
    recrutementsParSemaine: buildRecrutementsQuery(p, 'semaine'),
    recrutementsParMois: buildRecrutementsQuery(p, 'mois'),
    fpeParJour: buildFpeEvolutionQuery(p, 'jour'),
    fpeParSemaine: buildFpeEvolutionQuery(p, 'semaine'),
    fpeParMois: buildFpeEvolutionQuery(p, 'mois'),
    candidaturesParJour: buildCandidaturesQuery(p, 'jour'),
    candidaturesParSemaine: buildCandidaturesQuery(p, 'semaine'),
    candidaturesParMois: buildCandidaturesQuery(p, 'mois'),
    completionEquipe: buildCompletionEquipeQuery(p),
  };
}

export {
  buildRhQueries,
  buildRecruteursParMissionQuery,
  buildClientListQuery,
  buildMissionListQuery,
};
