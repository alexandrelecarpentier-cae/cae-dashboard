// Génère EXPORT-SILAE.md depuis src/lib/silae-format.js (SPECS) et src/lib/silae-codes.js.
// Usage : node scripts/generer-doc-silae.mjs
import { writeFileSync } from 'node:fs';
import { SPECS } from '../src/lib/silae-format.js';
import { SILAE_CODES } from '../src/lib/silae-codes.js';

const cell = (s) => String(s == null || s === '' ? '—' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const ex = (s) => (s === '' ? '*(vide)*' : '`' + String(s).replace(/\|/g, '\\|') + '`');

const ONGLETS = [
  ['paie', 'Export de paie', 'Onglet « Export de paie » — carte Metabase 290', 'Une ligne par salarié, par mission et par mois.'],
  ['paie', 'Absences (export paie 2)', 'Onglet « Export de paie » — tableau « Absences (export paie 2) » — carte Metabase 540', 'Une ligne par jour d’absence et par salarié.'],
  ['dpae', 'Export DPAE', 'Onglet « Export DPAE » — carte Metabase 384', 'Une ligne par salarié et par contrat signé.'],
];

let md = `# Export Silae — documentation de \`/rh-export\`

> Généré par \`node scripts/generer-doc-silae.mjs\` à partir de \`src/lib/silae-format.js\` et \`src/lib/silae-codes.js\`. Ne pas modifier à la main : modifier ces fichiers puis relancer le script.

## Principe

- Les colonnes de \`/rh-export\` restent celles des cartes Metabase (deux colonnes ajoutées : « Période de paie » et « Date acompte » ; « Position / coefficient » découpée en 4 colonnes). Seules les **valeurs** sont converties au format attendu par Silae (dates, nombres, codes).
- Référence : documentation de l’API REST Silae Paie (https://silae-api.document360.io), lue le 26/10/2026.
- ⚠ Cette documentation décrit uniquement des **appels API (JSON)**. Elle ne décrit aucun fichier d’import manuel. Le CSV / Excel exporté reprend donc les noms de paramètres de l’API comme repère (colonne « Paramètre Silae »), avec les formats de l’API.
- Colonne « Paramètre Silae » : \`fonction › paramètre\`. \`emplois[].xxx\` = paramètre de la liste \`emplois\` de la fonction \`CreationSalarieEmplois\`. Une valeur « — » = pas de paramètre correspondant (colonne conservée pour information).
- Dans les exports, une valeur \`A_MAPPER:xxx\` signale un code Silae à renseigner dans \`src/lib/silae-codes.js\` (voir « Table de correspondance »).

## Fonctions Silae concernées

| Besoin | Fonction API | Paramètres principaux |
|---|---|---|
| Créer / modifier le salarié et son contrat | \`/v1/SalarieEmplois/CreationSalarieEmplois\` | matriculeSalarie, nomNaissance, prenom, numeroSecuriteSociale, dateNaissance, emplois[] (dateDebut, dateFin, codeContratTravail, motifCDD…) |
| Ajouter des heures | \`/v1/ActivitesEtHeures/SalarieAjouterHeures\` | periodeHeures, codeHeures, nombreHeures, ajouter |
| Ajouter un élément variable (prime déjà paramétrée) | \`/v1/ElementsVariables/SalarieAjouterElementVariable\` | periodeElementVariable, codeElementVariable, montantElementVariable |
| Ajouter une absence | \`/v1/Absences/SalarieAjouterAbsenceV2\` | dateDebutAbsence, dateFinAbsence, codeAbsence, dureeEnHeuresSiJourUnique, commentaire |
| Ajouter un acompte | \`/v1/ElementsVariables/SalarieAjouterAcompte\` | dateAcompte, montantAcompte, libelleAcompte |

`;

for (const [tab, titre, h, desc] of ONGLETS) {
  const spec = SPECS[tab][titre];
  md += `## ${h}\n\n${desc}\n\n| Colonne | Paramètre Silae | Format attendu par Silae | Formule de calcul | Exemple |\n|---|---|---|---|---|\n`;
  for (const s of spec) md += `| ${cell(s.col)} | ${cell(s.silae)} | ${cell(s.format)} | ${cell(s.formule)} | ${ex(s.exemple)} |\n`;
  md += '\n';
}

md += `## Table de correspondance CAE → Silae (\`src/lib/silae-codes.js\`)

Les codes marqués **À RENSEIGNER** dépendent du paramétrage du dossier de paie dans Silae et ne figurent pas dans la documentation.

`;
for (const [nom, table] of Object.entries(SILAE_CODES)) {
  md += `### \`${nom}\`\n\n| Valeur CAE | Code Silae |\n|---|---|\n`;
  for (const [k, v] of Object.entries(table)) md += `| ${cell(k)} | ${v ? '`' + v + '`' : '**À RENSEIGNER**'} |\n`;
  md += '\n';
}

md += `## Points d’attention

1. **Format de fichier** : CSV séparé par des points-virgules (UTF-8 avec BOM), décimales avec un point. L’export Excel (.xlsx) est aussi disponible. La doc Silae ne décrit que l’API REST : si vous importez à la main dans Silae, il faudra peut-être renommer les colonnes selon le modèle d’import de Silae.
2. **Un appel API par donnée** : les colonnes d’heures, de primes et d’absences de l’onglet paie sont « une colonne = un code Silae ». Pour l’API, chaque valeur non nulle devient un appel avec son code (table de correspondance ci-dessus).
3. **Acompte** : Silae exige une \`dateAcompte\`. Elle est ajoutée par l’export : dernier jour du mois de la période, uniquement quand un acompte existe.
4. **Absences** :
   - Préférer le tableau « Absences (export paie 2) » (vraies dates de début et de fin) aux colonnes « Dates de… » de l’export de paie, qui sont recalculées à partir de jours/mois sans année.
   - \`dureeEnHeuresSiJourUnique\` n’est valable que pour une absence sur un seul jour (une ligne = un jour ici).
   - Le sens des valeurs négatives (ex. -8 pour le code 630) est perdu : à porter par le code d’absence Silae.
5. **Jours fériés** : calculés dans la carte Metabase 290 (fériés fixes + lundi de Pâques, Ascension et lundi de Pentecôte, de 2024 à 2040). Corrigé le 26/10/2026 ; l’ancienne liste, fixée à 2026, n’avait pas le lundi de Pentecôte. Au-delà de 2040, étendre la plage d’années dans la carte.
6. **Coefficients** : le code « 1.2.240 » est découpé en coefficient1 à 4 (découpage validé le 26/10/2026).
7. **Paramètres non vérifiés** (pages non consultées ou tronquées) : nom exact du salaire de base et des horaires dans \`CreationSalarieEmplois\`, \`ModificationSaisieArret\`, mutuelle / contrat complémentaire.
8. **DPAE** : l’API n’a pas de fonction « envoyer une DPAE » seule. Le paramètre \`envoiDUEEdi\` de \`CreationSalarieEmplois\` déclenche l’envoi d’une DUE en EDI. \`SalarieRecupererRecuDPAE\` existe aussi (fiche non lue, probablement la récupération du reçu).
9. **Matricule** : le CSV ouvert dans Excel supprime les zéros du début (\`02691\` devient \`2691\`). L’export Excel (.xlsx) les conserve.
10. **Données personnelles** : cet export contient numéro de sécurité sociale et IBAN, et le Worker n’a aucune authentification (voir \`CONTEXTE-PROJET.md\`).
`;

writeFileSync(new URL('../EXPORT-SILAE.md', import.meta.url), md);
console.log('EXPORT-SILAE.md généré :', md.length, 'caractères');
