// Requêtes SQL pour les pages "mobilisation" (porte-à-porte) : /re-mobilisation
// et /rd-mobilisation, reproduisant les dashboards Metabase 17 ("Performance
// RE Mobilisation") et 18 ("Performance RD Mobilisation").
//
// Domaine différent du reste de l'app (recrutement de rue / dons) : ici on
// suit des "passages" (visites) sur des "logements" (rattachés à des
// "habitations" = immeubles), avec un statut par passage (porte_ouverte,
// non_conforme, repasse, absent). Le statut "courant" d'un logement est
// celui de son passage le plus récent — vérifié empiriquement (dédupliquer
// par logement_id sur le dernier passage donne exactement le nombre total
// de logements visités de la mission, cf. exploration Metabase question 300).
//
// mission_id et utilisateur_id sont des UUID déjà validés par metabase.js
// (RE_UUID) avant d'arriver ici — donc sûrs à interpoler.

function missionInfoQuery(mission_id) {
  return `select m.id as mission_id, m.code_mission, m.code_mission_client, m.statut_mission,
  m.date_debut, m.date_fin, c.nom as client_nom, c.couleur
from missions m
left join clients c on c.id = m.client_id
where m.id = '${mission_id}'
limit 1;`;
}

function rdInfoQuery(utilisateur_id) {
  return `select uip.prenom, uip.nom
from utilisateur_informations_personnelles uip
where uip.utilisateur_id = '${utilisateur_id}'
limit 1;`;
}

// CTE partagée : dernier passage par logement, filtrée sur la mission et,
// optionnellement, sur un seul RD (via lots.utilisateur_id).
function latestPassageCte(mission_id, utilisateur_id) {
  const userFilter = utilisateur_id ? ` and lo.utilisateur_id = '${utilisateur_id}'` : '';
  return `latest as (
  select distinct on (p.logement_id) p.logement_id, p.statut, p.lot_id
  from passages p
  join lots lo on lo.id = p.lot_id
  where p.mission_id = '${mission_id}'${userFilter}
  order by p.logement_id, p.created_at desc
)`;
}

// Nb de logements théorique (habitations.nombre_logements) et trouvés
// (habitations.logements_count), au niveau de la mission entière — ne
// dépend pas d'un RD en particulier (ce sont des totaux d'immeubles
// assignés à la mission, pas des passages).
function buildLogementsGlobalQuery(mission_id) {
  return `select
  coalesce(sum(h.nombre_logements),0) as nb_logements_theorique,
  coalesce(sum(h.logements_count),0) as nb_logements_trouves
from habitations_missions hm
join habitations h on h.id = hm.habitation_id
where hm.mission_id = '${mission_id}';`;
}

function buildStatutQuery(mission_id, utilisateur_id) {
  return `with ${latestPassageCte(mission_id, utilisateur_id)}
select statut, count(*) as nb
from latest
group by statut
order by nb desc;`;
}

// Répartition par RD × statut — vue globale mission uniquement (question
// Metabase "Logements par RD et statut", absente du dashboard RD puisque
// déjà scopé à un seul RD).
function buildParRdQuery(mission_id) {
  return `with ${latestPassageCte(mission_id, null)}
select coalesce(uip.prenom,'—') as prenom, l.statut, count(*) as nb
from latest l
left join lots lo on lo.id = l.lot_id
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = lo.utilisateur_id
group by 1,2
order by prenom, nb desc;`;
}

// Taux de rencontre = portes ouvertes / (logements visités - non conformes),
// + nombre moyen de passages par logement (logements.passages_count).
function buildTauxRencontreQuery(mission_id, utilisateur_id) {
  return `with ${latestPassageCte(mission_id, utilisateur_id)}
select
  count(*) as nb_logements_visites,
  count(*) filter (where statut = 'porte_ouverte') as porte_ouverte,
  count(*) filter (where statut = 'non_conforme') as non_conforme,
  count(*) filter (where statut = 'repasse') as repasse,
  count(*) filter (where statut = 'absent') as absent,
  (select avg(lg.passages_count) from logements lg where lg.id in (select logement_id from latest)) as avg_passages
from latest;`;
}

// Suivi des habitations : une ligne par immeuble touché, triée par taux de
// traitement croissant (les moins avancées en premier — liste de priorité).
function buildHabitationsQuery(mission_id, utilisateur_id) {
  return `with ${latestPassageCte(mission_id, utilisateur_id)},
par_habitation as (
  select h.id, h.adresse, h.ville, h.nombre_logements, h.logements_count,
    count(*) as nb_visites,
    count(*) filter (where l.statut='porte_ouverte') as porte_ouverte,
    count(*) filter (where l.statut='non_conforme') as non_conforme
  from latest l
  join logements lg on lg.id = l.logement_id
  join habitations h on h.id = lg.habitation_id
  group by h.id, h.adresse, h.ville, h.nombre_logements, h.logements_count
)
select adresse, ville, nombre_logements, logements_count, nb_visites, porte_ouverte, non_conforme,
  case when (nb_visites - non_conforme) > 0 then porte_ouverte::float / (nb_visites - non_conforme) else null end as taux_rencontre,
  case when logements_count > 0 then nb_visites::float / logements_count else null end as taux_traitement
from par_habitation
order by taux_traitement asc nulls last, adresse
limit 100;`;
}

// utilisateur_id absent -> vue RE (globale mission, avec répartition par RD).
// utilisateur_id présent -> vue RD (tout scopé à ce seul RD).
function buildMobilisationQueries(mission_id, utilisateur_id) {
  const queries = {
    info: missionInfoQuery(mission_id),
    logementsGlobal: buildLogementsGlobalQuery(mission_id),
    statut: buildStatutQuery(mission_id, utilisateur_id),
    tauxRencontre: buildTauxRencontreQuery(mission_id, utilisateur_id),
    habitations: buildHabitationsQuery(mission_id, utilisateur_id),
  };
  if (!utilisateur_id) {
    queries.parRd = buildParRdQuery(mission_id);
  }
  return queries;
}

export { buildMobilisationQueries, rdInfoQuery };
