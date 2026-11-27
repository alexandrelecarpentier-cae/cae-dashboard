// Requêtes SQL du dashboard /rrh (contrôle de conformité RH).
// Chaque section renvoie un objet { nomDuJeuDeDonnées: "SQL" } ; l'API les exécute à la suite (jamais en parallèle).
// Les agrégations fines (effectif max, taux, regroupements) sont faites côté page pour que les filtres restent instantanés.

import { excludeClientsClause } from './excluded-clients.js';

const STATUTS = ['RD', 'RDC', 'RDE', 'RDE+', 'RE', 'RER', 'RERF', 'REF', 'RM'];
const VILLE = "upper(right(regexp_replace(m.code_mission, '(SP|HYB)$', ''), 3))"; // 3 dernières lettres du code mission, suffixes SP / HYB ignorés
const FIN = "'9999-12-31'";

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const dateOr = (s, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : fallback);

// Nom complet d'un salarié à partir d'un alias de table utilisateur_informations_personnelles
const nom = (ip) => `trim(coalesce(${ip}.prenom,'') || ' ' || coalesce(${ip}.nom,''))`;

function ctx(p = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const du = dateOr(p.du, today.slice(0, 8) + '01');
  const au = dateOr(p.au, today);
  // m = filtres sur la mission (alias m), c = filtres sur le contrat (alias c).
  // Exclusions du projet : clients de test / démo et missions de mobilisation (cf. excluded-clients.js).
  const f = { m: ` ${excludeClientsClause('m')}`, c: '' };
  if (p.mission) f.m += ` and m.code_mission = ${lit(p.mission)}`;
  if (p.ville && /^[A-Za-z]{3}$/.test(p.ville)) f.m += ` and ${VILLE} = ${lit(p.ville.toUpperCase())}`;
  // f.mo : comme f.m, mais garde les contrats sans mission (CDI terrain) tant qu'on ne filtre pas sur une mission ou une ville
  f.mo = (p.mission || (p.ville && /^[A-Za-z]{3}$/.test(p.ville))) ? f.m : ` and (m.id is null or (true ${f.m}))`;
  const st = String(p.statut || '').split(',').filter((s) => STATUTS.includes(s));
  if (st.length) f.c += ` and c.statut in (${st.map(lit).join(',')})`;
  if (p.nature === 'cdi' || p.nature === 'cdd') f.c += ` and c.nature_contrat = ${lit(p.nature)}`;
  return { du, au, f };
}

const JOIN_NOM = (alias, col) => `left join utilisateur_informations_personnelles ${alias} on ${alias}.utilisateur_id = ${col}`;

// ---------- 1.1 Effectifs ----------
function effectifs(p) {
  const { du, au, f } = ctx(p);
  return {
    // une ligne par contrat qui chevauche la période (hors FRGEN) ; premiere_entree = 1er contrat du salarié, toutes périodes
    contrats: `
with c0 as (
  select c.*, min(c.date_debut) over (partition by c.utilisateur_id) as premiere_entree
  from contrats c where c.statut <> 'FRGEN')
select c.id, c.utilisateur_id, c.statut, c.nature_contrat as nature, coalesce(m.code_mission, '(sans mission)') as mission,
       ${VILLE} as ville, c.date_debut, c.date_fin, c.premiere_entree
from c0 c left join missions m on m.id = c.mission_id
where c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${du}' ${f.mo} ${f.c}
order by c.date_debut`,
  };
}

// ---------- 1.2 Contrats ----------
function contrats(p) {
  const { du, au, f } = ctx(p);
  return {
    liste: `
with lots_agg as (
  select utilisateur_id, mission_id, min(date) as premier_lot, count(*) as nb_lots
  from lots where date <= '${au}' and absence_id is null group by 1,2)
select c.id, c.utilisateur_id, ${nom('ip')} as salarie, c.statut, c.nature_contrat as nature,
       m.code_mission as mission, ${VILLE} as ville,
       c.date_debut, c.date_fin, c.oneflow_status as statut_signature,
       c.created_at::date as date_envoi,
       case when c.oneflow_status = 'signe' then c.updated_at::date end as date_signature,
       la.premier_lot, coalesce(la.nb_lots,0) as nb_lots
from contrats c
join missions m on m.id = c.mission_id
${JOIN_NOM('ip', 'c.utilisateur_id')}
left join lots_agg la on la.utilisateur_id = c.utilisateur_id and la.mission_id = c.mission_id
where c.statut <> 'FRGEN' and c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${du}' ${f.m} ${f.c}
order by c.date_debut desc limit 2000`,
    // salariés ayant travaillé (lot) sur une mission sans aucun contrat pour cette mission
    sans_contrat: `
select l.utilisateur_id, ${nom('ip')} as salarie, m.code_mission as mission, ${VILLE} as ville,
       min(l.date) as premier_lot, count(*) as nb_lots
from lots l
join missions m on m.id = l.mission_id
${JOIN_NOM('ip', 'l.utilisateur_id')}
where l.date between '${du}' and '${au}' and l.absence_id is null ${f.m}
  and not exists (select 1 from contrats c where c.utilisateur_id = l.utilisateur_id and c.mission_id = l.mission_id)
group by 1,2,3,4 order by 5 limit 1000`,
  };
}

