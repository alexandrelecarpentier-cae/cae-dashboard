// ---------------------------------------------------------------
// /rh-export — mise au format Silae (API REST Silae Paie, doc
// https://silae-api.document360.io). Les colonnes restent celles des cartes
// Metabase ; seules les VALEURS sont converties au format attendu par Silae
// (dates AAAA-MM-JJ, nombres avec point, codes numériques…).
//
// Une seule source pour le code ET la documentation : EXPORT-SILAE.md est
// généré depuis SPECS par `node scripts/generer-doc-silae.mjs`.
//   col     : nom de la colonne affichée / exportée
//   src     : colonne Metabase d'origine (null = colonne ajoutée)
//   silae   : fonction + paramètre de l'API Silae visé
//   format  : format attendu par Silae
//   formule : comment la donnée est calculée (langage non technique)
//   exemple : valeur type après conversion
//   conv    : (valeur, ligne, ctx) => valeur convertie
// ---------------------------------------------------------------
import { SILAE_CODES } from './silae-codes.js';

const vide = (v) => v == null || v === '';

const passer = (v) => (vide(v) ? '' : v);
const texte = (max) => (v) => (vide(v) ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const dateIso = (v) => (vide(v) ? '' : String(v).slice(0, 10)); // « 2026-09-07T00:00:00+02:00 » -> « 2026-09-07 »
const dateHeure = (v) => (vide(v) ? '' : `${String(v).slice(0, 10)}T00:00:00`);
const dateFr = (v) => {
  if (vide(v)) return '';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v);
};
const dec2 = (v) => {
  if (vide(v)) return '';
  const n = Number(v);
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : '';
};
const entier = (v) => {
  if (vide(v)) return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : '';
};
const positif2 = (v) => {
  const s = dec2(v);
  return s === '' ? '' : Math.abs(Number(s)).toFixed(2);
};
const coef = (i) => (v) => (vide(v) ? '' : String(v).split('.')[i] || '');
// Dernier jour du mois de la période, uniquement si un acompte existe (décision validée le 26/10/2026)
const dateAcompte = (_v, row) => {
  if (vide(row.FILTRE_ANNEE) || vide(row.FILTRE_MOIS) || !(Number(row.Acompte) > 0)) return '';
  const a = Number(row.FILTRE_ANNEE), m = Number(row.FILTRE_MOIS);
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, '0')}-${String(dernier).padStart(2, '0')}T00:00:00`;
};
const periodeDePaie = (_v, row) => {
  if (vide(row.FILTRE_ANNEE) || vide(row.FILTRE_MOIS)) return '';
  return `${row.FILTRE_ANNEE}-${String(row.FILTRE_MOIS).padStart(2, '0')}-01T00:00:00`;
};
// « 03/10, 04/10 » (jour/mois, sans année) -> « 2026-10-03, 2026-10-04 » (année = année de la période)
const listeDates = (v, row) => {
  if (vide(v)) return '';
  return String(v).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(\d{2})\/(\d{2})$/.exec(s);
    return m && !vide(row.FILTRE_ANNEE) ? `${row.FILTRE_ANNEE}-${m[2]}-${m[1]}` : s;
  }).join(', ');
};
// Valeur CAE -> code Silae via la table de silae-codes.js ; code absent = « A_MAPPER:<valeur> » (bien visible)
const code = (table) => (v, _row, ctx) => {
  if (vide(v)) return '';
  const k = String(v).trim();
  const out = SILAE_CODES[table] && SILAE_CODES[table][k];
  if (out) return out;
  if (ctx) ctx.manquants.add(`${table} « ${k} »`);
  return `A_MAPPER:${k}`;
};
const secu = (v, _row, ctx) => {
  if (vide(v)) return '';
  const s = String(v).replace(/[\s.]/g, '');
  if (s.length !== 15 && ctx) ctx.alertes.add('numéro de sécurité sociale qui ne fait pas 15 caractères (13 + clé)');
  return s;
};
const departement = (v) => {
  if (vide(v)) return '';
  const s = String(v).trim().toUpperCase();
  return /^\d$/.test(s) ? `0${s}` : s.slice(0, 2);
};
const iban = (v) => (vide(v) ? '' : String(v).replace(/\s/g, '').toUpperCase().slice(0, 34));
const bic = (v) => (vide(v) ? '' : String(v).replace(/\s/g, '').toUpperCase().slice(0, 11));

const C_HEURES = 'SalarieAjouterHeures › nombreHeures (codeHeures : table `heures` de silae-codes.js)';
const C_EV = 'SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`)';
const C_ABS = 'SalarieAjouterAbsenceV2 › dureeEnHeuresSiJourUnique (codeAbsence : table `absencesPaie`)';
const C_ABS_DATES = 'SalarieAjouterAbsenceV2 › dateDebutAbsence / dateFinAbsence';

