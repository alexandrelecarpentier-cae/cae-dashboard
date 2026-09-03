// Requêtes SQL pour la page "Performances RE — mission" (dashboard Metabase 15
// : "Suivi mission RE" + "Suivi par RD v3"). Reproduit la même logique
// (statuts valides, taux réel = BS réel / heures rue, etc.) mais filtrée sur
// une seule mission via son id (UUID), passé en paramètre déjà validé
// par metabase.js (RE_UUID) — donc sûr à interpoler.

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";
const STATUTS_RUE = "('nouveau','en_attente','transmis','incomplet','annule')";

function ctePrefix(id_mission, dates) {
  const dateFilter = dates && dates.length
    ? ` and l.date in (${dates.map((d) => `'${d}'`).join(',')})`
    : '';
  return `with scoped_missions as (
  select id, code_mission, code_mission_client, client_id,
         responsable_mission_id, responsable_equipe_id, date_debut, date_fin, statut_mission
  from missions where id = '${id_mission}'
),
scoped_lots as (
  select l.* from lots l join scoped_missions m on l.mission_id = m.id where 1=1${dateFilter}
)`;
}

function buildMissionDaysQuery(id_mission) {
  return `select distinct l.date
from lots l
join missions m on m.id = l.mission_id
where m.id = '${id_mission}' and l.date is not null and l.date <= current_date
order by 1;`;
}

function buildMissionPerformanceQueries(id_mission, dates) {
  const cte = ctePrefix(id_mission, dates);
  return {
    info: `${cte},
tot_lots as (
  select
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur, true)) as heures_rue,
    sum(nombre_horaires_remuneration) filter (where coalesce(presence_recruteur, true)) as heures_rem
  from scoped_lots
),
tot_dons as (
  select
    count(distinct d.id) filter (where d.statut in ${STATUTS_RUE}) as bs_rue,
    count(distinct d.id) filter (where d.statut in ${STATUTS_VALIDES}) as bs_reel,
    count(distinct d.id) filter (where d.statut = 'incomplet') as bs_incomplets,
    count(distinct d.id) filter (where d.statut = 'annule') as bs_annules,
    count(distinct d.id) filter (where d.statut in ${STATUTS_VALIDES}
      and (d.created_at::date - don.date_de_naissance) / 365.0 < 25) as bs_moins_25,
    avg(d.montant) filter (where d.statut in ${STATUTS_VALIDES}) as don_moyen,
    percentile_cont(0.5) within group (order by ((d.created_at::date - don.date_de_naissance) / 365.0))
      filter (where d.statut in ${STATUTS_VALIDES}) as age_median
  from scoped_lots l
  join dons d on d.lot_id = l.id
  left join donateurs don on don.id = d.donateur_id
)
select
  c.nom as client_nom, c.couleur, sm.code_mission, sm.code_mission_client, sm.statut_mission,
  sm.date_debut, sm.date_fin, sm.responsable_mission_id, sm.responsable_equipe_id,
  rm.prenom as rm_prenom, rm.nom as rm_nom, re.prenom as re_prenom, re.nom as re_nom,
  tl.heures_rue, tl.heures_rem,
  td.bs_rue, td.bs_reel, td.bs_incomplets, td.bs_annules, td.bs_moins_25, td.don_moyen, td.age_median,
  case when tl.heures_rue > 0 then td.bs_reel::float / tl.heures_rue else null end as taux_reel,
  case when tl.heures_rem > 0 then tl.heures_rue::float / tl.heures_rem else null end as ratio_h,
  case when td.bs_rue > 0 then td.bs_reel::float / td.bs_rue else null end as taux_transfo,
  case when td.bs_reel > 0 then td.bs_moins_25::float / td.bs_reel else null end as pct_moins_25
from scoped_missions sm
left join clients c on c.id = sm.client_id
left join utilisateur_informations_personnelles rm on rm.utilisateur_id = sm.responsable_mission_id
left join utilisateur_informations_personnelles re on re.utilisateur_id = sm.responsable_equipe_id
cross join tot_lots tl
cross join tot_dons td;`,

    recruteurs: `${cte},
lot_stats as (
  select l.utilisateur_id,
    sum(l.nombre_horaires_rue) filter (where coalesce(l.presence_recruteur, true)) as heures_rue,
    sum(l.nombre_horaires_remuneration) filter (where coalesce(l.presence_recruteur, true)) as heures_rem
  from scoped_lots l group by 1
),
don_stats as (
  select l.utilisateur_id,
    count(distinct d.id) filter (where d.statut in ${STATUTS_RUE}) as bs_rue,
    count(distinct d.id) filter (where d.statut in ${STATUTS_VALIDES}) as bs_reel,
    count(distinct d.id) filter (where d.statut = 'incomplet') as bs_incomplets,
    count(distinct d.id) filter (where d.statut = 'annule') as bs_annules,
    count(distinct d.id) filter (where d.statut in ${STATUTS_VALIDES}
      and (d.created_at::date - don.date_de_naissance) / 365.0 < 25) as bs_moins_25,
    avg(d.montant) filter (where d.statut in ${STATUTS_VALIDES}) as don_moyen,
    percentile_cont(0.5) within group (order by ((d.created_at::date - don.date_de_naissance) / 365.0))
      filter (where d.statut in ${STATUTS_VALIDES}) as age_median
  from scoped_lots l
  join dons d on d.lot_id = l.id
  left join donateurs don on don.id = d.donateur_id
  group by 1
)
select
  coalesce(ls.utilisateur_id, ds.utilisateur_id) as utilisateur_id,
  coalesce(uip.prenom,'—') as prenom, coalesce(uip.nom,'') as nom,
  coalesce(ls.heures_rue,0) as heures_rue, coalesce(ls.heures_rem,0) as heures_rem,
  coalesce(ds.bs_rue,0) as bs_rue, coalesce(ds.bs_reel,0) as bs_reel,
  coalesce(ds.bs_incomplets,0) as bs_incomplets, coalesce(ds.bs_annules,0) as bs_annules,
  ds.don_moyen, ds.age_median,
  case when coalesce(ls.heures_rue,0) > 0 then ds.bs_reel::float / ls.heures_rue else null end as taux_reel,
  case when coalesce(ds.bs_rue,0) > 0 then ds.bs_reel::float / ds.bs_rue else null end as taux_transfo,
  case when coalesce(ds.bs_reel,0) > 0 then ds.bs_moins_25::float / ds.bs_reel else null end as pct_moins_25
from lot_stats ls
full outer join don_stats ds on ds.utilisateur_id = ls.utilisateur_id
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = coalesce(ls.utilisateur_id, ds.utilisateur_id)
order by taux_reel desc nulls last;`,
  };
}

