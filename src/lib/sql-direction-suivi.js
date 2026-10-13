// Requêtes SQL du dashboard "Suivi Direction" (/direction-suivi), construit
// à partir du dashboard Metabase « Direction » (id 41) : mêmes indicateurs
// (suivi global, par client, par mission, par recruteur, statut des dons,
// transmissions, dépôts, facturation CozApp), avec un filtre de période
// unique (type : total / année / mois / semaine / jour) appliqué à toutes
// les sections.
//
// Performance : une requête PAR SECTION (le front les charge en parallèle
// et en différé), chacune ne fait qu'UN passage sur les lots de la période
// puis agrège les dons par lot (CTE `ls`) avant tout GROUP BY — jamais de
// jointure dons × lots répétée par indicateur.
//
// Dates : les indicateurs de performance (global, clients, missions,
// recruteurs) filtrent sur lots.date (jusqu'à aujourd'hui : les lots futurs
// pré-créés sont ignorés, comme sur /direction). Les sections « dons »
// filtrent sur dons.created_at (statuts, transmissions) ou
// dons.date_transmission (dépôts, facturation), en heure de Paris.
import { excludeClientsClause } from './excluded-clients.js';

const VALID = "('nouveau','en_attente','transmis')";
const ALL_STATUTS = "('annule','en_attente','incomplet','nouveau','transmis')";
export const GRAINS = ['year', 'month', 'week', 'day'];

// p = { date_from, date_to, grain, id_client } — déjà validés par le handler
// (dates AAAA-MM-JJ, grain dans GRAINS, id_client UUID) : seules des valeurs
// validées sont injectées dans le SQL.
function lotsWhere(p) {
  const c = ['l.date <= CURRENT_DATE'];
  if (p.date_from) c.push(`l.date >= '${p.date_from}'::date`);
  if (p.date_to) c.push(`l.date <= '${p.date_to}'::date`);
  return c.join(' AND ');
}

// Plage sur une colonne timestamptz, bornes interprétées en heure de Paris
// (index-friendly : pas de cast sur la colonne).
function parisRange(col, p) {
  const c = [];
  if (p.date_from) c.push(`${col} >= ('${p.date_from}'::timestamp AT TIME ZONE 'Europe/Paris')`);
  if (p.date_to) c.push(`${col} < (('${p.date_to}'::date + 1)::timestamp AT TIME ZONE 'Europe/Paris')`);
  return c.length ? c.join(' AND ') : 'true';
}

function parisTrunc(col, grain) {
  return `date_trunc('${grain}', (${col} AT TIME ZONE 'Europe/Paris'))::date`;
}

// Base commune : lots de la période + BS (dons valides) et montant par lot.
// Heures de rue / rémunérées : uniquement sur les lots PRÉSENTS (heures
// rémunérées ≠ 0), règle commune du projet (cf. NOTE-INDICATEURS.md).
function lotStatsCte(p, withAges = false) {
  return `with lf as (
  select l.id, l.date, l.mission_id, l.utilisateur_id, m.client_id,
    case when coalesce(l.nombre_horaires_remuneration, 0) <> 0 then l.nombre_horaires_rue end as hr,
    case when coalesce(l.nombre_horaires_remuneration, 0) <> 0 then l.nombre_horaires_remuneration end as hrem,
    (coalesce(l.nombre_horaires_remuneration, 0) = 0) as absent
  from lots l
  join missions m on m.id = l.mission_id
  where ${lotsWhere(p)}
    ${excludeClientsClause('m')}
),
dl as (
  select d.lot_id, count(*) as bs, sum(d.montant) as mt
  from dons d
  join lf on lf.id = d.lot_id
  where d.statut in ${VALID}
  group by d.lot_id
),
ls as (
  select lf.*, coalesce(dl.bs, 0) as bs, coalesce(dl.mt, 0) as mt
  from lf
  left join dl on dl.lot_id = lf.id
)${withAges ? `,
ages as (
  select lf.utilisateur_id,
    percentile_cont(0.5) within group (order by (d.created_at::date - dn.date_de_naissance)::float / 365.25) as age_median
  from dons d
  join lf on lf.id = d.lot_id
  join donateurs dn on dn.id = d.donateur_id
  where d.statut in ${VALID} and dn.date_de_naissance is not null and lf.utilisateur_id is not null
  group by lf.utilisateur_id
)` : ''}`;
}