// ---------- 1.3 Avenants ----------
function avenants(p) {
  const { du, au, f } = ctx(p);
  return {
    liste: `
select a.id, c.utilisateur_id, ${nom('ip')} as salarie, m.code_mission as mission, ${VILLE} as ville,
       c.statut, t.libelle as type_avenant, a.oneflow_status as statut_signature,
       a.created_at::date as date_envoi,
       case when a.oneflow_status = 'signe' then a.updated_at::date end as date_signature,
       a.date_debut, a.date_fin
from avenants a
join contrats c on c.id = a.contrat_id
join types_avenants t on t.id = a.type_avenant_id
join missions m on m.id = coalesce(a.mission_id, c.mission_id)
${JOIN_NOM('ip', 'c.utilisateur_id')}
where t.categorie = 'avenant' and a.created_at::date between '${du}' and '${au}' ${f.m} ${f.c}
order by a.created_at desc limit 2000`,
  };
}

// ---------- 1.4 CDI terrain ----------
function cdi(p) {
  const { au, f } = ctx(p);
  return {
    liste: `
select distinct on (c.utilisateur_id) c.utilisateur_id, ${nom('ip')} as salarie, c.statut,
       (select min(x.date_debut) from contrats x where x.utilisateur_id = c.utilisateur_id) as entree
from contrats c
left join missions m on m.id = c.mission_id
${JOIN_NOM('ip', 'c.utilisateur_id')}
where c.nature_contrat = 'cdi' and c.statut <> 'FRGEN'
  and c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${au}' ${f.mo} ${f.c}
order by c.utilisateur_id, c.date_debut desc`,
    // indicateurs par CDI et par mission, depuis l'entrée du salarié
    missions: `
with cdi as (
  select distinct on (c.utilisateur_id) c.utilisateur_id,
         (select min(x.date_debut) from contrats x where x.utilisateur_id = c.utilisateur_id) as entree
  from contrats c where c.nature_contrat = 'cdi' and c.statut <> 'FRGEN'
    and c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${au}'
  order by c.utilisateur_id, c.date_debut desc)
select cdi.utilisateur_id, m.code_mission as mission, min(l.date) as debut, max(l.date) as fin,
       count(*) as nb_lots, count(*) filter (where l.absence_id is not null) as nb_absences,
       round(sum(coalesce(l.nombre_horaires_rue,0))::numeric,1) as heures_rue
from cdi
join lots l on l.utilisateur_id = cdi.utilisateur_id and l.date >= cdi.entree and l.date <= '${au}'
join missions m on m.id = l.mission_id
where true ${f.m}
group by 1,2 order by 1, 3`,
  };
}

// ---------- 1.4 bis Dossiers salariés ----------
// Règles PROVISOIRES (à valider par le service RH) : n° sécu (13 ou 15 chiffres), RIB, date et ville de naissance, pièce d'identité.
function dossiers(p) {
  const { au, f } = ctx(p);
  return {
    liste: `
with actifs as (
  select distinct c.utilisateur_id from contrats c left join missions m on m.id = c.mission_id
  where c.statut <> 'FRGEN' and c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${au}' ${f.mo} ${f.c})
select a.utilisateur_id, ${nom('ip')} as salarie,
  array_remove(array[
    case when length(regexp_replace(coalesce(ip.numero_de_securite_sociale,''), '\\D', '', 'g')) not in (13,15) then 'N° de sécurité sociale' end,
    case when coalesce(ib.iban,'') = '' then 'RIB' end,
    case when ip.date_de_naissance is null then 'Date de naissance' end,
    case when coalesce(ip.ville_de_naissance,'') = '' then 'Lieu de naissance' end,
    case when not exists (select 1 from salarie_documents d where d.utilisateur_id = a.utilisateur_id
         and d.document_type in ('Carte d''identité','Passeport','Carte de séjour')) then 'Pièce d''identité' end
  ], null) as manquants
from actifs a
${JOIN_NOM('ip', 'a.utilisateur_id')}
left join utilisateur_informations_bancaires ib on ib.utilisateur_id = a.utilisateur_id
order by 2`,
  };
}

