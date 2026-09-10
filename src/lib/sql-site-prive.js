// Requêtes SQL pour le dashboard "Site privé" (/site-prive) : pilotage
// agrégé de TOUS les emplacements de type "prive" (grandes surfaces,
// magasins spécialisés, centres commerciaux, pharmacies...), par
// opposition aux emplacements "public" (rue, gare...) qui ne sont pas
// couverts par cette page. Filtres optionnels par mission, par
// client/association et par emplacement (site privé) précis — tous
// combinables, aucun n'est requis (vue globale par défaut).
//
// "Enseigne" n'existe pas comme colonne dédiée en base : elle est déduite
// du premier mot du nom de l'emplacement (ex. "CARREFOUR CITY" ->
// "CARREFOUR", "INTERMARCHÉ EXPRESS GARIBALDI" -> "INTERMARCHÉ"). C'est une
// heuristique simple, pas toujours exacte (ex. enseignes en deux mots,
// noms de centres commerciaux génériques) mais qui reflète correctement la
// grande majorité des cas observés en base.
import { excludeClientsClause } from './excluded-clients.js';

const STATUTS_VALIDES = "('nouveau','en_attente','transmis')";

function filtersClause(p) {
  const clauses = [`e.type_emplacement = 'prive'`];
  if (p.id_mission) clauses.push(`m.id = '${p.id_mission}'`);
  if (p.id_client) clauses.push(`m.client_id = '${p.id_client}'`);
  if (p.id_emplacement) clauses.push(`e.id = '${p.id_emplacement}'`);
  return clauses.join(' AND ');
}

// CTE de base partagée par toutes les requêtes agrégées ci-dessous : les
// lots (+ dons valides associés) sur des emplacements privés, filtrés par
// mission/client/emplacement si demandé, hors clients exclus.
function baseCte(p) {
  return `with lots_f as (
  select l.id, l.mission_id, l.emplacement_id, l.nombre_horaires_rue, l.presence_recruteur,
    e.categorie, e.nom as emplacement_nom
  from lots l
  join emplacements e on e.id = l.emplacement_id
  join missions m on m.id = l.mission_id
  where ${filtersClause(p)}
    ${excludeClientsClause('m')}
),
dons_f as (
  select d.id, d.montant, d.lot_id
  from dons d
  join lots_f l on l.id = d.lot_id
  where d.statut in ${STATUTS_VALIDES}
)`;
}

// Indicateurs globaux : nb d'emplacements et de missions couverts par le
// périmètre filtré, BS réel cumulé, taux réel global (pondéré, pas moyenne
// de taux), don moyen global.
function buildGlobalStatsQuery(p) {
  return `${baseCte(p)},
heures as (
  select sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue
  from lots_f
),
dons_agg as (
  select count(distinct id) as bs_reel, avg(montant) as don_moyen from dons_f
)
select
  (select count(distinct emplacement_id) from lots_f) as nb_emplacements,
  (select count(distinct mission_id) from lots_f) as nb_missions,
  h.heures_rue,
  coalesce(da.bs_reel, 0) as bs_reel,
  case when coalesce(h.heures_rue,0) > 0 then coalesce(da.bs_reel,0)::float / h.heures_rue else null end as taux_reel,
  da.don_moyen
from heures h, dons_agg da;`;
}

// Taux réel + don moyen par typologie d'emplacement (categorie : sup, hyp,
// cco, prox, spec, bio, phar, aut...).
function buildParTypologieQuery(p) {
  return `${baseCte(p)},
par_cat as (
  select coalesce(categorie, '—') as categorie,
    count(distinct emplacement_id) as nb_emplacements,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue
  from lots_f
  group by 1
),
dons_cat as (
  select coalesce(l.categorie, '—') as categorie,
    count(distinct d.id) as bs_reel, avg(d.montant) as don_moyen
  from dons_f d
  join lots_f l on l.id = d.lot_id
  group by 1
)
select pc.categorie, pc.nb_emplacements, pc.heures_rue,
  coalesce(dc.bs_reel, 0) as bs_reel, dc.don_moyen,
  case when coalesce(pc.heures_rue,0) > 0 then coalesce(dc.bs_reel,0)::float / pc.heures_rue else null end as taux_reel
from par_cat pc
left join dons_cat dc on dc.categorie = pc.categorie
order by bs_reel desc nulls last;`;
}

