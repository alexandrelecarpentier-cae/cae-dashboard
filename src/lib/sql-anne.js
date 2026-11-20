// Requêtes SQL du dashboard "Anne" (/anne) : tous les indicateurs de
// NOTE-INDICATEURS.md, filtrables et regroupables sur les mêmes dimensions.
//
// Principe : une base commune (CTE) construite à trois niveaux, puis des
// agrégats par "section" (une section = un appel /api/anne?section=...) :
//   mis -> missions (dimensions de mission, filtrées)
//   lx  -> une ligne par lot (jour x recruteur x mission) + dimensions de temps
//   dn  -> une ligne par don (lot du don + heure du don + âge/civilité du donateur)
// Les filtres sont posés une seule fois sur ces trois niveaux ; chaque section
// agrège ensuite par les 0 à 2 dimensions de regroupement choisies, avec une
// ligne de total (GROUPING SETS). Les ratios (taux réel, présence...) sont
// calculés côté page à partir des comptes/sommes renvoyés, comme la règle
// "on additionne d'abord, on divise ensuite" de NOTE-INDICATEURS.md.
//
// Règles reprises telles quelles des autres dashboards : clients exclus et
// missions de mobilisation écartés (sauf section "mobilisation"), lots futurs
// ignorés, heures non déclarées ignorées le jour même, heures de rue à 0 si
// recruteur absent, don valide = nouveau/en_attente/transmis.
import { excludeClientsClause, excludedClientsSqlList } from './excluded-clients.js';
import { RE_DATE, sanitizeFreeText } from './metabase.js';
import { donMotifCase } from './sql-rd.js';
import { CODES_ABSENCE_IGNORES } from './sql-salarie.js';

const VALID = "('nouveau','en_attente','transmis')";
const ALL5 = "('nouveau','en_attente','transmis','incomplet','annule')";

// kind : list (valeurs multiples) | date (de/à) | num (min/max) | group (regroupement seul)
// level : mission | lot | don (niveau auquel la dimension existe)
export const DIMS = {
  asso:        { label: 'Association',                kind: 'list',  level: 'mission', col: 'asso' },
  mission:     { label: 'Mission',                    kind: 'list',  level: 'mission', col: 'mission' },
  ville:       { label: 'Ville',                      kind: 'list',  level: 'mission', col: 'ville' },
  jour:        { label: 'Jour du lot',                kind: 'date',  level: 'lot',     col: 'jour' },
  lv_ms:       { label: 'LV / MS',                    kind: 'list',  level: 'mission', col: 'lv_ms' },
  rm:          { label: 'RM',                         kind: 'list',  level: 'mission', col: 'rm' },
  statut_rd:   { label: 'Statut RD',                  kind: 'list',  level: 'lot',     col: 'statut_rd' },
  format:      { label: 'Format mission',             kind: 'list',  level: 'mission', col: 'format_mission' },
  type_mission:{ label: 'Type mission',               kind: 'list',  level: 'mission', col: 'type_mission' },
  re:          { label: 'RE',                         kind: 'list',  level: 'mission', col: 're' },
  cat_ville:   { label: 'Catégorie de ville (street)',kind: 'list',  level: 'mission', col: 'cat_ville' },
  annee:       { label: 'Année',                      kind: 'num',   level: 'lot',     col: 'annee' },
  mois:        { label: 'Mois',                       kind: 'num',   level: 'lot',     col: 'mois' },
  semaine:     { label: 'Semaine de l’année',    kind: 'num',   level: 'lot',     col: 'semaine' },
  idx_jour:    { label: 'Index des jours (jour du mois)',            kind: 'num',   level: 'lot',     col: 'idx_jour' },
  idx_semaine: { label: 'Index des semaines',         kind: 'num',   level: 'lot',     col: 'idx_semaine' },
  idx_jour_mission:    { label: 'Index par jour de mission',    kind: 'num', level: 'lot', col: 'idx_jour_mission' },
  idx_semaine_mission: { label: 'Index par semaine de mission', kind: 'num', level: 'lot', col: 'idx_semaine_mission' },
  heure:       { label: 'Index des heures',           kind: 'num',   level: 'don',     col: 'heure' },
  annee_mois:  { label: 'Année-mois',                 kind: 'group', level: 'lot',     col: 'annee_mois' },
};

const LIST_MAX_VALUES = 300;

export function parseAnneParams(url) {
  const filters = {};
  for (const [key, d] of Object.entries(DIMS)) {
    if (d.kind === 'list') {
      const raw = url.searchParams.get(key);
      if (!raw) continue;
      const vals = [];
      for (const part of raw.split('|').slice(0, LIST_MAX_VALUES)) {
        const s = sanitizeFreeText(part, 100);
        if (!s) continue;
        if (s.error) return { error: `${key} : valeur invalide` };
        vals.push(s.value);
      }
      if (vals.length) filters[key] = { list: vals };
    } else if (d.kind === 'date') {
      const from = url.searchParams.get(`${key}_from`) || '';
      const to = url.searchParams.get(`${key}_to`) || '';
      if ((from && !RE_DATE.test(from)) || (to && !RE_DATE.test(to))) return { error: `${key} : date invalide` };
      if (from || to) filters[key] = { from: from || null, to: to || null };
    } else if (d.kind === 'num') {
      const min = url.searchParams.get(`${key}_min`) || '';
      const max = url.searchParams.get(`${key}_max`) || '';
      if ((min && !/^-?\d{1,6}$/.test(min)) || (max && !/^-?\d{1,6}$/.test(max))) return { error: `${key} : nombre invalide` };
      if (min || max) filters[key] = { min: min === '' ? null : Number(min), max: max === '' ? null : Number(max) };
    }
  }
  const group = (url.searchParams.get('group') || '').split('|').filter(Boolean).slice(0, 2);
  for (const g of group) if (!DIMS[g]) return { error: `regroupement invalide : ${g}` };
  return { filters, group };
}

