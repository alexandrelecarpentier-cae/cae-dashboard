// Requêtes SQL pour la fiche "emplacement" (/emplacement?id_emplacement=...).
// Vue centrée sur UN lieu de rue : quelles missions y sont passées, avec
// quels indicateurs (BS réel, taux réel) par mission. id_emplacement est un
// UUID déjà validé par metabase.js (RE_UUID) avant d'arriver ici.
const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

function buildInfoQuery(id_emplacement) {
  return `select id, nom, type_emplacement, categorie, adresse, code_postal, ville, pays
from emplacements
where id = '${id_emplacement}';`;
}

function buildMissionsQuery(id_emplacement) {
  return `with e as (select '${id_emplacement}'::uuid as id),
lots_e as (
  select l.id, l.mission_id, l.date, l.nombre_horaires_rue, l.presence_recruteur
  from lots l join e on l.emplacement_id = e.id
),
par_mission as (
  select mission_id,
    count(distinct date) as nb_jours,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue,
    min(date) as premiere_date, max(date) as derniere_date
  from lots_e group by 1
),
dons_e as (
  select l.mission_id, count(distinct d.id) as bs_reel
  from lots_e l join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  group by 1
)
select m.id as mission_id, m.code_mission, m.code_mission_client, m.statut_mission, cl.nom as client_nom,
  pm.nb_jours, pm.heures_rue, pm.premiere_date, pm.derniere_date,
  coalesce(de.bs_reel,0) as bs_reel,
  case when coalesce(pm.heures_rue,0) > 0 then coalesce(de.bs_reel,0)::float / pm.heures_rue else null end as taux_reel
from par_mission pm
join missions m on m.id = pm.mission_id
left join clients cl on cl.id = m.client_id
left join dons_e de on de.mission_id = pm.mission_id
order by pm.derniere_date desc;`;
}

// Nombre de recruteurs différents ayant travaillé sur cet emplacement,
// toutes missions confondues (indicateur global de la fiche, pas par
// mission).
function buildRecruteursDistinctsQuery(id_emplacement) {
  return `select count(distinct l.utilisateur_id) as nb_recruteurs
from lots l
where l.emplacement_id = '${id_emplacement}';`;
}

function buildEmplacementQueries(id_emplacement) {
  return {
    info: buildInfoQuery(id_emplacement),
    missions: buildMissionsQuery(id_emplacement),
    recruteurs: buildRecruteursDistinctsQuery(id_emplacement),
  };
}

export { buildEmplacementQueries };