const FERIES = '1er janv., 1er mai, 8 mai, 14 juil., 15 août, 1er nov., 11 nov., 25 déc. + lundi de Pâques, Ascension, lundi de Pentecôte (dates recalculées chaque année de 2024 à 2040 dans la carte Metabase 290)';
const N2 = 'Nombre avec point, 2 décimales';
const DATE = 'Date AAAA-MM-JJ';
const MAT = 'Texte, 30 caractères max (zéros du début conservés)';
const LISTE = 'Dates AAAA-MM-JJ séparées par « , »';

// ---------------- Onglet « Export de paie » ----------------
const PAIE = [
  { col: 'FILTRE_MOIS', src: 'FILTRE_MOIS', silae: '— (colonne technique, non importée)', format: 'Texte, 2 chiffres', formule: 'Mois (01 à 12) de la date des lots pris en compte.', exemple: '10', conv: passer },
  { col: 'FILTRE_ANNEE', src: 'FILTRE_ANNEE', silae: '— (colonne technique, non importée)', format: 'Texte, 4 chiffres', formule: 'Année de la date des lots pris en compte.', exemple: '2026', conv: passer },
  { col: 'Période de paie', src: null, silae: 'periodeHeures / periodeElementVariable (période de paie)', format: 'Date-heure AAAA-MM-JJTHH:MM:SS (1er du mois, 00:00:00)', formule: 'Colonne ajoutée : 1er jour du mois et de l’année des deux colonnes précédentes.', exemple: '2026-10-01T00:00:00', conv: periodeDePaie },
  { col: 'Matricule', src: 'Matricule', silae: 'matriculeSalarie', format: MAT, formule: 'Matricule RH du salarié (dossier « informations RH »).', exemple: '02691', conv: texte(30) },
  { col: 'Codes analytiques', src: 'Codes analytiques', silae: 'affectation1 (axe analytique n°1)', format: 'Texte, 30 caractères max', formule: 'Code de la mission du contrat retenu (un seul contrat par salarié et par mission).', exemple: '26CRF24PAR', conv: texte(30) },
  { col: 'Nom', src: 'Nom', silae: 'nomNaissance', format: 'Texte, 50 caractères max', formule: 'Nom du salarié, en majuscules (accents conservés).', exemple: 'ABDEL AZIZ-FOUQUE', conv: texte(50) },
  { col: 'Prénom', src: 'Prénom', silae: 'prenom', format: 'Texte, 40 caractères max', formule: 'Prénom du salarié, première lettre de chaque mot en majuscule.', exemple: 'Emmanuel', conv: texte(40) },
  { col: 'Date d\'entrée', src: 'Date d\'entrée', silae: 'emplois[].dateDebut (et dateDebutContrat)', format: DATE, formule: 'Date de début du contrat retenu pour la mission.', exemple: '2026-09-07', conv: dateIso },
  { col: 'Intitulé de poste', src: 'Intitulé de poste', silae: 'emplois[].intituleEmploi', format: 'Texte, 120 caractères max', formule: 'Statut du contrat (RD, RE…). Si un avenant valide existe, c’est le statut de l’avenant le plus récent.', exemple: 'RE', conv: texte(120) },
  { col: 'Qualification', src: 'Qualification', silae: 'emplois[].codeStatutProfessionnel', format: 'Code à 2 chiffres : 29 = Cadre, 31 = ETAM (table `qualification`)', formule: 'IC si le statut commence par « RE », sinon ETAM ; puis converti en code Silae.', exemple: '29', conv: code('qualification') },
  { col: 'Coefficient 1', src: 'Position / coefficient', silae: 'emplois[].coefficient1', format: 'Texte, 15 caractères max', formule: 'Code « position / coefficient » : CDI avec statut RD/RDC/RDE = 1.3.2.240 ; CDD avec statut RE = 1.1.95 ; autre CDD = 1.2.240 ; sinon 1.3.2.240. Il est découpé en morceaux séparés par les points. Découpage validé le 26/10/2026.', exemple: '1', conv: coef(0) },
  { col: 'Coefficient 2', src: 'Position / coefficient', silae: 'emplois[].coefficient2', format: 'Texte, 15 caractères max', formule: 'Deuxième morceau du code ci-dessus.', exemple: '2', conv: coef(1) },
  { col: 'Coefficient 3', src: 'Position / coefficient', silae: 'emplois[].coefficient3', format: 'Texte, 15 caractères max', formule: 'Troisième morceau du code ci-dessus.', exemple: '240', conv: coef(2) },
  { col: 'Coefficient 4', src: 'Position / coefficient', silae: 'emplois[].coefficient4', format: 'Texte, 15 caractères max', formule: 'Quatrième morceau du code ci-dessus (vide pour les codes à 3 morceaux).', exemple: '', conv: coef(3) },
  { col: 'Salaire mensuel Brut', src: 'Salaire mensuel Brut', silae: 'Fiche emploi SEM_SalaireDeBase (nom exact du paramètre de CreationSalarieEmplois à confirmer)', format: N2, formule: 'Salaire mensuel brut du contrat retenu (0 si non renseigné).', exemple: '2704.00', conv: dec2 },
  { col: 'Heures non travaillées', src: 'Heures non travaillées', silae: C_HEURES, format: N2, formule: 'Durée de travail par semaine du contrat × 4,3334 (semaines par mois), moins les heures réellement travaillées du mois (heures rémunérées des lots où le recruteur était présent). Jamais négatif.', exemple: '85.00', conv: dec2 },
  { col: 'Dont heures complémentaires 25%', src: 'Dont heures complémentaires 25%', silae: C_HEURES, format: N2, formule: 'Chaque semaine : heures travaillées au-delà de la durée du contrat, dans la limite de 8 h. Total des semaines du mois.', exemple: '0.00', conv: dec2 },
  { col: 'Dont heures complémentaires 50%', src: 'Dont heures complémentaires 50%', silae: C_HEURES, format: N2, formule: 'Chaque semaine : heures travaillées au-delà de la durée du contrat + 8 h. Total des semaines du mois.', exemple: '0.00', conv: dec2 },
  { col: 'Dont heures jours fériés', src: 'Dont heures jours fériés', silae: C_HEURES, format: N2, formule: `Heures travaillées (recruteur présent) un jour férié. Jours fériés pris en compte : ${FERIES}`, exemple: '0.00', conv: dec2 },
  { col: 'Nombre de Conges payés', src: 'Nombre de Conges payés', silae: C_ABS, format: 'Nombre entier (heures)', formule: '7 h par jour de lot rattaché à une absence de type 300 (congés payés).', exemple: '14', conv: entier },
  { col: 'Dates de congés payés', src: 'Dates de congés payés', silae: C_ABS_DATES, format: LISTE, formule: 'Jours des absences de type 300 du mois. L’année est celle de la période (les jours/mois d’origine n’ont pas d’année).', exemple: '2026-10-03, 2026-10-04', conv: listeDates },
  { col: 'Nombre de Repos compensateur', src: 'Nombre de Repos compensateur', silae: C_ABS, format: 'Nombre entier (heures)', formule: '7 h par jour de lot rattaché à une absence de type 361.', exemple: '7', conv: entier },
  { col: 'Dates de repos compensateur', src: 'Dates de repos compensateur', silae: C_ABS_DATES, format: LISTE, formule: 'Jours des absences de type 361 du mois.', exemple: '2026-10-12', conv: listeDates },
  { col: 'Nombre de Repos compensateur Pénibilité', src: 'Nombre de Repos compensateur Pénibilité', silae: C_ABS, format: 'Nombre entier (heures)', formule: '7 h par jour de lot rattaché à une absence de type 360.', exemple: '7', conv: entier },
  { col: 'Dates de repos compensateur pénibilité', src: 'Dates de repos compensateur pénibilité', silae: C_ABS_DATES, format: LISTE, formule: 'Jours des absences de type 360 du mois.', exemple: '2026-10-19', conv: listeDates },
  { col: 'Nombre d\'heures arrêt maladie', src: 'Nombre d\'heures arrêt maladie', silae: C_ABS, format: 'Nombre entier (heures)', formule: '7 h par jour de lot rattaché à une absence de type 100 ou 105 (maladie).', exemple: '21', conv: entier },
  { col: 'Dates de l\'arrêt maladie', src: 'Dates de l\'arrêt maladie', silae: C_ABS_DATES, format: LISTE, formule: 'Jours des absences de type 100 ou 105 du mois.', exemple: '2026-10-05, 2026-10-06, 2026-10-07', conv: listeDates },
  { col: 'Prime transport', src: 'Prime transport', silae: C_EV, format: N2, formule: 'Pour chaque lot travaillé (heures rémunérées > 0), forfait transport de l’emplacement de la mission, que le recruteur soit présent ou non. Total du mois.', exemple: '35.20', conv: dec2 },
  { col: 'Prime conduite', src: 'Prime conduite', silae: C_EV, format: N2, formule: 'Pour chaque lot avec recruteur présent et heures de conduite > 0 : le plus grand de 10 € ou (heures de conduite × 10 €). Total du mois.', exemple: '20.00', conv: dec2 },
  { col: 'Prime RE', src: 'Prime RE', silae: C_EV, format: N2, formule: 'Total des éléments de paie « prime_re » dont la date d’effet tombe dans le mois.', exemple: '150.00', conv: dec2 },
  { col: 'Prime Exceptionnelle', src: 'Prime Exceptionnelle', silae: C_EV, format: N2, formule: 'Total des éléments de paie « prime_exceptionnelle » dont la date d’effet tombe dans le mois.', exemple: '100.00', conv: dec2 },
  { col: 'Mutuelle CDI', src: 'Mutuelle CDI', silae: 'Non couvert par les fonctions lues (contrat complémentaire / questionnaire) — valeur conservée telle quelle', format: 'OUI ou NON', formule: 'OUI si le contrat est marqué « mutuelle », sinon NON.', exemple: 'NON', conv: passer },
  { col: 'Versement santé CDD', src: 'Versement santé CDD', silae: 'Non couvert par les fonctions lues — valeur conservée telle quelle', format: 'OUI ou NON', formule: 'Toujours NON pour l’instant (valeur fixe de la requête).', exemple: 'NON', conv: passer },
  { col: 'Tickets restaurants', src: 'Tickets restaurants', silae: C_EV, format: 'Nombre entier (nombre de tickets)', formule: 'Nombre de lots avec recruteur présent et au moins 4 h rémunérées.', exemple: '12', conv: entier },
  { col: 'Indemnités grand déplacement', src: 'Indemnités grand déplacement', silae: C_EV, format: N2, formule: 'Si le salarié est hébergé (case du contrat) : nombre de jours de présence × 14 €. Sinon 0.', exemple: '0.00', conv: dec2 },
  { col: 'Acompte', src: 'Acompte', silae: 'SalarieAjouterAcompte › montantAcompte', format: N2, formule: 'Total des éléments de paie « acompte » du mois.', exemple: '200.00', conv: dec2 },
  { col: 'Date acompte', src: null, silae: 'SalarieAjouterAcompte › dateAcompte', format: 'Date-heure AAAA-MM-JJTHH:MM:SS (00:00:00)', formule: 'Colonne ajoutée : dernier jour du mois de la période, uniquement quand un acompte existe (sinon vide). Règle validée le 26/10/2026.', exemple: '2026-10-31T00:00:00', conv: dateAcompte },
  { col: 'Saisie/Arrêt', src: 'Saisie/Arrêt', silae: 'ModificationSaisieArret (fiche non consultée : paramètre à confirmer)', format: N2, formule: 'Total des éléments de paie « saisie_arret » du mois.', exemple: '0.00', conv: dec2 },
  { col: 'Remboursement transport', src: 'Remboursement transport', silae: C_EV, format: N2, formule: 'Toujours 0 pour l’instant (valeur fixe de la requête).', exemple: '0.00', conv: dec2 },
  { col: 'Fréquence Remboursement transport', src: 'Fréquence Remboursement transport', silae: '— (aucun paramètre correspondant lu)', format: 'Texte', formule: 'Toujours vide pour l’instant.', exemple: '', conv: passer },
  { col: 'Typologie avenant', src: 'Typologie avenant', silae: '— (information interne, non importée)', format: 'Texte', formule: 'Libellé du type du dernier avenant valide (signé, publié ou ignoré).', exemple: 'Avenant - Changement de durée et horaires', conv: passer },
  { col: 'Date effet avenant', src: 'Date effet avenant', silae: '— (information interne, non importée)', format: DATE, formule: 'Date de début du dernier avenant valide.', exemple: '2026-09-22', conv: dateIso },
  { col: 'Date de la fin de contrat', src: 'Date de la fin de contrat', silae: 'emplois[].dateFin', format: DATE, formule: 'Date de fin du contrat retenu.', exemple: '2026-10-24', conv: dateIso },
  { col: 'Motif de fin de contrat', src: 'Motif de fin de contrat', silae: 'emplois[].motifFinEmploi', format: 'Code à 3 chiffres (ex. 008 = fin de contrat de travail)', formule: 'Toujours vide pour l’instant : à alimenter dans la carte Metabase.', exemple: '008', conv: passer },
  { col: 'Observations sur la fin de contrat', src: 'Observations sur la fin de contrat', silae: '— (aucun paramètre correspondant lu)', format: 'Texte', formule: 'Toujours vide pour l’instant.', exemple: '', conv: passer },
  { col: 'Commentaires éventuels', src: 'Commentaires éventuels', silae: '— (aucun paramètre correspondant lu)', format: 'Texte', formule: 'Toujours vide pour l’instant.', exemple: '', conv: passer },
];