// ---------- 1.5 Absences ----------
// Absence = lot avec une absence saisie, ou lot dont les heures rémunérées sont < 7 h.
// "Qualifiée" = un code d'absence est renseigné sur le lot.
function absences(p) {
  const { du, au, f } = ctx(p);
  const base = `
from lots l
join missions m on m.id = l.mission_id
left join absences a on a.id = l.absence_id
left join types_absences t on t.id = a.type_absence_id
where l.date between '${du}' and '${au}'
  and l.date < current_date -- la journée en cours n'est pas encore saisie
  and (l.absence_id is not null or coalesce(l.nombre_horaires_remuneration,0) < 7) ${f.m}`;
  return {
    par_code: `
select m.code_mission as mission, to_char(l.date,'YYYY-MM') as mois, (l.absence_id is not null) as qualifiee,
       coalesce(t.code,'-') as code, coalesce(t.libelle,'Non qualifiée') as libelle,
       count(*) as nb, round(sum(coalesce(a.duree_en_minutes,0))/60.0,1) as heures
${base}
group by 1,2,3,4,5 order by 2 desc, 6 desc`,
    liste: `
select l.id as lot_id, l.date, l.utilisateur_id, ${nom('ip')} as salarie, m.code_mission as mission,
       t.code, t.libelle, (l.absence_id is not null) as qualifiee,
       round(coalesce(a.duree_en_minutes,0)/60.0,1) as heures_absence, l.nombre_horaires_remuneration as heures_remunerees
${base.replace('where l.date', JOIN_NOM('ip', 'l.utilisateur_id') + '\nwhere l.date')}
order by (l.absence_id is not null), l.date desc limit 1000`,
  };
}

// ---------- 1.6 / 1.7 FPE et ruptures anticipées ----------
function fpe(p) {
  const { du, au, f } = ctx(p);
  return {
    liste: `
select a.id, c.utilisateur_id, ${nom('ip')} as salarie, m.code_mission as mission, ${VILLE} as ville,
       c.statut, c.nature_contrat as nature, t.categorie,
       case when t.libelle ilike '%employeur%' then 'employeur' when t.libelle ilike '%salari%' then 'salarie' else 'autre' end as initiateur,
       t.libelle as type_avenant, a.oneflow_status as statut_signature,
       a.created_at::date as date_envoi, case when a.oneflow_status = 'signe' then a.updated_at::date end as date_signature,
       ${nom('re')} as re, ${nom('rm')} as rm
from avenants a
join contrats c on c.id = a.contrat_id
join types_avenants t on t.id = a.type_avenant_id
join missions m on m.id = coalesce(a.mission_id, c.mission_id)
${JOIN_NOM('ip', 'c.utilisateur_id')}
${JOIN_NOM('re', 'm.responsable_equipe_id')}
${JOIN_NOM('rm', 'm.responsable_mission_id')}
where t.categorie in ('fin_period_essai','rupture') and a.oneflow_status in ('signe','publie') and a.created_at::date between '${du}' and '${au}' ${f.m} ${f.c}
order by a.created_at desc limit 2000`,
    // dénominateur des taux : salariés ayant un contrat signé sur la mission (période)
    base: `
select m.code_mission as mission, count(distinct c.utilisateur_id) as salaries_signes
from contrats c join missions m on m.id = c.mission_id
where c.oneflow_status = 'signe' and c.statut <> 'FRGEN'
  and c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${du}' ${f.m} ${f.c}
group by 1`,
  };
}

// ---------- 1.8 Acomptes et saisies ----------
// Rattachés au contrat en cours à la date de CRÉATION de l'élément de paie (pas à sa date d'effet).
function acomptes(p) {
  const { du, au, f } = ctx(p);
  return {
    liste: `
select ep.id, ep.element_paie_type as type, ep.montant, ep.date_effective, ep.created_at::date as date_creation,
       ep.utilisateur_id, ${nom('ip')} as salarie, m.code_mission as mission, c.statut, c.id as contrat_id
from elements_paie ep
left join lateral (
  select c.* from contrats c
  where c.utilisateur_id = ep.utilisateur_id and c.date_debut <= ep.created_at::date
    and coalesce(c.date_fin, ${FIN}) >= ep.created_at::date
  order by c.date_debut desc limit 1) c on true
left join missions m on m.id = c.mission_id
${JOIN_NOM('ip', 'ep.utilisateur_id')}
where ep.element_paie_type in ('acompte','saisie_arret') and ep.created_at::date between '${du}' and '${au}' ${f.mo}
order by ep.created_at desc limit 2000`,
  };
}

