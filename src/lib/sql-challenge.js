// Requêtes SQL pour la page "Challenge" : classements de recruteurs et
// d'équipes, calculés sur TOUTES les missions en_cours (tous clients
// confondus) — contrairement aux autres pages, il n'y a pas de scope
// id_client/id_mission ici, c'est un tableau global usage interne CAE.
// Aucune valeur utilisateur n'est interpolée dans ces requêtes (pas de
// paramètre d'entrée), donc pas de risque d'injection.

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

// Top recruteurs (par volume de BS réel) sur une période [date_min, date_max]
// (bornes incluses), toutes missions en_cours confondues. On regroupe par
// (utilisateur, client) : un recruteur qui a travaillé pour deux clients sur
// la période apparaîtrait sur deux lignes (cas rare en pratique).
function buildTopRecruteursQuery(dateMinExpr, dateMaxExpr) {
  return `with scoped as (
  select l.utilisateur_id, m.client_id, c.nom as client_nom,
    count(distinct d.id) as bs_reel
  from lots l
  join missions m on m.id = l.mission_id and m.statut_mission = 'en_cours'
  join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  left join clients c on c.id = m.client_id
  where l.date between ${dateMinExpr} and ${dateMaxExpr}
  group by 1,2,3
)
select s.utilisateur_id, s.client_nom, s.bs_reel,
  coalesce(uip.prenom,'—') as prenom, coalesce(uip.nom,'') as nom
from scoped s
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = s.utilisateur_id
order by s.bs_reel desc
limit 5;`;
}

// Classement des équipes (= les recruteurs staffés sur une mission en_cours)
// sur la semaine en cours (lundi → aujourd'hui), par taux réel cumulé
// (BS réel / heures de rue).
function buildTopEquipesQuery() {
  return `with scoped_lots as (
  select l.*, m.code_mission, m.code_mission_client, m.client_id, m.responsable_equipe_id
  from lots l
  join missions m on m.id = l.mission_id and m.statut_mission = 'en_cours'
  where l.date between date_trunc('week', current_date)::date and current_date
),
lot_stats as (
  select mission_id,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur, true)) as heures_rue
  from scoped_lots group by 1
),
don_stats as (
  select l.mission_id, count(distinct d.id) as bs_reel
  from scoped_lots l
  join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  group by 1
)
select sm.mission_id, sm.code_mission, sm.code_mission_client, c.nom as client_nom,
  re.prenom as re_prenom, re.nom as re_nom,
  coalesce(ds.bs_reel,0) as bs_reel, coalesce(ls.heures_rue,0) as heures_rue,
  case when coalesce(ls.heures_rue,0) > 0 then coalesce(ds.bs_reel,0)::float / ls.heures_rue else null end as taux_reel
from (select distinct mission_id, code_mission, code_mission_client, client_id, responsable_equipe_id from scoped_lots) sm
left join lot_stats ls on ls.mission_id = sm.mission_id
left join don_stats ds on ds.mission_id = sm.mission_id
left join clients c on c.id = sm.client_id
left join utilisateur_informations_personnelles re on re.utilisateur_id = sm.responsable_equipe_id
order by taux_reel desc nulls last
limit 5;`;
}

// Top recruteurs par volume de BS réel sur la dernière heure glissante
// (basé sur dons.created_at, pas sur lots.date qui est une granularité
// jour — nécessaire pour une fenêtre "dernière heure").
function buildTopRecruteursDerniereHeureQuery() {
  return `with scoped as (
  select l.utilisateur_id, m.client_id, c.nom as client_nom,
    count(distinct d.id) as bs_reel
  from lots l
  join missions m on m.id = l.mission_id and m.statut_mission = 'en_cours'
  join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
    and d.created_at >= now() - interval '1 hour'
  left join clients c on c.id = m.client_id
  group by 1,2,3
)
select s.utilisateur_id, s.client_nom, s.bs_reel,
  coalesce(uip.prenom,'—') as prenom, coalesce(uip.nom,'') as nom
from scoped s
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = s.utilisateur_id
order by s.bs_reel desc
limit 5;`;
}

// Classement des missions en_cours par moyenne d'âge donateur la plus
// élevée (moyenne, pas médiane — demande explicite). On exige au moins 3
// dons pour éviter qu'une mission avec 1 seul don pilote le classement.
function buildAgeMoyenQuery() {
  return `select m.id as mission_id, m.code_mission, m.code_mission_client, c.nom as client_nom,
  round(avg(extract(year from age(don.date_de_naissance)))::numeric,1) as age_moyen,
  count(distinct d.id) as nb_dons
from missions m
join lots l on l.mission_id = m.id
join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
join donateurs don on don.id = d.donateur_id and don.date_de_naissance is not null
left join clients c on c.id = m.client_id
where m.statut_mission = 'en_cours'
group by 1,2,3,4
having count(distinct d.id) >= 3
order by age_moyen desc
limit 5;`;
}

// Recruteurs "sur le terrain aujourd'hui" : ceux qui ont un lot daté
// d'aujourd'hui sur une mission en_cours. Sert de base pour les encarts
// "c'est leur anniversaire" et "c'est leur fête" (filtrage côté front-end).
function buildActiveRecruteursQuery() {
  return `select distinct l.utilisateur_id, uip.prenom, uip.nom, uip.date_de_naissance,
  m.code_mission, m.code_mission_client, c.nom as client_nom
from lots l
join missions m on m.id = l.mission_id and m.statut_mission = 'en_cours'
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = l.utilisateur_id
left join clients c on c.id = m.client_id
where l.date = current_date
  and uip.prenom is not null;`;
}

function buildChallengeQueries() {
  return {
    hourlyTop: buildTopRecruteursDerniereHeureQuery(),
    dailyTop: buildTopRecruteursQuery('current_date', 'current_date'),
    weeklyTop: buildTopRecruteursQuery("date_trunc('week', current_date)::date", 'current_date'),
    weeklyTeams: buildTopEquipesQuery(),
    ageMoyenTop: buildAgeMoyenQuery(),
    activeRecruteurs: buildActiveRecruteursQuery(),
  };
}

export { buildChallengeQueries };