// Clause WHERE pour les dimensions d'un niveau donné.
function filtersSql(p, level) {
  const c = [];
  for (const [key, f] of Object.entries(p.filters || {})) {
    const d = DIMS[key];
    if (d.level !== level) continue;
    if (f.list) c.push(`${d.col} IN (${f.list.map((v) => `'${v}'`).join(', ')})`);
    if (d.kind === 'date') {
      if (f.from) c.push(`${d.col} >= '${f.from}'::date`);
      if (f.to) c.push(`${d.col} <= '${f.to}'::date`);
    }
    if (d.kind === 'num') {
      if (f.min != null) c.push(`${d.col} >= ${f.min}`);
      if (f.max != null) c.push(`${d.col} <= ${f.max}`);
    }
  }
  return c.length ? `WHERE ${c.join(' AND ')}` : '';
}

// ---------------------------------------------------------------------------
// Dimensions calculées
// ---------------------------------------------------------------------------
const FORMAT_EXPR = `CASE WHEN m.format IN ('sitesprives','site_prive','sites_privees') THEN 'site_prive'
      WHEN m.format IS NULL THEN 'non_renseigne' ELSE m.format END`;

// Grade du contrat -> statut RD (RD / RDC / RDE ; RE = responsables d'équipe).
const statutRd = (g) => `CASE WHEN ${g} = 'RD' THEN 'RD' WHEN ${g} = 'RDC' THEN 'RDC' WHEN ${g} IN ('RDE','RDE+') THEN 'RDE'
      WHEN ${g} IN ('RE','RER','RERF','REF') THEN 'RE' WHEN ${g} IS NULL THEN 'Inconnu' ELSE 'Autre' END`;

// d = expression date ; s = date de début de mission.
// Index des jours = jour du mois (1 à 31). Index des semaines : compteur continu
// depuis le lundi 30 décembre 2024 (semaine 1). Index "de mission" :
// jour 1 / semaine 1 = début de la mission.
const timeDims = (d, s) => `extract(year FROM ${d})::int AS annee,
      extract(month FROM ${d})::int AS mois,
      extract(week FROM ${d})::int AS semaine,
      to_char(${d}, 'YYYY-MM') AS annee_mois,
      extract(day FROM ${d})::int AS idx_jour,
      (floor((${d} - date '2024-12-30') / 7.0) + 1)::int AS idx_semaine,
      (${d} - ${s} + 1)::int AS idx_jour_mission,
      (floor((${d} - ${s}) / 7.0) + 1)::int AS idx_semaine_mission`;

// Villes connues (code = 3 dernières lettres du code mission) et catégorie de
// ville street : même grille que les questions Metabase "DASHBOARDS ANNE".
export const VILLES = [
  ['PAR', 'PARIS', 'Hors street'], ['LYO', 'LYON', 'Cat. 1'], ['BOR', 'BORDEAUX', 'Cat. 1'], ['TOU', 'TOULOUSE', 'Cat. 1'],
  ['NAN', 'NANTES', 'Cat. 1'], ['LIL', 'LILLE', 'Cat. 1'], ['STR', 'STRASBOURG', 'Cat. 1'], ['MAR', 'MARSEILLE', 'Cat. 1'],
  ['GRE', 'GRENOBLE', 'Cat. 2'], ['NIC', 'NICE', 'Cat. 2'], ['REN', 'RENNES', 'Cat. 2'], ['MON', 'MONTPELLIER', 'Cat. 2'],
  ['DIJ', 'DIJON', 'Cat. 3'], ['ANG', 'ANGERS-LE MANS', 'Cat. 3'], ['MET', 'METZ NANCY', 'Cat. 3'], ['ROU', 'ROUEN-LE HAVRE', 'Cat. 3'],
  ['CLE', 'CLERMONT-FERRAND', 'Cat. 4'], ['RUN', 'LA RÉUNION', 'Hors grille'], ['TLS', 'TOULOUSE', 'Cat. 1'], ['PAU', 'PAU', 'Hors grille'], ['BAY', 'BAYONNE', 'Hors grille'], ['LIM', 'LIMOGES', 'Hors grille'], ['ANN', 'ANNECY-CHAMBÉRY', 'Cat. 4'], ['CAE', 'CAEN', 'Cat. 4'], ['TRS', 'TOURS', 'Cat. 4'],
];