// ---------------- Onglet « Absences (export paie 2) » ----------------
const ABSENCES = [
  { col: 'code', src: 'code', silae: 'SalarieAjouterAbsenceV2 › codeAbsence', format: 'Code d’absence Silae du dossier (table `absences`)', formule: 'Code du type d’absence CAE, converti avec la table de correspondance. « A_MAPPER:xxx » = code Silae à renseigner.', exemple: 'CP', conv: code('absences') },
  { col: 'VALEUR', src: 'VALEUR', silae: 'SalarieAjouterAbsenceV2 › dureeEnHeuresSiJourUnique', format: 'Nombre avec point, 2 décimales, positif', formule: 'Durée de l’absence en minutes ÷ 60 = heures. Une valeur négative dans Metabase (ex. -8) est affichée en positif ; le sens (retenue) est porté par le code d’absence. Valable seulement si l’absence tient sur un seul jour.', exemple: '7.00', conv: positif2 },
  { col: 'fin', src: 'fin', silae: 'SalarieAjouterAbsenceV2 › dateFinAbsence', format: 'Date-heure AAAA-MM-JJTHH:MM:SS (00:00:00)', formule: 'Dernier jour de l’absence.', exemple: '2026-09-24T00:00:00', conv: dateHeure },
  { col: 'debut', src: 'debut', silae: 'SalarieAjouterAbsenceV2 › dateDebutAbsence', format: 'Date-heure AAAA-MM-JJTHH:MM:SS (00:00:00)', formule: 'Premier jour de l’absence.', exemple: '2026-09-24T00:00:00', conv: dateHeure },
  { col: 'libelle', src: 'libelle', silae: 'SalarieAjouterAbsenceV2 › commentaire', format: 'Texte', formule: 'Libellé du type d’absence CAE (sert de commentaire dans Silae).', exemple: 'Absence non rémunérée (autorisée)', conv: texte(255) },
  { col: 'matricule', src: 'matricule', silae: 'matriculeSalarie', format: MAT, formule: 'Matricule RH du salarié.', exemple: '00858', conv: texte(30) },
];

