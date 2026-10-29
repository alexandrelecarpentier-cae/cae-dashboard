// ---------------------------------------------------------------
// Table de correspondance CAE -> Silae pour l'export /rh-export.
// Une valeur vide ('') = code Silae PAS ENCORE RENSEIGNÉ : l'export affiche
// alors "A_MAPPER:<valeur CAE>" pour que l'oubli se voie (Silae refusera la
// ligne au lieu d'enregistrer un mauvais code).
// Les codes dépendent du paramétrage du dossier de paie dans Silae : ils sont
// à relever dans Silae (menu des codes d'absence, des éléments variables, des
// types d'heures) puis à coller ici. Après modification : relancer
// `node scripts/generer-doc-silae.mjs` pour mettre à jour EXPORT-SILAE.md.
// ---------------------------------------------------------------
export const SILAE_CODES = {
  // Onglet « Absences » : code du type d'absence CAE -> codeAbsence Silae
  // (SalarieAjouterAbsenceV2). Libellés CAE donnés à titre d'aide.
  absences: {
    '300': '', // Congés payés
    '100': '', // Maladie
    '105': '', // Maladie
    '361': '', // Repos compensateur
    '360': '', // Repos compensateur pénibilité
    '630': '', // Absence non rémunérée (non autorisée)
    '620': '', // Absence non rémunérée (autorisée)
    '1': '',   // Absence non rémunérée (autorisée) — libellé « Logo »
    '000': '', // Retard
  },

  // Onglet « Export de paie » : une colonne CAE = un code Silae.
  // heures -> SalarieAjouterHeures (codeHeures)
  heures: {
    'Heures non travaillées': '',
    'Dont heures complémentaires 25%': '',
    'Dont heures complémentaires 50%': '',
    'Dont heures jours fériés': '',
  },
  // éléments variables -> SalarieAjouterElementVariable (codeElementVariable)
  elementsVariables: {
    'Prime transport': '',
    'Prime conduite': '',
    'Prime RE': '',
    'Prime Exceptionnelle': '',
    'Tickets restaurants': '',
    'Indemnités grand déplacement': '',
    'Remboursement transport': '',
  },
  // absences résumées dans l'onglet paie -> SalarieAjouterAbsenceV2 (codeAbsence)
  absencesPaie: {
    'Nombre de Conges payés': '',
    'Nombre de Repos compensateur': '',
    'Nombre de Repos compensateur Pénibilité': '',
    "Nombre d'heures arrêt maladie": '',
  },

  // Valeurs fournies par la doc Silae (codes DSN standard) — à confirmer.
  // Qualification CAE -> codeStatutProfessionnel (Cadre = 29, ETAM = 31)
  qualification: { IC: '29', ETAM: '31' },
  // Type de contrat CAE -> codeContratTravail (01 = CDI, 02 = CDD)
  typeContrat: { CDI: '01', CDD: '02' },
  // Situation familiale CAE -> situationFamiliale
  // (« Pacsé ou en concubinage » : Silae distingue 20 vie maritale / 30 pacsé -> à confirmer)
  situationFamiliale: {
    'Célibataire': '10',
    'Marié': '40',
    'Pacsé ou en concubinage': '30',
    'Séparé': '50',
    'Divorcé': '60',
    'Veuf': '70',
    'Inconnu': '0',
  },
};