// Missions du périmètre (filtres de niveau mission appliqués).
function misCtes(p, { mobilisation = false } = {}) {
  const scope = mobilisation
    ? `AND m.client_id NOT IN (${excludedClientsSqlList()}) AND m.type_offre = 'mobilisation'`
    : excludeClientsClause('m');
  return `vm(code, nom, cat) AS (VALUES ${VILLES.map(([c, n, k]) => `('${c}','${n}','${k}')`).join(', ')}),
mis_raw AS (
  SELECT m.id AS mission_id, m.code_mission AS mission, m.client_id, c.nom AS asso,
    m.date_debut AS jour_depart, m.date_fin AS jour_fin,
    coalesce(vm.nom, nullif(upper(trim(m.ville_principale)), ''), 'NON RENSEIGNÉE') AS ville,
    CASE WHEN array_to_string(m.jours, ',') ILIKE '%lundi%' AND array_to_string(m.jours, ',') NOT ILIKE '%samedi%' THEN 'LV'
      WHEN array_to_string(m.jours, ',') ILIKE '%samedi%' AND array_to_string(m.jours, ',') NOT ILIKE '%lundi%' THEN 'MS'
      WHEN coalesce(array_to_string(m.jours, ','), '') = '' THEN 'Non renseigné' ELSE 'Autre' END AS lv_ms,
    coalesce(uip_rm.prenom || ' ' || upper(uip_rm.nom), u_rm.email, 'Non renseigné') AS rm,
    coalesce(uip_re.prenom || ' ' || upper(uip_re.nom), u_re.email, 'Non renseigné') AS re,
    ${FORMAT_EXPR} AS format_mission,
    CASE WHEN lower(m.type_mission) IN ('itinérante','itinerante') THEN 'itinerante'
      WHEN lower(m.type_mission) IN ('spéciale','speciale') THEN 'speciale'
      WHEN m.type_mission IS NULL THEN 'non_renseigne' ELSE lower(m.type_mission) END AS type_mission,
    CASE WHEN ${FORMAT_EXPR} = 'street' THEN coalesce(vm.cat, 'Hors grille') ELSE 'Hors street' END AS cat_ville,
    m.objectif_bulletin_theorique AS objectif
  FROM missions m
  JOIN clients c ON c.id = m.client_id
  LEFT JOIN vm ON vm.code = upper(right(regexp_replace(m.code_mission, '(SP|HYB)$', ''), 3))
  LEFT JOIN utilisateurs u_rm ON u_rm.id = m.responsable_mission_id
  LEFT JOIN utilisateur_informations_personnelles uip_rm ON uip_rm.utilisateur_id = m.responsable_mission_id
  LEFT JOIN utilisateurs u_re ON u_re.id = m.responsable_equipe_id
  LEFT JOIN utilisateur_informations_personnelles uip_re ON uip_re.utilisateur_id = m.responsable_equipe_id
  WHERE m.statut_mission IN ('terminee', 'en_cours') ${scope}
),
mis AS (SELECT * FROM mis_raw ${filtersSql(p, 'mission')})`;
}

// Lots du périmètre : une ligne par jour x recruteur x mission.
function lotCtes(p) {
  return `${misCtes(p)},
ctr_m AS (
  SELECT DISTINCT ON (c.utilisateur_id, c.mission_id) c.utilisateur_id, c.mission_id, upper(trim(c.statut)) AS grade
  FROM contrats c WHERE c.mission_id IN (SELECT mission_id FROM mis)
  ORDER BY c.utilisateur_id, c.mission_id, c.date_debut DESC NULLS LAST
),
ctr_l AS (
  SELECT DISTINCT ON (c.utilisateur_id) c.utilisateur_id, upper(trim(c.statut)) AS grade
  FROM contrats c
  WHERE c.utilisateur_id IN (SELECT DISTINCT l.utilisateur_id FROM lots l WHERE l.mission_id IN (SELECT mission_id FROM mis))
  ORDER BY c.utilisateur_id, c.date_debut DESC NULLS LAST
),
lf AS (
  SELECT l.id AS lot_id, l.date AS jour, l.utilisateur_id, l.emplacement_id,
    CASE WHEN l.presence_recruteur IS DISTINCT FROM false THEN l.nombre_horaires_rue ELSE 0 END AS hr,
    CASE WHEN coalesce(l.nombre_horaires_remuneration, 0) <> 0 THEN l.nombre_horaires_remuneration ELSE 0 END AS hrem,
    (coalesce(l.nombre_horaires_remuneration, 0) <> 0) AS presente,
    ta.code AS abs_code, ta.libelle AS abs_libelle,
    coalesce(cm.grade, cl.grade) AS grade_raw,
    mis.*
  FROM lots l
  JOIN mis ON mis.mission_id = l.mission_id
  LEFT JOIN ctr_m cm ON cm.utilisateur_id = l.utilisateur_id AND cm.mission_id = l.mission_id
  LEFT JOIN ctr_l cl ON cl.utilisateur_id = l.utilisateur_id
  LEFT JOIN absences ab ON ab.id = l.absence_id
  LEFT JOIN types_absences ta ON ta.id = ab.type_absence_id
  WHERE l.date <= CURRENT_DATE
    AND (coalesce(l.heures_remuneration_completes, true) OR l.date < CURRENT_DATE)
),
lx AS (
  SELECT t.*, (row_number() OVER (PARTITION BY t.mission_id ORDER BY t.jour, t.lot_id) = 1) AS prem FROM (
    SELECT lf.*, ${statutRd('lf.grade_raw')} AS statut_rd, ${timeDims('lf.jour', 'lf.jour_depart')},
      (NOT lf.presente AND coalesce(lf.abs_code IN ${CODES_ABSENCE_IGNORES}, false)) AS abs_ignoree
    FROM lf
  ) t ${filtersSql(p, 'lot')}
)`;
}

// Dons du périmètre : une ligne par don rattaché à un lot de lx.
function donCtes(p) {
  return `${lotCtes(p)},
dn_raw AS (
  SELECT d.id AS don_id, d.statut, d.montant, d.created_at, d.old_cae_id, d.date_transmission, d.type_de_don, d.donateur_id,
    extract(hour FROM (d.created_at AT TIME ZONE 'Europe/Paris'))::int AS heure,
    dnr.civilite,
    CASE WHEN dnr.date_de_naissance IS NULL THEN NULL
      ELSE (d.created_at::date - dnr.date_de_naissance)::float / 365.25 END AS age,
    lx.*
  FROM dons d
  JOIN lx ON lx.lot_id = d.lot_id
  LEFT JOIN donateurs dnr ON dnr.id = d.donateur_id
  WHERE d.statut IN ${ALL5}
),
dn AS (SELECT * FROM dn_raw ${filtersSql(p, 'don')})`;
}