// ---------- Titres-restaurant ----------
// Droit = journée complète (horaires rémunérés matin ET après-midi) sans absence. Règle à valider par RH.
function titres(p) {
  const { du, au, f } = ctx(p);
  const full = `
with elig as (
  select l.id as lot_id, l.date, l.utilisateur_id, l.mission_id, l.updated_at,
         l.horaires_remuneration_matin_debut as m1, l.horaires_remuneration_matin_fin as m2,
         l.horaires_remuneration_apres_midi_debut as a1, l.horaires_remuneration_apres_midi_fin as a2
  from lots l
  where l.date between '${du}' and '${au}' and l.absence_id is null
    and l.horaires_remuneration_matin_debut is not null and l.horaires_remuneration_apres_midi_debut is not null),
att as (
  select t.utilisateur_id, t.date_lot, t.created_at from attributions_ticket_restaurant t
  where t.date_lot between '${du}' and '${au}'),
j as (
  select coalesce(e.date, a.date_lot) as date, coalesce(e.utilisateur_id, a.utilisateur_id) as utilisateur_id,
         e.lot_id, e.mission_id, e.m1, e.m2, e.a1, e.a2,
         (e.lot_id is not null) as droit, (a.date_lot is not null) as attribue,
         (e.lot_id is not null and a.date_lot is not null and e.updated_at > a.created_at) as modifie_apres
  from elig e full join att a on a.utilisateur_id = e.utilisateur_id and a.date_lot = e.date)`;
  return {
    par_mission: `${full}
select coalesce(m.code_mission,'(sans mission)') as mission,
       count(*) filter (where j.droit) as droits, count(*) filter (where j.attribue) as attribues,
       count(*) filter (where j.droit and not j.attribue) as non_attribues,
       count(*) filter (where j.attribue and not j.droit) as attribues_sans_droit,
       count(*) filter (where j.modifie_apres) as modifies_apres
from j left join missions m on m.id = j.mission_id
where (m.id is null or (true ${f.m}))
group by 1 order by 4 desc`,
    ecarts: `${full}
select j.date, j.utilisateur_id, ${nom('ip')} as salarie, m.code_mission as mission,
       case when j.droit and not j.attribue then 'non_attribue' when j.attribue and not j.droit then 'attribue_sans_droit' else 'modifie_apres' end as ecart,
       j.m1, j.m2, j.a1, j.a2
from j left join missions m on m.id = j.mission_id
${JOIN_NOM('ip', 'j.utilisateur_id')}
where (j.droit <> j.attribue or j.modifie_apres) and (m.id is null or (true ${f.m}))
order by j.date desc limit 1500`,
  };
}

// ---------- Visites médicales ----------
// À passer : salariés en contrat à la date choisie ayant (2e mission ou plus) OU travailleur handicapé OU statut RE.
function visites(p) {
  const { au, f } = ctx(p);
  return {
    liste: `
with actifs as (
  select distinct on (c.utilisateur_id) c.utilisateur_id, c.statut, c.nature_contrat, coalesce(m.code_mission, '(sans mission)') as code_mission
  from contrats c left join missions m on m.id = c.mission_id
  where c.statut <> 'FRGEN' and c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${au}' ${f.mo} ${f.c}
  order by c.utilisateur_id, c.date_debut desc),
nb as (select utilisateur_id, count(distinct mission_id) as nb_missions from contrats where statut <> 'FRGEN' group by 1)
select a.utilisateur_id, ${nom('ip')} as salarie, a.statut, a.nature_contrat as nature, a.code_mission as mission,
       nb.nb_missions, coalesce(s.travailleur_handicape,false) as travailleur_handicape,
       (select max(d.created_at)::date from salarie_documents d
         where d.utilisateur_id = a.utilisateur_id and d.document_type = 'Attestation Visite médicale') as derniere_vm,
       array_remove(array[
         case when nb.nb_missions >= 2 then '2e mission ou plus' end,
         case when coalesce(s.travailleur_handicape,false) then 'Travailleur handicapé' end,
         case when a.statut in ('RE','RER','RERF','REF') then 'Responsable d''équipe' end], null) as motifs
from actifs a
join nb on nb.utilisateur_id = a.utilisateur_id
${JOIN_NOM('ip', 'a.utilisateur_id')}
left join utilisateur_situations s on s.utilisateur_id = a.utilisateur_id
where nb.nb_missions >= 2 or coalesce(s.travailleur_handicape,false) or a.statut in ('RE','RER','RERF','REF')
order by 2`,
  };
}

// Liste des missions pour le filtre (missions touchées par un contrat sur la période)
function missionsFiltre(p) {
  const { du, au, f } = ctx(p);
  return {
    liste: `
select distinct m.code_mission as mission, ${VILLE} as ville
from contrats c join missions m on m.id = c.mission_id
where c.date_debut <= '${au}' and coalesce(c.date_fin, ${FIN}) >= '${du}' and c.statut <> 'FRGEN' ${f.m}
order by 1 desc`,
  };
}

export const SECTIONS = { effectifs, contrats, avenants, cdi, dossiers, absences, fpe, acomptes, titres, visites, missions: missionsFiltre };
export const buildRrhQueries = (section, params) => (SECTIONS[section] ? SECTIONS[section](params) : null);