// ---------------- Onglet « Export DPAE » ----------------
const DPAE = [
  { col: 'DPAE MATRICULE', src: 'DPAE MATRICULE', silae: 'matriculeSalarie', format: MAT, formule: 'Matricule RH du salarié.', exemple: '02691', conv: texte(30) },
  { col: 'CIVILITE', src: 'CIVILITE', silae: 'civilite', format: 'Entier : 1 = Monsieur, 2 = Madame', formule: '1 si la civilité est « Monsieur », sinon 2.', exemple: '1', conv: passer },
  { col: 'CODE ANALYTIQUE', src: 'CODE ANALYTIQUE', silae: 'affectation1', format: 'Texte, 30 caractères max', formule: 'Code de la mission du contrat.', exemple: '26CRF24PAR', conv: texte(30) },
  { col: 'NOM', src: 'NOM', silae: 'nomNaissance', format: 'Texte, 50 caractères max', formule: 'Nom en majuscules.', exemple: 'ABDEL AZIZ-FOUQUE', conv: texte(50) },
  { col: 'PRENOM', src: 'PRENOM', silae: 'prenom', format: 'Texte, 40 caractères max', formule: 'Prénom, première lettre de chaque mot en majuscule.', exemple: 'Emmanuel', conv: texte(40) },
  { col: 'SECURITE SOCIALE', src: 'SECURITE SOCIALE', silae: 'numeroSecuriteSociale', format: '15 caractères exactement (13 chiffres + clé de 2), sans espace', formule: 'Numéro de sécurité sociale saisi par le salarié, espaces et points retirés. Une alerte s’affiche si la longueur n’est pas 15.', exemple: '189057501234567', conv: secu },
  { col: 'DATE DE NAISSANCE', src: 'DATE DE NAISSANCE', silae: 'dateNaissance', format: DATE, formule: 'Date de naissance saisie par le salarié.', exemple: '1989-05-14', conv: dateFr },
  { col: 'LIEU DE NAISSANCE', src: 'LIEU DE NAISSANCE', silae: 'communeNaissance', format: 'Texte, 32 caractères max', formule: 'Ville de naissance saisie par le salarié.', exemple: 'Paris', conv: texte(32) },
  { col: 'DEPT NAISSANCE', src: 'DEPT NAISSANCE', silae: 'departementNaissance', format: 'Texte, 2 caractères (01 à 95, 2A, 2B, 99 = étranger)', formule: '99 si le pays de naissance n’est pas la France, sinon le département saisi (complété par un 0 devant s’il n’a qu’un chiffre).', exemple: '75', conv: departement },
  { col: 'CODE NAISSANCE', src: 'CODE NAISSANCE', silae: 'codePaysNaissance', format: 'Code pays ISO sur 2 lettres', formule: 'Pays de naissance saisi, reconnu dans une liste de pays (vide si non reconnu).', exemple: 'FR', conv: texte(2) },
  { col: 'PAYS NAISSANCE', src: 'PAYS NAISSANCE', silae: 'paysNaissance', format: 'Texte, 38 caractères max, majuscules sans accent', formule: 'Nom du pays correspondant au code ci-dessus.', exemple: 'FRANCE', conv: texte(38) },
  { col: 'CODE NATIONALITE', src: 'CODE NATIONALITE', silae: 'codePaysNationalite', format: 'Code pays ISO sur 2 lettres', formule: 'Nationalité saisie, reconnue dans une liste de pays.', exemple: 'FR', conv: texte(2) },
  { col: 'NATIONALITE', src: 'NATIONALITE', silae: '— (Silae attend le NOM DU PAYS dans paysNationalite ; cette colonne contient l’adjectif, le code ci-dessus suffit : colonne non importée)', format: 'Texte', formule: 'Adjectif de nationalité (FRANCAISE, MAROCAINE…).', exemple: 'FRANCAISE', conv: passer },
  { col: 'N°VOIE', src: 'N°VOIE', silae: 'numVoie', format: 'Texte, 4 caractères max', formule: 'Premier mot de l’adresse s’il commence par un chiffre.', exemple: '12', conv: texte(4) },
  { col: 'Bis Ter Quart..', src: 'Bis Ter Quart..', silae: 'btqc', format: 'Texte (BIS, TER, QUATER…)', formule: 'Toujours vide pour l’instant.', exemple: '', conv: passer },
  { col: 'NOM DE LA VOIE', src: 'NOM DE LA VOIE', silae: 'nomVoie', format: 'Texte, 32 caractères max', formule: 'Adresse saisie, sans le numéro du début.', exemple: 'rue de la Paix', conv: texte(32) },
  { col: 'COMPLEMENT', src: 'COMPLEMENT', silae: 'complement', format: 'Texte, 38 caractères max', formule: 'Toujours vide pour l’instant.', exemple: '', conv: texte(38) },
  { col: 'CODE POSTAL', src: 'CODE POSTAL', silae: 'codePostal', format: 'Texte, 5 caractères', formule: 'Code postal saisi par le salarié.', exemple: '75002', conv: texte(5) },
  { col: 'VILLE', src: 'VILLE', silae: 'nomVille', format: 'Texte, 32 caractères max', formule: 'Ville saisie par le salarié.', exemple: 'Paris', conv: texte(32) },
  { col: 'CODE PAYS', src: 'CODE PAYS', silae: 'codePays', format: 'Code pays ISO sur 2 lettres', formule: 'Toujours FR pour l’instant.', exemple: 'FR', conv: passer },
  { col: 'EMAIL', src: 'EMAIL', silae: 'eMail', format: 'Texte, 60 caractères max', formule: 'E-mail du compte du salarié.', exemple: 'prenom.nom@exemple.fr', conv: texte(60) },
  { col: 'PREMIERE MISSION CAE', src: 'PREMIERE MISSION CAE', silae: '— (information interne, non importée)', format: 'OUI ou NON', formule: 'NON si la mission a démarré plus de 5 jours avant ou après le contrat, sinon OUI.', exemple: 'OUI', conv: passer },
  { col: 'FONCTION', src: 'FONCTION', silae: 'emplois[].intituleEmploi', format: 'Texte, 120 caractères max', formule: 'Statut du type de contrat (RD, RE…).', exemple: 'RE', conv: texte(120) },
  { col: 'QUALIFICATION', src: 'QUALIFICATION', silae: 'emplois[].codeStatutProfessionnel', format: 'Code à 2 chiffres : 29 = Cadre, 31 = ETAM (table `qualification`)', formule: 'IC si le statut du contrat commence par « RE », sinon ETAM ; puis converti en code Silae.', exemple: '29', conv: code('qualification') },
  { col: 'POSITION/COEFFICIENT', src: 'POSITION/COEFFICIENT', silae: 'emplois[].coefficient1 à coefficient4', format: 'Texte découpé par les points', formule: 'Même règle que dans l’onglet paie. Colonne conservée sous forme de code ; à découper en coefficient1..4 à l’import.', exemple: '1.2.240', conv: passer },
  { col: 'HEURES / SEM', src: 'HEURES / SEM', silae: 'Horaires de l’emploi (fiche emploi : SEM_HoraireMensuel, SEM_HT…) — paramètre exact à confirmer', format: 'Nombre entier (heures par semaine)', formule: 'Durée de travail par semaine du type de contrat.', exemple: '20', conv: entier },
  { col: 'SEMAINE', src: 'SEMAINE', silae: '— (planning interne, non importé)', format: 'Texte', formule: '« Lundi/vendredi » si la mission travaille le lundi, sinon « Mardi/samedi ».', exemple: 'Mardi/samedi', conv: passer },
  { col: 'JOURS OFF', src: 'JOURS OFF', silae: '— (planning interne, non importé)', format: 'Texte', formule: 'Jours de la mission que le salarié ne travaille pas (lun, mar…). Vide s’il travaille tous les jours de la mission.', exemple: 'lun mer', conv: passer },
  { col: 'REMUNERATION HORAIRE BRUTE', src: 'REMUNERATION HORAIRE BRUTE', silae: 'Rémunération de l’emploi (fiche emploi SEM_SalaireDeBase avec SEM_TypeSalaireDeBase « horaire ») — paramètre exact à confirmer', format: N2, formule: 'Salaire horaire brut du contrat.', exemple: '12.50', conv: dec2 },
  { col: 'TYPE DE CONTRAT', src: 'TYPE DE CONTRAT', silae: 'emplois[].codeContratTravail', format: 'Code à 2 chiffres : 01 = CDI, 02 = CDD (table `typeContrat`)', formule: 'Type du contrat en majuscules (CDI / CDD), converti en code Silae.', exemple: '02', conv: code('typeContrat') },
  { col: 'MOTIF RECOURS AU CDD', src: 'MOTIF RECOURS AU CDD', silae: 'emplois[].motifCDD', format: 'Code à 2 chiffres (03 = CDD d’usage)', formule: 'Toujours 03 (CDD d’usage) : valeur fixe de la requête.', exemple: '03', conv: passer },
  { col: 'DATE DEBUT CONTRAT', src: 'DATE DEBUT CONTRAT', silae: 'emplois[].dateDebutContrat (et dateDebut)', format: DATE, formule: 'Date de début du contrat signé.', exemple: '2026-09-07', conv: dateFr },
  { col: 'DATE FIN CONTRAT', src: 'DATE FIN CONTRAT', silae: 'emplois[].dateFin', format: DATE, formule: 'Date de fin du contrat signé.', exemple: '2026-10-16', conv: dateFr },
  { col: 'ETABLISSEMENT', src: 'ETABLISSEMENT', silae: 'emplois[].nomInterneEtablissement', format: 'Texte : nom interne de l’établissement dans Silae', formule: 'Établissement de la mission. Doit être identique au nom interne saisi dans Silae.', exemple: 'Siège', conv: passer },
  { col: 'MUTUELLE CDI', src: 'MUTUELLE CDI', silae: 'Non couvert par les fonctions lues — valeur conservée telle quelle', format: 'OUI ou NON', formule: 'OUI si le contrat est marqué « mutuelle », sinon NON.', exemple: 'NON', conv: passer },
  { col: 'VERSEMENT SANTE CDD', src: 'VERSEMENT SANTE CDD', silae: 'Non couvert par les fonctions lues — valeur conservée telle quelle', format: 'OUI ou NON', formule: 'Toujours NON pour l’instant.', exemple: 'NON', conv: passer },
  { col: 'SITUATION FAMILIALE', src: 'SITUATION FAMILIALE', silae: 'situationFamiliale', format: 'Entier : 10 célibataire, 20 vie maritale, 30 pacsé, 40 marié, 50 séparé, 60 divorcé, 70 veuf, 0 vide (table `situationFamiliale`)', formule: 'Situation saisie par le salarié, convertie en code. « Pacsé ou en concubinage » = 30 (à confirmer).', exemple: '10', conv: code('situationFamiliale') },
  { col: 'NB ENFANTS A CHARGE', src: 'NB ENFANTS A CHARGE', silae: 'nbPersACharge', format: 'Nombre entier', formule: 'Nombre d’enfants à charge saisi par le salarié.', exemple: '2', conv: entier },
  { col: 'MODE DE PAIEMENT', src: 'MODE DE PAIEMENT', silae: '— (aucun paramètre correspondant : voir ribPourVirements)', format: 'Texte', formule: 'Toujours « virement ».', exemple: 'virement', conv: passer },
  { col: 'IBAN', src: 'IBAN', silae: 'iBan', format: 'Texte, 34 caractères max, sans espace, majuscules', formule: 'IBAN saisi par le salarié.', exemple: 'FR7612345678901234567890123', conv: iban },
  { col: 'SWIFT', src: 'SWIFT', silae: 'bic', format: 'Texte, 11 caractères max, sans espace, majuscules', formule: 'BIC/SWIFT saisi par le salarié.', exemple: 'BNPAFRPP', conv: bic },
];

export const SPECS = {
  paie: { 'Export de paie': PAIE, 'Absences (export paie 2)': ABSENCES },
  dpae: { 'Export DPAE': DPAE },
};

// Convertit les lignes d'une carte au format Silae. ctx recueille ce qui reste à traiter.
export function formatSilae(tabKey, cardTitle, rows, ctx) {
  const spec = SPECS[tabKey] && SPECS[tabKey][cardTitle];
  if (!spec || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const out = {};
    for (const s of spec) out[s.col] = s.conv(s.src == null ? undefined : row[s.src], row, ctx);
    return out;
  });
}

export function newSilaeContext() {
  return { manquants: new Set(), alertes: new Set() };
}

export function silaeNote(ctx) {
  const parts = [];
  if (ctx.manquants.size) {
    parts.push(`Codes Silae à renseigner dans src/lib/silae-codes.js (affichés « A_MAPPER:… ») : ${[...ctx.manquants].join(', ')}.`);
  }
  if (ctx.alertes.size) parts.push(`Alertes : ${[...ctx.alertes].join(' ; ')}.`);
  return parts.join(' ');
}