// ---------------------------------------------------------------------------
// Regroupement : 0 à 2 dimensions + ligne de total (gt = 1).
// side 'lot' ignore les dimensions qui n'existent que sur les dons (heure).
// ---------------------------------------------------------------------------
function groupParts(p, side, { total = true, ref = (e) => e.expr } = {}) {
  const all = (p.group || []).map((k, i) => ({ i: i + 1, level: DIMS[k].level, expr: `(${DIMS[k].col})::text` }));
  const used = all.filter((e) => side !== 'lot' || e.level !== 'don');
  const sel = [1, 2].map((i) => {
    const e = used.find((x) => x.i === i);
    return e ? `${ref(e)} AS g${i}` : `NULL::text AS g${i}`;
  }).join(', ');
  const list = used.map(ref).join(', ');
  if (!used.length) return { sel, flag: '1 AS gt', groupBy: '', list, used };
  if (!total) return { sel, flag: '0 AS gt', groupBy: `GROUP BY ${list}`, list, used };
  return { sel, flag: `(grouping(${list}) <> 0)::int AS gt`, groupBy: `GROUP BY GROUPING SETS ((${list}), ())`, list, used };
}

const metricsSql = (metrics) => metrics.map(([a, s]) => `${s} AS ${a}`).join(',\n  ');

function aggSql(from, metrics, p, side) {
  const g = groupParts(p, side);
  return `SELECT ${g.sel}, ${g.flag},\n  ${metricsSql(metrics)}\nFROM ${from}\n${g.groupBy}`;
}

function joinAggs(lotM, donM) {
  const cols = [...lotM.map((m) => `l.${m[0]}`), ...donM.map((m) => `d.${m[0]}`)].join(', ');
  return `SELECT coalesce(l.g1, d.g1) AS g1, coalesce(l.g2, d.g2) AS g2, coalesce(l.gt, d.gt) AS gt, ${cols}
FROM lot_agg l
FULL JOIN don_agg d ON l.gt = d.gt AND coalesce(l.g1, '~') = coalesce(d.g1, '~') AND coalesce(l.g2, '~') = coalesce(d.g2, '~')
ORDER BY 3, 1, 2;`;
}