// Taux réel + don moyen par enseigne (déduite du nom, cf. commentaire en
// tête de fichier). Limité aux 40 enseignes avec le plus de BS réel, pour
// rester lisible (il peut y avoir plusieurs centaines d'enseignes
// distinctes déduites sur l'ensemble des emplacements privés).
function buildParEnseigneQuery(p) {
  return `${baseCte(p)},
lots_ens as (
  select id, emplacement_id, nombre_horaires_rue, presence_recruteur,
    -- translate() replie les accents les plus courants (ex. "INTERMARCHÉ"
    -- et "INTERMARCHE" tombent dans le même seau) : sans ça, les variantes
    -- accentuées/non accentuées d'un même nom en base auraient éclaté la
    -- même enseigne en plusieurs lignes.
    nullif(translate(upper(split_part(trim(emplacement_nom), ' ', 1)), 'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'AAAEEEEIIOOUUUC'), '') as enseigne
  from lots_f
),
par_ens as (
  select coalesce(enseigne, '—') as enseigne,
    count(distinct emplacement_id) as nb_emplacements,
    sum(nombre_horaires_rue) filter (where coalesce(presence_recruteur,true)) as heures_rue
  from lots_ens
  group by 1
),
dons_ens as (
  select coalesce(le.enseigne, '—') as enseigne,
    count(distinct d.id) as bs_reel, avg(d.montant) as don_moyen
  from dons_f d
  join lots_ens le on le.id = d.lot_id
  group by 1
)
select pe.enseigne, pe.nb_emplacements, pe.heures_rue,
  coalesce(de.bs_reel, 0) as bs_reel, de.don_moyen,
  case when coalesce(pe.heures_rue,0) > 0 then coalesce(de.bs_reel,0)::float / pe.heures_rue else null end as taux_reel
from par_ens pe
left join dons_ens de on de.enseigne = pe.enseigne
order by bs_reel desc nulls last
limit 40;`;
}

// Listes de référence pour les filtres (missions / associations / sites
// privés ayant une activité enregistrée) — construites une seule fois côté
// front (comme rmList/clientList sur /rm-collecte), indépendamment des
// filtres actuellement sélectionnés.
function buildMissionListQuery() {
  return `select distinct m.id, m.code_mission, c.nom as client_nom
from lots l
join emplacements e on e.id = l.emplacement_id and e.type_emplacement = 'prive'
join missions m on m.id = l.mission_id
left join clients c on c.id = m.client_id
where 1=1 ${excludeClientsClause('m')}
order by m.code_mission;`;
}

function buildClientListQuery() {
  return `select distinct c.id, c.nom
from lots l
join emplacements e on e.id = l.emplacement_id and e.type_emplacement = 'prive'
join missions m on m.id = l.mission_id
join clients c on c.id = m.client_id
where c.nom is not null
  ${excludeClientsClause('m')}
order by c.nom;`;
}

function buildEmplacementListQuery() {
  return `select distinct e.id, e.nom, e.ville, e.categorie
from lots l
join emplacements e on e.id = l.emplacement_id and e.type_emplacement = 'prive'
join missions m on m.id = l.mission_id
where 1=1 ${excludeClientsClause('m')}
order by e.nom;`;
}

function buildSitePriveQueries(p) {
  return {
    globalStats: buildGlobalStatsQuery(p),
    parTypologie: buildParTypologieQuery(p),
    parEnseigne: buildParEnseigneQuery(p),
  };
}

export {
  buildSitePriveQueries,
  buildMissionListQuery,
  buildClientListQuery,
  buildEmplacementListQuery,
};