// Indicateurs communs (carte « Suivi par Total / client / mission /
// recruteur » du dashboard 41) :
// nb_jours = nb de lots (jour-recruteur), taux_reel = BS réel / heures de rue,
// ratio_h = heures de rue / heures rémunérées, don_moyen = montant moyen,
// pct_absence = lots sans heures rémunérées / lots.
const METRICS = `count(*) as nb_jours,
  count(distinct ls.mission_id) as nb_missions,
  count(distinct ls.utilisateur_id) as nb_rd,
  coalesce(sum(ls.hr), 0) as heures_rue,
  coalesce(sum(ls.hrem), 0) as heures_rem,
  sum(ls.bs) as bs_reel,
  case when sum(ls.hr) > 0 then sum(ls.bs)::float / sum(ls.hr) end as taux_reel,
  case when sum(ls.hrem) > 0 then sum(ls.hr)::float / sum(ls.hrem) end as ratio_h,
  case when sum(ls.bs) > 0 then sum(ls.mt)::float / sum(ls.bs) end as don_moyen,
  case when count(*) > 0 then sum(ls.absent::int)::float / count(*) end as pct_absence`;

export function buildKpisQuery(p) {
  return `${lotStatsCte(p)}
select ${METRICS}
from ls;`;
}

// Évolution : sous-périodes de la période choisie (grain = year/month/week/day).
export function buildPeriodeQuery(p) {
  return `${lotStatsCte(p)}
select date_trunc('${p.grain}', ls.date::timestamp)::date as periode, ${METRICS}
from ls
group by 1
order by 1;`;
}

export function buildClientsQuery(p) {
  return `${lotStatsCte(p)}
select c.id as client_id, c.nom as client, ${METRICS}
from ls
join clients c on c.id = ls.client_id
group by c.id, c.nom
order by sum(ls.bs) desc, c.nom;`;
}

export function buildMissionsQuery(p) {
  return `${lotStatsCte(p)}
select m.id as mission_id, m.code_mission, c.nom as client, m.date_debut, m.date_fin, m.statut_mission, ${METRICS}
from ls
join missions m on m.id = ls.mission_id
join clients c on c.id = m.client_id
group by m.id, m.code_mission, c.nom, m.date_debut, m.date_fin, m.statut_mission
order by m.date_debut desc nulls last, m.code_mission
limit 500;`;
}

export function buildRecruteursQuery(p) {
  return `${lotStatsCte(p, true)}
select ls.utilisateur_id,
  trim(coalesce(uip.prenom, '') || ' ' || upper(coalesce(uip.nom, ''))) as recruteur,
  a.age_median,
  ${METRICS}
from ls
left join utilisateur_informations_personnelles uip on uip.utilisateur_id = ls.utilisateur_id
left join ages a on a.utilisateur_id = ls.utilisateur_id
where ls.utilisateur_id is not null
group by ls.utilisateur_id, uip.prenom, uip.nom, a.age_median
order by sum(ls.bs) desc, sum(ls.hr) desc nulls last
limit 500;`;
}

// Volume de dons par statut (carte « Suivi du statut des dons ») : dons
// créés dans la période, par sous-période, statut et plateforme
// (CozApp = pas d'ancien id CAE, sinon BO).
export function buildStatutsQuery(p) {
  return `select ${parisTrunc('d.created_at', p.grain)} as periode,
  d.statut,
  case when d.old_cae_id is null then 'CozApp' else 'BO' end as plateforme,
  count(*) as nb,
  coalesce(sum(d.montant), 0) as montant
from dons d
join lots l on l.id = d.lot_id
join missions m on m.id = l.mission_id
where d.statut in ${ALL_STATUTS}
  and ${parisRange('d.created_at', p)}
  ${excludeClientsClause('m')}
group by 1, 2, 3
order by 1;`;
}