// Requêtes pour la page "Performances individuelles" : un recruteur (id_utilisateur)
// sur une seule mission (id_mission), avec le même filtre de jour(s) optionnel
// que la page mission (dates = null/[] → tout l'historique de la mission).
function buildRecruteurPerformanceQueries(id_mission, id_utilisateur, dates) {
  const cte = ctePrefix(id_mission, dates);
  return {
    info: `${cte}
select
  c.nom as client_nom, c.couleur,
  sm.code_mission, sm.code_mission_client, sm.statut_mission,
  sm.date_debut, sm.date_fin, sm.responsable_equipe_id,
  uip.prenom, uip.nom
from scoped_missions sm
left join clients c on c.id = sm.client_id
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = '${id_utilisateur}'
limit 1;`,

    kpis: `${cte},
lot_stats as (
  select
    sum(l.nombre_horaires_rue) filter (where coalesce(l.presence_recruteur, true)) as heures_rue,
    sum(l.nombre_horaires_remuneration) filter (where coalesce(l.presence_recruteur, true)) as heures_rem
  from scoped_lots l
  where l.utilisateur_id = '${id_utilisateur}'
),
don_stats as (
  select
    count(distinct d.id) filter (where d.statut in ${STATUTS_RUE}) as bs_rue,
    count(distinct d.id) filter (where d.statut in ${STATUTS_VALIDES}) as bs_reel,
    count(distinct d.id) filter (where d.statut = 'incomplet') as bs_incomplets,
    count(distinct d.id) filter (where d.statut = 'annule') as bs_annules,
    count(distinct d.id) filter (where d.statut in ${STATUTS_VALIDES}
      and (d.created_at::date - don.date_de_naissance) / 365.0 < 25) as bs_moins_25,
    avg(d.montant) filter (where d.statut in ${STATUTS_VALIDES}) as don_moyen,
    percentile_cont(0.5) within group (order by ((d.created_at::date - don.date_de_naissance) / 365.0))
      filter (where d.statut in ${STATUTS_VALIDES}) as age_median
  from scoped_lots l
  join dons d on d.lot_id = l.id
  left join donateurs don on don.id = d.donateur_id
  where l.utilisateur_id = '${id_utilisateur}'
)
select
  coalesce(ls.heures_rue,0) as heures_rue, coalesce(ls.heures_rem,0) as heures_rem,
  coalesce(ds.bs_rue,0) as bs_rue, coalesce(ds.bs_reel,0) as bs_reel,
  coalesce(ds.bs_incomplets,0) as bs_incomplets, coalesce(ds.bs_annules,0) as bs_annules,
  ds.don_moyen, ds.age_median,
  case when coalesce(ls.heures_rue,0) > 0 then ds.bs_reel::float / ls.heures_rue else null end as taux_reel,
  case when coalesce(ls.heures_rem,0) > 0 then ls.heures_rue::float / ls.heures_rem else null end as ratio_h,
  case when coalesce(ds.bs_rue,0) > 0 then ds.bs_reel::float / ds.bs_rue else null end as taux_transfo,
  case when coalesce(ds.bs_reel,0) > 0 then ds.bs_moins_25::float / ds.bs_reel else null end as pct_moins_25
from lot_stats ls cross join don_stats ds;`,

    daily: `${cte},
lot_daily as (
  select l.date,
    sum(l.nombre_horaires_rue) filter (where coalesce(l.presence_recruteur, true)) as heures_rue
  from scoped_lots l
  where l.utilisateur_id = '${id_utilisateur}'
  group by l.date
),
don_daily as (
  select l.date,
    count(distinct d.id) filter (where d.statut in ${STATUTS_VALIDES}) as bs_reel
  from scoped_lots l
  join dons d on d.lot_id = l.id
  where l.utilisateur_id = '${id_utilisateur}'
  group by l.date
)
select
  coalesce(ld.date, dd.date) as date,
  coalesce(dd.bs_reel,0) as bs_reel,
  coalesce(ld.heures_rue,0) as heures_rue,
  case when coalesce(ld.heures_rue,0) > 0 then coalesce(dd.bs_reel,0)::float / ld.heures_rue else null end as taux_reel
from lot_daily ld
full outer join don_daily dd on dd.date = ld.date
where coalesce(ld.date, dd.date) is not null and coalesce(ld.date, dd.date) <= current_date
order by 1;`,
  };
}

export { buildMissionPerformanceQueries, buildMissionDaysQuery, buildRecruteurPerformanceQueries };
