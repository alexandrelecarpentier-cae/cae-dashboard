// Construction des requêtes SQL pour le dashboard client CAE.
// Toutes les valeurs interpolées sont soit validées par regex/whitelist,
// soit échappées (escapeSqlString) avant d'arriver ici — voir dashboard.js
// et metabase.js. Aucune valeur libre n'est jamais concaténée telle quelle.

function missionFilters(p) {
  const clauses = [`m.client_id = '${p.id_client}'`];
  if (p.code_mission_cae) clauses.push(`m.code_mission = '${p.code_mission_cae}'`);
  if (p.code_mission_asso) clauses.push(`m.code_mission_client = '${p.code_mission_asso}'`);
  if (p.statut_mission) clauses.push(`m.statut_mission = '${p.statut_mission}'`);
  if (p.debut_mission) clauses.push(`m.date_debut >= '${p.debut_mission}'`);
  if (p.fin_mission) clauses.push(`m.date_fin <= '${p.fin_mission}'`);
  if (p.mission_ids && p.mission_ids.length) {
    clauses.push(`m.id in (${p.mission_ids.map((id) => `'${id}'`).join(',')})`);
  }
  return clauses.join(' AND ');
}

function lotFilters(p) {
  const clauses = ['1=1'];
  if (p.date_min) clauses.push(`l.date >= '${p.date_min}'`);
  if (p.date_max) clauses.push(`l.date <= '${p.date_max}'`);
  if (p.jour_semaine) clauses.push(`extract(isodow from l.date) = ${p.jour_semaine}`);
  if (p.emplacement) clauses.push(`e.nom = '${p.emplacement}'`);
  return clauses.join(' AND ');
}

function donFilters() {
  return "d.statut in ('en_attente','nouveau','transmis')";
}

function ctePrefix(p) {
  return `with scoped_missions as (
  select id, client_id, code_mission, code_mission_client, statut_mission, date_debut, date_fin
  from missions m
  where ${missionFilters(p)}
),
scoped_lots as (
  select l.*, e.ville as ville_emplacement, e.nom as nom_emplacement
  from lots l
  join scoped_missions m on l.mission_id = m.id
  left join emplacements e on e.id = l.emplacement_id
  where ${lotFilters(p)}
),
scoped_dons_all as (
  select d.*, don.civilite,
         extract(year from age(now(), don.date_de_naissance)) as age_donateur
  from dons d
  join scoped_lots l on l.id = d.lot_id
  left join donateurs don on don.id = d.donateur_id
),
scoped_dons as (
  select * from scoped_dons_all d where ${donFilters(p)}
)`;
}

function buildQueries(p) {
  const cte = ctePrefix(p);
  return {
    info: `${cte}
select c.nom as client_nom, c.raison_sociale, c.couleur, sm.code_mission, sm.code_mission_client,
       sm.statut_mission, sm.date_debut, sm.date_fin
from clients c
left join scoped_missions sm on true
where c.id = '${p.id_client}'
limit 10;`,

    kpis: `${cte},
kpi_missions as (
  select count(distinct id) as nb_missions
  from scoped_missions where statut_mission in ('terminee','en_cours','en_attente')
),
kpi_dons as (
  select count(distinct id) as nb_dons, avg(montant) as don_moyen
  from scoped_dons
),
kpi_heures as (
  select sum(nombre_horaires_rue) as heures_rue, sum(nombre_horaires_remuneration) as heures_rem
  from scoped_lots where coalesce(presence_recruteur, true)
),
kpi_age as (
  select avg(age_donateur) as age_moyen from scoped_dons
)
select
  (select nb_missions from kpi_missions) as nb_missions,
  (select nb_dons from kpi_dons) as nb_dons,
  (select don_moyen from kpi_dons) as don_moyen,
  (select heures_rue from kpi_heures) as heures_rue,
  (select heures_rem from kpi_heures) as heures_rem,
  case when (select heures_rue from kpi_heures) > 0
    then (select nb_dons from kpi_dons)::float / (select heures_rue from kpi_heures)
    else null end as taux_reel,
  (select age_moyen from kpi_age) as age_moyen;`,

    genre: `${cte}
select civilite, count(distinct id) as nb
from scoped_dons
where coalesce(civilite,'') <> ''
group by civilite;`,

    tranche_age: `${cte}
select
  case when age_donateur <= 20 then '18-20' when age_donateur between 21 and 25 then '21-25'
       when age_donateur between 26 and 35 then '26-35' when age_donateur between 36 and 50 then '36-50'
       else '50 et +' end as tranche,
  count(distinct id) as nb
from scoped_dons group by 1;`,

    bulletins_semaine: `${cte}
select date_trunc('week', created_at)::date as semaine, statut, count(distinct id) as nb
from scoped_dons
group by 1,2 order by 1;`,

    bulletins_transmis: `${cte}
select d.date_transmission, d.rum, d.montant, m.code_mission_client,
       don.nom, don.prenom, m.code_mission, l.ville_emplacement, l.nom_emplacement
from scoped_dons d
join scoped_lots l on l.id = d.lot_id
join scoped_missions m on m.id = l.mission_id
left join donateurs don on don.id = d.donateur_id
where d.statut = 'transmis' and d.date_transmission is not null
order by d.date_transmission desc
limit 200;`,
  };
}

function buildMissionsListQuery(id_client) {
  return `select m.id, m.code_mission, m.code_mission_client, m.statut_mission,
       m.date_debut, m.date_fin, m.ville_principale, m.type_mission
from missions m
where m.client_id = '${id_client}' and m.statut_mission in ('en_cours','terminee')
order by m.date_debut desc nulls last
limit 100;`;
}

function buildFacetsQuery(p) {
  const cte = `with scoped_missions as (
  select id from missions m where ${missionFilters(p)}
),
scoped_lots as (
  select l.*, e.ville as ville_emplacement, e.nom as nom_emplacement
  from lots l
  join scoped_missions m on l.mission_id = m.id
  left join emplacements e on e.id = l.emplacement_id
)`;
  return `${cte}
select distinct ville_emplacement, nom_emplacement
from scoped_lots
where ville_emplacement is not null or nom_emplacement is not null
order by 1, 2
limit 300;`;
}

export { buildQueries, buildMissionsListQuery, buildFacetsQuery };
