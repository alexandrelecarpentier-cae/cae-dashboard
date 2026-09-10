// Requêtes SQL pour la fiche "emplacement" (/emplacement?id_emplacement=...).
// Vue centrée sur UN lieu de rue : quelles missions y sont passées, avec
// quels indicateurs (BS réel, taux réel, don moyen, écart type du taux réel
// jour par jour) par mission, plus des indicateurs et graphes globaux
// (taux réel par jour de semaine / par mois de l'année) tous jours
// confondus à cet emplacement. id_emplacement est un UUID déjà validé par
// metabase.js (RE_UUID) avant d'arriver ici.
import { excludeClientsClause } from './excluded-clients.js';

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

function buildInfoQuery(id_emplacement) {
  return `select id, nom, type_emplacement, categorie, adresse, code_postal, ville, pays
from emplacements
where id = '${id_emplacement}';`;
}

// Liste des missions passées ici, avec pour chacune : ses indicateurs
// habituels (BS réel, taux réel), son don moyen, la liste des dates de
// lots (jours de présence réelle des recruteurs, pour affichage détaillé
// côté front), le nombre moyen de recruteurs par jour, et l'écart type du
// taux réel JOUR PAR JOUR sur les jours de cette mission à cet emplacement
// (mesure de régularité de la performance quotidienne, pas de comparaison
// entre missions).
function buildMissionsQuery(id_emplacement) {
  return `with e as (select '${id_emplacement}'::uuid as id),
lots_e as (
  select l.id, l.mission_id, l.date, l.utilisateur_id, l.nombre_horaires_rue, l.presence_recruteur
  from lots l join e on l.emplacement_id = e.id
),
jours_mission as (
  select mission_id, date,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue_jour,
    count(distinct utilisateur_id) as nb_recruteurs_jour
  from lots_e
  group by 1,2
),
dons_jour as (
  select l.mission_id, l.date, count(distinct d.id) as bs_reel_jour
  from lots_e l join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  group by 1,2
),
taux_jour as (
  select j.mission_id, j.date, j.heures_rue_jour, j.nb_recruteurs_jour,
    coalesce(dj.bs_reel_jour, 0) as bs_reel_jour,
    case when coalesce(j.heures_rue_jour,0) > 0 then coalesce(dj.bs_reel_jour,0)::float / j.heures_rue_jour else null end as taux_reel_jour
  from jours_mission j
  left join dons_jour dj on dj.mission_id = j.mission_id and dj.date = j.date
),
par_mission as (
  select mission_id,
    count(*) as nb_jours,
    sum(heures_rue_jour) as heures_rue,
    avg(nb_recruteurs_jour) as recruteurs_moyen_jour,
    stddev_samp(taux_reel_jour) as ecart_type_taux_reel,
    min(date) as premiere_date, max(date) as derniere_date,
    string_agg(date::text, ',' order by date) as dates_lots
  from taux_jour
  group by 1
),
dons_mission as (
  select l.mission_id, count(distinct d.id) as bs_reel, avg(d.montant) as don_moyen
  from lots_e l join dons d on d.lot_id = l.id and d.statut in ${STATUTS_VALIDES}
  group by 1
)
select m.id as mission_id, m.code_mission, m.code_mission_client, m.statut_mission, cl.nom as client_nom,
  pm.nb_jours, pm.heures_rue, pm.premiere_date, pm.derniere_date, pm.dates_lots,
  pm.recruteurs_moyen_jour, pm.ecart_type_taux_reel,
  coalesce(dm.bs_reel,0) as bs_reel,
  dm.don_moyen,
  case when coalesce(pm.heures_rue,0) > 0 then coalesce(dm.bs_reel,0)::float / pm.heures_rue else null end as taux_reel
from par_mission pm
join missions m on m.id = pm.mission_id
left join clients cl on cl.id = m.client_id
left join dons_mission dm on dm.mission_id = pm.mission_id
where 1=1 ${excludeClientsClause('m')}
order by pm.derniere_date desc;`;
}