// ---------------------------------------------------------------------------
// Indicateurs "lots" (heures, présence, absence, équipes) et "dons"
// ---------------------------------------------------------------------------
const LOT_METRICS = [
  ['nb_missions', 'count(DISTINCT mission_id)'],
  ['nb_lots', 'count(*)'],
  ['nb_jours_activite', 'count(DISTINCT jour)'],
  ['nb_recruteurs', 'count(DISTINCT utilisateur_id)'],
  ['nb_rd', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd <> 'RE')"],
  ['nb_re', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RE')"],
  ['nb_rd_simple', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RD')"],
  ['nb_rdc', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RDC')"],
  ['nb_rde', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RDE')"],
  ['volume_contractuel', 'coalesce(sum(objectif) FILTER (WHERE prem), 0)'],
  ['jours_absence_total', 'count(*) FILTER (WHERE NOT presente AND abs_code IS NOT NULL)'],
  ['heures_rue', 'coalesce(sum(hr), 0)'],
  ['heures_rem', 'coalesce(sum(hrem), 0)'],
  ['jours_presents', 'count(*) FILTER (WHERE presente)'],
  ['rd_attendus', "count(*) FILTER (WHERE statut_rd <> 'RE')"],
  ['rd_presents', "count(*) FILTER (WHERE statut_rd <> 'RE' AND presente)"],
  ['jours_retenus', 'count(*) FILTER (WHERE NOT abs_ignoree)'],
  ['jours_absence_code', 'count(*) FILTER (WHERE NOT abs_ignoree AND NOT presente AND abs_code IS NOT NULL)'],
  ['jours_absence', 'count(*) FILTER (WHERE NOT presente)'],
  ['jours_absence_hors_am', "count(*) FILTER (WHERE NOT presente AND (abs_libelle IS NULL OR abs_libelle NOT ILIKE '%maladie%'))"],
  ['lots_emplacement', 'count(*) FILTER (WHERE emplacement_id IS NOT NULL)'],
];

const V = `statut IN ${VALID}`;
const DON_METRICS = [
  ['bs_reel', `count(*) FILTER (WHERE ${V})`],
  ['bs_rue', 'count(*)'],
  ['bs_incomplets', "count(*) FILTER (WHERE statut = 'incomplet')"],
  ['bs_annules', "count(*) FILTER (WHERE statut = 'annule')"],
  ['montant_valide', `coalesce(sum(montant) FILTER (WHERE ${V}), 0)`],
  ['age_median', `percentile_cont(0.5) WITHIN GROUP (ORDER BY age) FILTER (WHERE ${V} AND age IS NOT NULL)`],
  ['somme_age', `coalesce(sum(age) FILTER (WHERE ${V} AND age IS NOT NULL), 0)`],
  ['nb_age', `count(*) FILTER (WHERE ${V} AND age IS NOT NULL)`],
  ['nb_moins_25', `count(*) FILTER (WHERE ${V} AND age < 25)`],
  ['t_18_20', `count(*) FILTER (WHERE ${V} AND age >= 18 AND age < 21)`],
  ['t_21_25', `count(*) FILTER (WHERE ${V} AND age >= 21 AND age < 26)`],
  ['t_26_35', `count(*) FILTER (WHERE ${V} AND age >= 26 AND age < 36)`],
  ['t_36_50', `count(*) FILTER (WHERE ${V} AND age >= 36 AND age < 51)`],
  ['t_51p', `count(*) FILTER (WHERE ${V} AND age >= 51)`],
  ['t_autre', `count(*) FILTER (WHERE ${V} AND (age IS NULL OR age < 18))`],
  ['g_h', `count(*) FILTER (WHERE ${V} AND civilite = 'monsieur')`],
  ['g_f', `count(*) FILTER (WHERE ${V} AND civilite = 'madame')`],
  ['g_autre', `count(*) FILTER (WHERE ${V} AND (civilite IS NULL OR civilite NOT IN ('monsieur','madame')))`],
];

function buildCoreQuery(p) {
  return `WITH ${donCtes(p)},
lot_agg AS (
${aggSql('lx', LOT_METRICS, p, 'lot')}
),
don_agg AS (
${aggSql('dn', DON_METRICS, p, 'don')}
)
${joinAggs(LOT_METRICS, DON_METRICS)}`;
}

// Horaires du 1er / dernier BS de la journée (heure de Paris), moyennés sur
// les jours du groupe. Un "jour" = une mission x une date.
function buildHorairesQuery(p) {
  const day = groupParts(p, 'don', { total: false });
  const dayList = [...day.used.map((e) => e.expr), 'mission_id', 'jour'].join(', ');
  const hf = `(extract(hour FROM (created_at AT TIME ZONE 'Europe/Paris')) + extract(minute FROM (created_at AT TIME ZONE 'Europe/Paris')) / 60.0)`;
  const g = groupParts(p, 'don', { ref: (e) => `g${e.i}` });
  return `WITH ${donCtes(p)},
dday AS (
  SELECT ${day.sel}, mission_id, jour, min(${hf}) AS h_min, max(${hf}) AS h_max
  FROM dn WHERE ${V} GROUP BY ${dayList}
)
SELECT ${g.sel}, ${g.flag}, avg(h_min) AS h_premier, avg(h_max) AS h_dernier, count(*) AS nb_jours
FROM dday ${g.groupBy}
ORDER BY 3, 1, 2;`;
}

// Dons suspects : mêmes 14 contrôles que /rd (donMotifCase), sur les dons
// valides + annulés du périmètre. "Donateur multiple" ne compte que s'il y a
// plus de 5 dons pour ce donateur.
function suspectsCtes(p) {
  return `${donCtes(p)},
dons_s AS (SELECT * FROM dn WHERE statut IN ('nouveau','en_attente','transmis','annule')),
rc AS (
  SELECT u_c.email, u_c.telephone, u_c.utilisateur_id
  FROM utilisateur_informations_contact u_c
  WHERE EXISTS (SELECT 1 FROM donateurs d2 WHERE d2.id IN (SELECT donateur_id FROM dons_s) AND lower(d2.email) = lower(u_c.email))
),
dstats AS (
  SELECT email, count(*) AS nb_dons_total FROM donateurs
  WHERE email IN (SELECT dd.email FROM donateurs dd WHERE dd.id IN (SELECT donateur_id FROM dons_s))
    AND email NOT ILIKE '%nomail%'
  GROUP BY email
),
motifs AS (
  SELECT df.*, coalesce(dts.nb_dons_total, 0) AS nb_dons_total,
    ${donMotifCase('df', 'don', 'u_p_actuel', 'u_c_actuel', 'rc_tiers', 'dts')} AS motif
  FROM dons_s df
  JOIN donateurs don ON don.id = df.donateur_id
  LEFT JOIN dstats dts ON don.email = dts.email
  JOIN utilisateur_informations_personnelles u_p_actuel ON df.utilisateur_id = u_p_actuel.utilisateur_id
  JOIN utilisateur_informations_contact u_c_actuel ON df.utilisateur_id = u_c_actuel.utilisateur_id
  LEFT JOIN rc rc_tiers ON ((lower(don.email) = lower(rc_tiers.email) OR nullif(don.telephone_mobile, '') = rc_tiers.telephone)
    AND rc_tiers.utilisateur_id <> df.utilisateur_id)
)`;
}

function buildSuspectsQueries(p) {
  const suspect = `motif <> '✅ Ok' AND (motif <> '👥 Donateur multiple' OR nb_dons_total > 5)`;
  return {
    groupes: `WITH ${suspectsCtes(p)}
${aggSql('motifs', [
    ['nb_controles', 'count(DISTINCT don_id)'],
    ['nb_suspects', `count(DISTINCT don_id) FILTER (WHERE ${suspect})`],
  ], p, 'don')}
ORDER BY 3, 1, 2;`,
    motifs: `WITH ${suspectsCtes(p)}
SELECT motif, count(DISTINCT don_id) AS nb FROM motifs GROUP BY motif ORDER BY nb DESC;`,
  };
}

// Équipes & RH : au niveau des contrats. Les dimensions de temps portent sur
// la date de début du contrat (= date de recrutement) ; l'index "de mission"
// est alors le jour de la mission où la personne a été recrutée.
const RH_METRICS = [
  ['nb_contrats', 'count(DISTINCT contrat_id)'],
  ['nb_salaries', 'count(DISTINCT utilisateur_id)'],
  ['nb_missions', 'count(DISTINCT mission_id)'],
  ['nb_fpe', 'count(DISTINCT contrat_id) FILTER (WHERE fpe_emp OR fpe_sal)'],
  ['nb_fpe_employeur', 'count(DISTINCT contrat_id) FILTER (WHERE fpe_emp)'],
  ['nb_fpe_salarie', 'count(DISTINCT contrat_id) FILTER (WHERE fpe_sal)'],
  ['g_rd', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RD')"],
  ['g_rdc', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RDC')"],
  ['g_rde', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RDE')"],
  ['g_re', "count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RE')"],
  ['nb_anciens', 'count(DISTINCT utilisateur_id) FILTER (WHERE nbm_n >= 3)'],
  ['nb_nouveaux', 'count(DISTINCT utilisateur_id) FILTER (WHERE coalesce(nbm_n, 0) < 3)'],
];

function buildRhQuery(p) {
  return `WITH ${misCtes(p)},
cx AS (
  SELECT * FROM (
    SELECT c.id AS contrat_id, c.utilisateur_id, c.date_debut AS cdate, c.date_debut AS jour, mis.*,
      ${statutRd("upper(trim(c.statut))")} AS statut_rd, ${timeDims('c.date_debut', 'mis.jour_depart')}
    FROM contrats c JOIN mis ON mis.mission_id = c.mission_id
    WHERE c.date_debut IS NOT NULL
  ) t ${filtersSql(p, 'lot')}
),
fpe AS (
  SELECT av.contrat_id AS fpe_contrat,
    bool_or(ta.libelle ILIKE '%employeur%') AS fpe_emp, bool_or(ta.libelle ILIKE '%salari%') AS fpe_sal
  FROM avenants av JOIN types_avenants ta ON ta.id = av.type_avenant_id
  WHERE ta.categorie = 'fin_period_essai' AND av.oneflow_status IN ('signe', 'publie')
    AND av.contrat_id IN (SELECT contrat_id FROM cx)
  GROUP BY 1
),
nbm AS (
  SELECT c.utilisateur_id AS nbm_user, count(DISTINCT c.mission_id) AS nbm_n
  FROM contrats c JOIN missions m ON m.id = c.mission_id
  WHERE c.utilisateur_id IN (SELECT utilisateur_id FROM cx) ${excludeClientsClause('m')}
  GROUP BY 1
)
${aggSql('cx LEFT JOIN fpe ON fpe.fpe_contrat = cx.contrat_id LEFT JOIN nbm ON nbm.nbm_user = cx.utilisateur_id', RH_METRICS, p, 'lot')}
ORDER BY 3, 1, 2;`;
}

// Une ligne par mission du périmètre : objectif / avancement, effectifs, délai
// de complétion d'équipe (jours entre le début de mission et le dernier contrat).
function buildMissionsQuery(p) {
  return `WITH ${donCtes(p)},
lm AS (
  SELECT mission_id, count(*) AS nb_lots, count(DISTINCT utilisateur_id) AS nb_recruteurs,
    count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd <> 'RE') AS nb_rd,
    count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RD') AS nb_rd_simple,
    count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RDC') AS nb_rdc,
    count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RDE') AS nb_rde,
    count(DISTINCT utilisateur_id) FILTER (WHERE statut_rd = 'RE') AS nb_re,
    count(*) FILTER (WHERE NOT presente AND abs_code IS NOT NULL) AS jours_absence_total,
    coalesce(sum(hr), 0) AS heures_rue, coalesce(sum(hrem), 0) AS heures_rem, count(DISTINCT jour) AS jours_activite
  FROM lx GROUP BY 1
),
dm AS (SELECT mission_id, count(*) FILTER (WHERE ${V}) AS bs_reel, count(*) AS bs_rue,
  coalesce(sum(montant) FILTER (WHERE ${V}), 0) AS montant_valide FROM dn GROUP BY 1),
fp AS (
  SELECT c.mission_id, count(DISTINCT c.id) AS nb_contrats,
    count(DISTINCT c.id) FILTER (WHERE EXISTS (
      SELECT 1 FROM avenants av JOIN types_avenants ta ON ta.id = av.type_avenant_id
      WHERE av.contrat_id = c.id AND ta.categorie = 'fin_period_essai' AND av.oneflow_status IN ('signe', 'publie'))) AS nb_fpe
  FROM contrats c WHERE c.mission_id IN (SELECT mission_id FROM lm) GROUP BY 1
),
cumul AS (
  SELECT l.mission_id, count(*) AS bs_cumul FROM dons d JOIN lots l ON l.id = d.lot_id
  WHERE l.mission_id IN (SELECT mission_id FROM lm) AND d.statut IN ${VALID} AND l.date <= CURRENT_DATE GROUP BY 1
),
jt AS (
  SELECT l.mission_id, count(DISTINCT l.date) AS jours_total,
    count(DISTINCT l.date) FILTER (WHERE l.date <= CURRENT_DATE) AS jours_echus
  FROM lots l WHERE l.mission_id IN (SELECT mission_id FROM lm) GROUP BY 1
),
comp AS (SELECT c.mission_id, max(c.date_debut) AS derniere_arrivee FROM contrats c WHERE c.mission_id IN (SELECT mission_id FROM lm) GROUP BY 1)
SELECT m.mission_id, m.mission, m.asso, m.ville, m.format_mission, m.type_mission, m.cat_ville, m.lv_ms, m.rm, m.re,
  m.jour_depart, m.jour_fin, m.objectif,
  lm.nb_lots, lm.nb_recruteurs, lm.nb_rd, lm.nb_rd_simple, lm.nb_rdc, lm.nb_rde, lm.nb_re, lm.jours_absence_total,
  coalesce(dm.montant_valide, 0) AS montant_valide, coalesce(fp.nb_contrats, 0) AS nb_contrats, coalesce(fp.nb_fpe, 0) AS nb_fpe, lm.heures_rue, lm.heures_rem, lm.jours_activite,
  coalesce(dm.bs_reel, 0) AS bs_reel, coalesce(dm.bs_rue, 0) AS bs_rue, coalesce(cumul.bs_cumul, 0) AS bs_cumul,
  jt.jours_total, jt.jours_echus, (comp.derniere_arrivee - m.jour_depart) AS delai_completion
FROM mis m
JOIN lm ON lm.mission_id = m.mission_id
LEFT JOIN dm ON dm.mission_id = m.mission_id
LEFT JOIN fp ON fp.mission_id = m.mission_id
LEFT JOIN cumul ON cumul.mission_id = m.mission_id
LEFT JOIN jt ON jt.mission_id = m.mission_id
LEFT JOIN comp ON comp.mission_id = m.mission_id
ORDER BY m.jour_depart DESC NULLS LAST, m.mission
LIMIT 500;`;
}

// Heures et BS par salarié présent et par mission.
function buildSalariesQuery(p) {
  return `WITH ${donCtes(p)},
sl AS (
  SELECT utilisateur_id, mission_id, max(mission) AS mission, max(asso) AS asso, max(statut_rd) AS statut_rd,
    count(*) FILTER (WHERE presente) AS jours_presence, coalesce(sum(hrem), 0) AS heures_rem, coalesce(sum(hr), 0) AS heures_rue
  FROM lx WHERE utilisateur_id IS NOT NULL GROUP BY 1, 2
),
sd AS (
  SELECT utilisateur_id, mission_id, count(*) FILTER (WHERE ${V}) AS bs_reel, count(*) AS bs_rue,
    coalesce(sum(montant) FILTER (WHERE ${V}), 0) AS montant_valide
  FROM dn WHERE utilisateur_id IS NOT NULL GROUP BY 1, 2
)
SELECT trim(coalesce(uip.prenom, '') || ' ' || upper(coalesce(uip.nom, ''))) AS salarie, sl.mission, sl.asso, sl.statut_rd,
  sl.jours_presence, sl.heures_rem, sl.heures_rue,
  coalesce(sd.bs_reel, 0) AS bs_reel, coalesce(sd.bs_rue, 0) AS bs_rue, coalesce(sd.montant_valide, 0) AS montant_valide
FROM sl
LEFT JOIN sd ON sd.utilisateur_id = sl.utilisateur_id AND sd.mission_id = sl.mission_id
LEFT JOIN utilisateur_informations_personnelles uip ON uip.utilisateur_id = sl.utilisateur_id
WHERE sl.heures_rem <> 0
ORDER BY coalesce(sd.bs_reel, 0) DESC, sl.heures_rem DESC
LIMIT 500;`;
}

// Volume de dons par statut, plateforme (CozApp / ancien BO), transmissions,
// dépôts, facturation CozApp (dons transmis hors ancien système).
const DONS_METRICS = [
  ['n_nouveau', "count(*) FILTER (WHERE statut = 'nouveau')"],
  ['n_en_attente', "count(*) FILTER (WHERE statut = 'en_attente')"],
  ['n_transmis', "count(*) FILTER (WHERE statut = 'transmis')"],
  ['n_incomplet', "count(*) FILTER (WHERE statut = 'incomplet')"],
  ['n_annule', "count(*) FILTER (WHERE statut = 'annule')"],
  ['n_cozapp', 'count(*) FILTER (WHERE old_cae_id IS NULL)'],
  ['n_bo', 'count(*) FILTER (WHERE old_cae_id IS NOT NULL)'],
  ['montant_valide', `coalesce(sum(montant) FILTER (WHERE ${V}), 0)`],
  ['n_deposes', 'count(*) FILTER (WHERE date_transmission IS NOT NULL)'],
  ['n_facturables', "count(*) FILTER (WHERE statut = 'transmis' AND old_cae_id IS NULL)"],
];

function buildDonsQueries(p) {
  const g = groupParts(p, 'don', { total: false });
  return {
    statuts: `WITH ${donCtes(p)}
${aggSql('dn', DONS_METRICS, p, 'don')}
ORDER BY 3, 1, 2;`,
    facturation: `WITH ${donCtes(p)}
SELECT ${g.sel}, coalesce(type_de_don, '—') AS type_de_don, count(*) AS nb
FROM dn WHERE statut = 'transmis' AND old_cae_id IS NULL
GROUP BY ${[...g.used.map((e) => e.expr), "coalesce(type_de_don, '—')"].join(', ')}
ORDER BY 1, 2, 4 DESC
LIMIT 1000;`,
  };
}

// Emplacements : classement par taux réel (sites sans heures écartés), taux
// réel par jour de semaine et par mois, sur le périmètre filtré.
function buildEmplacementsQueries(p) {
  const base = `WITH ${donCtes(p)},
bs_lot AS (SELECT lot_id, count(*) FILTER (WHERE ${V}) AS bs FROM dn GROUP BY 1),
lb AS (SELECT lx.*, coalesce(b.bs, 0) AS bs FROM lx LEFT JOIN bs_lot b ON b.lot_id = lx.lot_id)`;
  return {
    sites: `${base}
SELECT e.nom, e.ville AS ville_site, e.categorie, count(DISTINCT lb.jour) AS nb_jours, count(DISTINCT lb.mission_id) AS nb_missions,
  coalesce(sum(lb.hr), 0) AS heures_rue, coalesce(sum(lb.bs), 0) AS bs_reel
FROM lb JOIN emplacements e ON e.id = lb.emplacement_id
GROUP BY e.id, e.nom, e.ville, e.categorie
HAVING coalesce(sum(lb.hr), 0) > 0
ORDER BY coalesce(sum(lb.bs), 0)::float / sum(lb.hr) DESC
LIMIT 200;`,
    jours_semaine: `${base}
SELECT extract(isodow FROM jour)::int AS dow, count(DISTINCT jour) AS nb_jours, coalesce(sum(hr), 0) AS heures_rue, coalesce(sum(bs), 0) AS bs_reel
FROM lb GROUP BY 1 ORDER BY 1;`,
    mois: `${base}
SELECT extract(month FROM jour)::int AS mois, count(DISTINCT jour) AS nb_jours, coalesce(sum(hr), 0) AS heures_rue, coalesce(sum(bs), 0) AS bs_reel
FROM lb GROUP BY 1 ORDER BY 1;`,
    categories: `${base}
SELECT coalesce(e.categorie, 'Non renseignée') AS categorie, count(DISTINCT lb.jour) AS nb_jours, coalesce(sum(lb.hr), 0) AS heures_rue, coalesce(sum(lb.bs), 0) AS bs_reel
FROM lb LEFT JOIN emplacements e ON e.id = lb.emplacement_id GROUP BY 1 ORDER BY 3 DESC;`,
  };
}

// Mobilisation (porte-à-porte) : autre domaine (passages / logements), seules
// les dimensions de mission s'appliquent (les dimensions de temps, le statut
// RD et l'heure ne sont pas définis sur les passages).
function buildMobilisationQuery(p) {
  const pm = { ...p, group: (p.group || []).filter((k) => DIMS[k].level === 'mission') };
  const metrics = [
    ['nb_missions', 'count(DISTINCT mission_id)'],
    ['visites', 'coalesce(sum(visites), 0)'],
    ['porte_ouverte', 'coalesce(sum(porte_ouverte), 0)'],
    ['non_conforme', 'coalesce(sum(non_conforme), 0)'],
    ['repasse', 'coalesce(sum(repasse), 0)'],
    ['absent', 'coalesce(sum(absent), 0)'],
    ['passages', 'coalesce(sum(passages), 0)'],
    ['theorique', 'coalesce(sum(theorique), 0)'],
    ['trouves', 'coalesce(sum(trouves), 0)'],
  ];
  return `WITH ${misCtes(pm, { mobilisation: true })},
latest AS (
  SELECT DISTINCT ON (ps.logement_id) ps.logement_id, ps.statut, ps.mission_id
  FROM passages ps WHERE ps.mission_id IN (SELECT mission_id FROM mis)
  ORDER BY ps.logement_id, ps.created_at DESC
),
pm AS (
  SELECT mission_id, count(*) AS visites,
    count(*) FILTER (WHERE statut = 'porte_ouverte') AS porte_ouverte,
    count(*) FILTER (WHERE statut = 'non_conforme') AS non_conforme,
    count(*) FILTER (WHERE statut = 'repasse') AS repasse,
    count(*) FILTER (WHERE statut = 'absent') AS absent
  FROM latest GROUP BY 1
),
pp AS (SELECT l.mission_id, coalesce(sum(lg.passages_count), 0) AS passages FROM latest l JOIN logements lg ON lg.id = l.logement_id GROUP BY 1),
hab AS (
  SELECT hm.mission_id, coalesce(sum(h.nombre_logements), 0) AS theorique, coalesce(sum(h.logements_count), 0) AS trouves
  FROM habitations_missions hm JOIN habitations h ON h.id = hm.habitation_id
  WHERE hm.mission_id IN (SELECT mission_id FROM mis) GROUP BY 1
),
mm AS (
  SELECT mis.*, pm.visites, pm.porte_ouverte, pm.non_conforme, pm.repasse, pm.absent, pp.passages, hab.theorique, hab.trouves
  FROM mis LEFT JOIN pm ON pm.mission_id = mis.mission_id LEFT JOIN pp ON pp.mission_id = mis.mission_id LEFT JOIN hab ON hab.mission_id = mis.mission_id
)
${aggSql('mm', metrics, pm, 'lot')}
ORDER BY 3, 1, 2;`;
}

// Valeurs proposées par les filtres, restreintes par les AUTRES filtres de
// mission déjà choisis (filtres en cascade). Le jour du lot restreint aux
// missions dont la période recoupe l'intervalle.
const FACET_DIMS = [['asso', 'asso'], ['mission', 'mission'], ['ville', 'ville'], ['lv_ms', 'lv_ms'], ['rm', 'rm'], ['re', 're'],
  ['format', 'format_mission'], ['type_mission', 'type_mission'], ['cat_ville', 'cat_ville']];

function buildFacetsQuery(p = emptyParams()) {
  const f = p.filters || {};
  const where = (except) => {
    const c = [];
    for (const [key, d] of Object.entries(DIMS)) {
      if (key === except || d.level !== 'mission' || d.kind !== 'list' || !f[key]) continue;
      c.push(`${d.col} IN (${f[key].list.map((v) => `'${v}'`).join(', ')})`);
    }
    if (f.jour) {
      if (f.jour.from) c.push(`jour_fin >= '${f.jour.from}'::date`);
      if (f.jour.to) c.push(`jour_depart <= '${f.jour.to}'::date`);
    }
    return c.length ? `WHERE ${c.join(' AND ')}` : '';
  };
  const parts = FACET_DIMS.map(([k, col]) => `SELECT '${k}' AS k, ${col}::text AS v FROM mis_raw ${where(k)} GROUP BY 2`);
  parts.push(`SELECT 'statut_rd' AS k, v FROM (VALUES ('RD'), ('RDC'), ('RDE'), ('RE'), ('Autre'), ('Inconnu')) x(v)`);
  return `WITH ${misCtes(emptyParams())}
SELECT k, v FROM (
  ${parts.join('\n  UNION ALL\n  ')}
) t WHERE v IS NOT NULL ORDER BY k, v;`;
}

export function emptyParams() {
  return { filters: {}, group: [] };
}

export const ANNE_SECTIONS = ['core', 'horaires', 'suspects', 'rh', 'missions', 'salaries', 'dons', 'emplacements', 'mobilisation', 'facets'];

// Retourne { nom: sql } ; le handler exécute les requêtes l'une après l'autre
// (une seule à la fois, cf. saturation du pool de connexions Metabase).
export function buildAnneQueries(section, p) {
  switch (section) {
    case 'core': return { rows: buildCoreQuery(p) };
    case 'horaires': return { rows: buildHorairesQuery(p) };
    case 'suspects': return buildSuspectsQueries(p);
    case 'rh': return { rows: buildRhQuery(p) };
    case 'missions': return { rows: buildMissionsQuery(p) };
    case 'salaries': return { rows: buildSalariesQuery(p) };
    case 'dons': return buildDonsQueries(p);
    case 'emplacements': return buildEmplacementsQueries(p);
    case 'mobilisation': return { rows: buildMobilisationQuery(p) };
    case 'facets': return { rows: buildFacetsQuery(p) };
    default: return null;
  }
}
