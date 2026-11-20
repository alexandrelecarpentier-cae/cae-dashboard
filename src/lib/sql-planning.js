// Dashboard /planning : liste des missions d'une année + Gantt (onglet 2).
// Une seule requête "missions" (une ligne par mission) ; le regroupement du
// Gantt (client, format, type, ville, RE, RM) est fait côté navigateur.
//
// Périmètre : missions non annulées (en attente, en cours, terminées) qui
// CHEVAUCHENT l'année demandée (début <= 31/12 et fin >= 01/01), hors
// clients de test / missions de mobilisation (excludeClientsClause).

import { excludeClientsClause } from './excluded-clients.js';
import { VILLES } from './sql-anne.js';

const NOM_UTILISATEUR = (uip, u) => `coalesce(${uip}.prenom || ' ' || upper(${uip}.nom), ${u}.email)`;

export function buildPlanningMissionsQuery(annee) {
  const y = Number(annee);
  return `with vm(code, nom) as (values ${VILLES.map(([c, n]) => `('${c}','${n}')`).join(', ')}),
sm as (
  select m.* from missions m
  where m.statut_mission <> 'annulee'
    and m.date_debut is not null
    and m.date_debut <= date '${y}-12-31'
    and coalesce(m.date_fin, m.date_debut) >= date '${y}-01-01'
    ${excludeClientsClause('m')}
),
lt as (
  select l.mission_id, count(distinct l.utilisateur_id) as nb_recruteurs,
    string_agg(distinct ${NOM_UTILISATEUR('uip', 'u')}, '|' order by ${NOM_UTILISATEUR('uip', 'u')}) as recruteurs
  from lots l
  join sm on sm.id = l.mission_id
  left join utilisateurs u on u.id = l.utilisateur_id
  left join utilisateur_informations_personnelles uip on uip.utilisateur_id = l.utilisateur_id
  where l.utilisateur_id is not null
  group by 1
),
lc as (select l.mission_id, count(*) as nb_lots from lots l join sm on sm.id = l.mission_id group by 1),
em as (
  select x.mission_id, count(distinct x.emplacement_id) as nb_emplacements from (
    select e.mission_id, e.emplacement_id from emplacements_missions e join sm on sm.id = e.mission_id
    union
    select l.mission_id, l.emplacement_id from lots l join sm on sm.id = l.mission_id where l.emplacement_id is not null
  ) x group by 1
)
select m.id as mission_id, m.code_mission, c.nom as client, m.statut_mission as statut,
  case when m.format in ('sitesprives','site_prive','sites_privees') then 'site_prive'
       when m.format is null then 'non_renseigne' else m.format end as format_mission,
  case when lower(m.type_mission) in ('itinérante','itinerante') then 'itinerante'
       when lower(m.type_mission) in ('spéciale','speciale') then 'speciale'
       when m.type_mission is null then 'non_renseigne' else lower(m.type_mission) end as type_mission,
  to_char(m.date_debut, 'YYYY-MM-DD') as date_debut,
  to_char(coalesce(m.date_fin, m.date_debut), 'YYYY-MM-DD') as date_fin,
  greatest(1, ceil((coalesce(m.date_fin, m.date_debut) - m.date_debut + 1) / 7.0))::int as nb_semaines,
  case when array_to_string(m.jours, ',') ilike '%lundi%' and array_to_string(m.jours, ',') not ilike '%samedi%' then 'LV'
       when array_to_string(m.jours, ',') ilike '%samedi%' and array_to_string(m.jours, ',') not ilike '%lundi%' then 'MS'
       else null end as rythme,
  coalesce(nullif(trim(m.ville_principale), ''), vm.nom) as ville_principale,
  ${NOM_UTILISATEUR('uip_re', 'u_re')} as responsable_equipe,
  ${NOM_UTILISATEUR('uip_rm', 'u_rm')} as responsable_mission,
  m.objectif_bulletin_theorique as objectif,
  coalesce(lt.nb_recruteurs, 0) as nb_recruteurs, coalesce(lt.recruteurs, '') as recruteurs,
  coalesce(lc.nb_lots, 0) as nb_lots, coalesce(em.nb_emplacements, 0) as nb_emplacements
from sm m
join clients c on c.id = m.client_id
left join vm on vm.code = upper(right(regexp_replace(m.code_mission, '(SP|HYB)$', ''), 3))
left join utilisateurs u_rm on u_rm.id = m.responsable_mission_id
left join utilisateur_informations_personnelles uip_rm on uip_rm.utilisateur_id = m.responsable_mission_id
left join utilisateurs u_re on u_re.id = m.responsable_equipe_id
left join utilisateur_informations_personnelles uip_re on uip_re.utilisateur_id = m.responsable_equipe_id
left join lt on lt.mission_id = m.id
left join lc on lc.mission_id = m.id
left join em on em.mission_id = m.id
order by m.date_debut, m.code_mission
limit 1500;`;
}

// Années proposées en tags : de la première année de début de mission à la
// dernière année de fin (missions non annulées, mêmes exclusions).
export function buildPlanningYearsQuery() {
  return `select y::int as annee from generate_series(
  (select min(extract(year from m.date_debut))::int from missions m where m.statut_mission <> 'annulee' and m.date_debut is not null ${excludeClientsClause('m')}),
  (select max(extract(year from coalesce(m.date_fin, m.date_debut)))::int from missions m where m.statut_mission <> 'annulee' and m.date_debut is not null ${excludeClientsClause('m')})
) as y order by 1 desc;`;
}