// Suivi des transmissions (carte 386) : dons nouveaux / en attente /
// transmis par client + paramètres de transmission du client.
export function buildTransmissionsQuery(p) {
  return `select c.id as client_id, c.nom as client,
  c.jours_transmission::text as jours_transmission,
  c.heure_transmission,
  c.delai_avant_transmission_automatique as delai,
  count(*) filter (where d.statut = 'nouveau') as nouveau,
  count(*) filter (where d.statut = 'en_attente') as en_attente,
  count(*) filter (where d.statut = 'transmis') as transmis,
  min(d.created_at) filter (where d.statut in ('nouveau', 'en_attente')) as plus_ancien
from dons d
join lots l on l.id = d.lot_id
join missions m on m.id = l.mission_id
join clients c on c.id = m.client_id
where d.statut in ${VALID}
  and ${parisRange('d.created_at', p)}
  ${excludeClientsClause('m')}
group by c.id, c.nom, c.jours_transmission::text, c.heure_transmission, c.delai_avant_transmission_automatique
order by count(*) filter (where d.statut in ('nouveau', 'en_attente')) desc, c.nom;`;
}

// Suivi des dépôts (carte 391) : dons transmis dans la période, par client,
// sous-période et plateforme.
export function buildDepotsQuery(p) {
  return `select c.id as client_id, c.nom as client,
  ${parisTrunc('d.date_transmission', p.grain)} as periode,
  case when d.old_cae_id is null then 'CozApp' else 'BO' end as plateforme,
  count(*) as nb,
  coalesce(sum(d.montant), 0) as montant,
  max(d.date_transmission) as derniere
from dons d
join lots l on l.id = d.lot_id
join missions m on m.id = l.mission_id
join clients c on c.id = m.client_id
where d.date_transmission is not null
  and ${parisRange('d.date_transmission', p)}
  ${excludeClientsClause('m')}
group by 1, 2, 3, 4
order by 3 desc, 2;`;
}

// Facturation CozApp (carte 390) : dons transmis (hors ancien système) dans
// la période de transmission. Résumé par client / mois de transmission /
// type de don ; le détail par mission est chargé à la demande.
export function buildFacturationQuery(p) {
  return `select c.id as client_id, c.nom as client,
  to_char(date_trunc('month', (d.date_transmission AT TIME ZONE 'Europe/Paris')), 'YYYY-MM') as mois_transmission,
  coalesce(d.type_de_don, '—') as type_de_don,
  count(*) as nb
from dons d
join lots l on l.id = d.lot_id
join missions m on m.id = l.mission_id
join clients c on c.id = m.client_id
where d.statut = 'transmis'
  and d.old_cae_id is null
  and d.date_transmission is not null
  and ${parisRange('d.date_transmission', p)}
  ${excludeClientsClause('m')}
group by 1, 2, 3, 4
order by 3 desc, 2, 4;`;
}

export function buildFacturationDetailQuery(p) {
  return `select m.code_mission,
  coalesce(d.type_de_don, '—') as type_de_don,
  to_char(date_trunc('month', (d.created_at AT TIME ZONE 'Europe/Paris')), 'YYYY-MM') as mois_creation,
  to_char(date_trunc('month', (d.date_transmission AT TIME ZONE 'Europe/Paris')), 'YYYY-MM') as mois_transmission,
  count(*) as nb
from dons d
join lots l on l.id = d.lot_id
join missions m on m.id = l.mission_id
where m.client_id = '${p.id_client}'
  and d.statut = 'transmis'
  and d.old_cae_id is null
  and d.date_transmission is not null
  and ${parisRange('d.date_transmission', p)}
group by 1, 2, 3, 4
order by 4 desc, 1, 2
limit 1000;`;
}

export const DIRECTION_SUIVI_SECTIONS = {
  kpis: buildKpisQuery,
  periode: buildPeriodeQuery,
  clients: buildClientsQuery,
  missions: buildMissionsQuery,
  recruteurs: buildRecruteursQuery,
  statuts: buildStatutsQuery,
  transmissions: buildTransmissionsQuery,
  depots: buildDepotsQuery,
  facturation: buildFacturationQuery,
  facturation_detail: buildFacturationDetailQuery,
};