// CTE partagée par les 3 requêtes "globales" ci-dessous (stats, taux réel
// par jour de semaine, taux réel par mois) : un jour = une ligne, tous
// jours et toutes missions non exclues confondus à cet emplacement.
// Contrairement à buildMissionsQuery (qui filtre les clients exclus après
// coup, une fois les lignes regroupées par mission), ici le filtre doit
// s'appliquer AVANT le regroupement par date, sinon un jour où deux
// missions différentes seraient passées au même endroit mélangerait des
// heures d'un client exclu dans un total global.
function globalDaysCtePrefix(id_emplacement) {
  return `with e as (select '${id_emplacement}'::uuid as id),
lots_e as (
  select l.id, l.mission_id, l.date, l.utilisateur_id, l.nombre_horaires_rue, l.presence_recruteur
  from lots l
  join e on l.emplacement_id = e.id
  join missions m on m.id = l.mission_id
  where 1=1 ${excludeClientsClause('m')}
),
dons_e as (
  select d.id, d.montant, l.date
  from dons d
  join lots_e l on l.id = d.lot_id
  where d.statut in ${STATUTS_VALIDES}
),
jours as (
  select l.date,
    sum(l.nombre_horaires_rue) filter (where coalesce(l.presence_recruteur,true)) as heures_rue_jour,
    count(distinct l.utilisateur_id) as nb_recruteurs_jour
  from lots_e l
  group by 1
),
dons_jour as (
  select date, count(distinct id) as bs_reel_jour
  from dons_e
  group by 1
),
jours_full as (
  select j.date, j.heures_rue_jour, j.nb_recruteurs_jour,
    coalesce(dj.bs_reel_jour, 0) as bs_reel_jour,
    case when coalesce(j.heures_rue_jour,0) > 0 then coalesce(dj.bs_reel_jour,0)::float / j.heures_rue_jour else null end as taux_reel_jour,
    extract(isodow from j.date)::int as jour_semaine,
    extract(month from j.date)::int as mois
  from jours j
  left join dons_jour dj on dj.date = j.date
)`;
}

// Indicateurs globaux de la fiche : nb de jours distincts (tous jours
// confondus), nombre moyen de recruteurs par jour (remplace l'ancien
// total de recruteurs distincts, moins parlant), taux réel global et don
// moyen global (tous dons valides confondus, pas la moyenne des dons
// moyens par mission).
function buildGlobalStatsQuery(id_emplacement) {
  const cte = globalDaysCtePrefix(id_emplacement);
  return `${cte}
select
  count(*) as nb_jours_total,
  avg(nb_recruteurs_jour) as recruteurs_moyen_jour,
  case when coalesce(sum(heures_rue_jour),0) > 0 then sum(bs_reel_jour)::float / sum(heures_rue_jour) else null end as taux_reel_global,
  (select avg(montant) from dons_e) as don_moyen_global
from jours_full;`;
}

// Évolution du taux réel par jour de semaine (1=lundi..7=dimanche), tous
// jours et missions confondus à cet emplacement — moyenne pondérée
// (somme BS réel / somme heures rue par jour de semaine), pas une moyenne
// de taux journaliers, pour rester cohérent avec le calcul du taux réel
// utilisé partout ailleurs dans ce projet.
function buildTauxParJourSemaineQuery(id_emplacement) {
  const cte = globalDaysCtePrefix(id_emplacement);
  return `${cte}
select jour_semaine,
  sum(bs_reel_jour) as bs_reel, sum(heures_rue_jour) as heures_rue,
  case when coalesce(sum(heures_rue_jour),0) > 0 then sum(bs_reel_jour)::float / sum(heures_rue_jour) else null end as taux_reel
from jours_full
group by 1
order by 1;`;
}

// Évolution du taux réel par mois de l'année (1=janvier..12=décembre),
// toutes années confondues (saisonnalité), même logique de moyenne
// pondérée que ci-dessus.
function buildTauxParMoisQuery(id_emplacement) {
  const cte = globalDaysCtePrefix(id_emplacement);
  return `${cte}
select mois,
  sum(bs_reel_jour) as bs_reel, sum(heures_rue_jour) as heures_rue,
  case when coalesce(sum(heures_rue_jour),0) > 0 then sum(bs_reel_jour)::float / sum(heures_rue_jour) else null end as taux_reel
from jours_full
group by 1
order by 1;`;
}

function buildEmplacementQueries(id_emplacement) {
  return {
    info: buildInfoQuery(id_emplacement),
    missions: buildMissionsQuery(id_emplacement),
    globalStats: buildGlobalStatsQuery(id_emplacement),
    tauxParJourSemaine: buildTauxParJourSemaineQuery(id_emplacement),
    tauxParMois: buildTauxParMoisQuery(id_emplacement),
  };
}

export { buildEmplacementQueries };
