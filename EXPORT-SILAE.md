# Export Silae — documentation de `/rh-export`

> Généré par `node scripts/generer-doc-silae.mjs` à partir de `src/lib/silae-format.js` et `src/lib/silae-codes.js`. Ne pas modifier à la main : modifier ces fichiers puis relancer le script.

## Principe

- Les colonnes de `/rh-export` restent celles des cartes Metabase (deux colonnes ajoutées : « Période de paie » et « Date acompte » ; « Position / coefficient » découpée en 4 colonnes). Seules les **valeurs** sont converties au format attendu par Silae (dates, nombres, codes).
- Référence : documentation de l’API REST Silae Paie (https://silae-api.document360.io), lue le 26/10/2026.
- ⚠ Cette documentation décrit uniquement des **appels API (JSON)**. Elle ne décrit aucun fichier d’import manuel. Le CSV / Excel exporté reprend donc les noms de paramètres de l’API comme repère (colonne « Paramètre Silae »), avec les formats de l’API.
- Colonne « Paramètre Silae » : `fonction › paramètre`. `emplois[].xxx` = paramètre de la liste `emplois` de la fonction `CreationSalarieEmplois`. Une valeur « — » = pas de paramètre correspondant (colonne conservée pour information).
- Dans les exports, une valeur `A_MAPPER:xxx` signale un code Silae à renseigner dans `src/lib/silae-codes.js` (voir « Table de correspondance »).

## Fonctions Silae concernées

| Besoin | Fonction API | Paramètres principaux |
|---|---|---|
| Créer / modifier le salarié et son contrat | `/v1/SalarieEmplois/CreationSalarieEmplois` | matriculeSalarie, nomNaissance, prenom, numeroSecuriteSociale, dateNaissance, emplois[] (dateDebut, dateFin, codeContratTravail, motifCDD…) |
| Ajouter des heures | `/v1/ActivitesEtHeures/SalarieAjouterHeures` | periodeHeures, codeHeures, nombreHeures, ajouter |
| Ajouter un élément variable (prime déjà paramétrée) | `/v1/ElementsVariables/SalarieAjouterElementVariable` | periodeElementVariable, codeElementVariable, montantElementVariable |
| Ajouter une absence | `/v1/Absences/SalarieAjouterAbsenceV2` | dateDebutAbsence, dateFinAbsence, codeAbsence, dureeEnHeuresSiJourUnique, commentaire |
| Ajouter un acompte | `/v1/ElementsVariables/SalarieAjouterAcompte` | dateAcompte, montantAcompte, libelleAcompte |

## Onglet « Export de paie » — carte Metabase 290

Une ligne par salarié, par mission et par mois.

| Colonne | Paramètre Silae | Format attendu par Silae | Formule de calcul | Exemple |
|---|---|---|---|---|
| FILTRE_MOIS | — (colonne technique, non importée) | Texte, 2 chiffres | Mois (01 à 12) de la date des lots pris en compte. | `10` |
| FILTRE_ANNEE | — (colonne technique, non importée) | Texte, 4 chiffres | Année de la date des lots pris en compte. | `2026` |
| Période de paie | periodeHeures / periodeElementVariable (période de paie) | Date-heure AAAA-MM-JJTHH:MM:SS (1er du mois, 00:00:00) | Colonne ajoutée : 1er jour du mois et de l’année des deux colonnes précédentes. | `2026-10-01T00:00:00` |
| Matricule | matriculeSalarie | Texte, 30 caractères max (zéros du début conservés) | Matricule RH du salarié (dossier « informations RH »). | `02691` |
| Codes analytiques | affectation1 (axe analytique n°1) | Texte, 30 caractères max | Code de la mission du contrat retenu (un seul contrat par salarié et par mission). | `26CRF24PAR` |
| Nom | nomNaissance | Texte, 50 caractères max | Nom du salarié, en majuscules (accents conservés). | `ABDEL AZIZ-FOUQUE` |
| Prénom | prenom | Texte, 40 caractères max | Prénom du salarié, première lettre de chaque mot en majuscule. | `Emmanuel` |
| Date d'entrée | emplois[].dateDebut (et dateDebutContrat) | Date AAAA-MM-JJ | Date de début du contrat retenu pour la mission. | `2026-09-07` |
| Intitulé de poste | emplois[].intituleEmploi | Texte, 120 caractères max | Statut du contrat (RD, RE…). Si un avenant valide existe, c’est le statut de l’avenant le plus récent. | `RE` |
| Qualification | emplois[].codeStatutProfessionnel | Code à 2 chiffres : 29 = Cadre, 31 = ETAM (table `qualification`) | IC si le statut commence par « RE », sinon ETAM ; puis converti en code Silae. | `29` |
| Coefficient 1 | emplois[].coefficient1 | Texte, 15 caractères max | Code « position / coefficient » : CDI avec statut RD/RDC/RDE = 1.3.2.240 ; CDD avec statut RE = 1.1.95 ; autre CDD = 1.2.240 ; sinon 1.3.2.240. Il est découpé en morceaux séparés par les points. Découpage validé le 26/10/2026. | `1` |
| Coefficient 2 | emplois[].coefficient2 | Texte, 15 caractères max | Deuxième morceau du code ci-dessus. | `2` |
| Coefficient 3 | emplois[].coefficient3 | Texte, 15 caractères max | Troisième morceau du code ci-dessus. | `240` |
| Coefficient 4 | emplois[].coefficient4 | Texte, 15 caractères max | Quatrième morceau du code ci-dessus (vide pour les codes à 3 morceaux). | *(vide)* |
| Salaire mensuel Brut | Fiche emploi SEM_SalaireDeBase (nom exact du paramètre de CreationSalarieEmplois à confirmer) | Nombre avec point, 2 décimales | Salaire mensuel brut du contrat retenu (0 si non renseigné). | `2704.00` |
| Heures non travaillées | SalarieAjouterHeures › nombreHeures (codeHeures : table `heures` de silae-codes.js) | Nombre avec point, 2 décimales | Durée de travail par semaine du contrat × 4,3334 (semaines par mois), moins les heures réellement travaillées du mois (heures rémunérées des lots où le recruteur était présent). Jamais négatif. | `85.00` |
| Dont heures complémentaires 25% | SalarieAjouterHeures › nombreHeures (codeHeures : table `heures` de silae-codes.js) | Nombre avec point, 2 décimales | Chaque semaine : heures travaillées au-delà de la durée du contrat, dans la limite de 8 h. Total des semaines du mois. | `0.00` |
| Dont heures complémentaires 50% | SalarieAjouterHeures › nombreHeures (codeHeures : table `heures` de silae-codes.js) | Nombre avec point, 2 décimales | Chaque semaine : heures travaillées au-delà de la durée du contrat + 8 h. Total des semaines du mois. | `0.00` |
| Dont heures jours fériés | SalarieAjouterHeures › nombreHeures (codeHeures : table `heures` de silae-codes.js) | Nombre avec point, 2 décimales | Heures travaillées (recruteur présent) un jour férié. Jours fériés pris en compte : 1er janv., 1er mai, 8 mai, 14 juil., 15 août, 1er nov., 11 nov., 25 déc. + lundi de Pâques, Ascension, lundi de Pentecôte (dates recalculées chaque année de 2024 à 2040 dans la carte Metabase 290) | `0.00` |
| Nombre de Conges payés | SalarieAjouterAbsenceV2 › dureeEnHeuresSiJourUnique (codeAbsence : table `absencesPaie`) | Nombre entier (heures) | 7 h par jour de lot rattaché à une absence de type 300 (congés payés). | `14` |
| Dates de congés payés | SalarieAjouterAbsenceV2 › dateDebutAbsence / dateFinAbsence | Dates AAAA-MM-JJ séparées par « , » | Jours des absences de type 300 du mois. L’année est celle de la période (les jours/mois d’origine n’ont pas d’année). | `2026-10-03, 2026-10-04` |
| Nombre de Repos compensateur | SalarieAjouterAbsenceV2 › dureeEnHeuresSiJourUnique (codeAbsence : table `absencesPaie`) | Nombre entier (heures) | 7 h par jour de lot rattaché à une absence de type 361. | `7` |
| Dates de repos compensateur | SalarieAjouterAbsenceV2 › dateDebutAbsence / dateFinAbsence | Dates AAAA-MM-JJ séparées par « , » | Jours des absences de type 361 du mois. | `2026-10-12` |
| Nombre de Repos compensateur Pénibilité | SalarieAjouterAbsenceV2 › dureeEnHeuresSiJourUnique (codeAbsence : table `absencesPaie`) | Nombre entier (heures) | 7 h par jour de lot rattaché à une absence de type 360. | `7` |
| Dates de repos compensateur pénibilité | SalarieAjouterAbsenceV2 › dateDebutAbsence / dateFinAbsence | Dates AAAA-MM-JJ séparées par « , » | Jours des absences de type 360 du mois. | `2026-10-19` |
| Nombre d'heures arrêt maladie | SalarieAjouterAbsenceV2 › dureeEnHeuresSiJourUnique (codeAbsence : table `absencesPaie`) | Nombre entier (heures) | 7 h par jour de lot rattaché à une absence de type 100 ou 105 (maladie). | `21` |
| Dates de l'arrêt maladie | SalarieAjouterAbsenceV2 › dateDebutAbsence / dateFinAbsence | Dates AAAA-MM-JJ séparées par « , » | Jours des absences de type 100 ou 105 du mois. | `2026-10-05, 2026-10-06, 2026-10-07` |
| Prime transport | SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`) | Nombre avec point, 2 décimales | Pour chaque lot travaillé (heures rémunérées > 0), forfait transport de l’emplacement de la mission, que le recruteur soit présent ou non. Total du mois. | `35.20` |
| Prime conduite | SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`) | Nombre avec point, 2 décimales | Pour chaque lot avec recruteur présent et heures de conduite > 0 : le plus grand de 10 € ou (heures de conduite × 10 €). Total du mois. | `20.00` |
| Prime RE | SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`) | Nombre avec point, 2 décimales | Total des éléments de paie « prime_re » dont la date d’effet tombe dans le mois. | `150.00` |
| Prime Exceptionnelle | SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`) | Nombre avec point, 2 décimales | Total des éléments de paie « prime_exceptionnelle » dont la date d’effet tombe dans le mois. | `100.00` |
| Mutuelle CDI | Non couvert par les fonctions lues (contrat complémentaire / questionnaire) — valeur conservée telle quelle | OUI ou NON | OUI si le contrat est marqué « mutuelle », sinon NON. | `NON` |
| Versement santé CDD | Non couvert par les fonctions lues — valeur conservée telle quelle | OUI ou NON | Toujours NON pour l’instant (valeur fixe de la requête). | `NON` |
| Tickets restaurants | SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`) | Nombre entier (nombre de tickets) | Nombre de lots avec recruteur présent et au moins 4 h rémunérées. | `12` |
| Indemnités grand déplacement | SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`) | Nombre avec point, 2 décimales | Si le salarié est hébergé (case du contrat) : nombre de jours de présence × 14 €. Sinon 0. | `0.00` |
| Acompte | SalarieAjouterAcompte › montantAcompte | Nombre avec point, 2 décimales | Total des éléments de paie « acompte » du mois. | `200.00` |
| Date acompte | SalarieAjouterAcompte › dateAcompte | Date-heure AAAA-MM-JJTHH:MM:SS (00:00:00) | Colonne ajoutée : dernier jour du mois de la période, uniquement quand un acompte existe (sinon vide). Règle validée le 26/10/2026. | `2026-10-31T00:00:00` |
| Saisie/Arrêt | ModificationSaisieArret (fiche non consultée : paramètre à confirmer) | Nombre avec point, 2 décimales | Total des éléments de paie « saisie_arret » du mois. | `0.00` |
| Remboursement transport | SalarieAjouterElementVariable › montantElementVariable (codeElementVariable : table `elementsVariables`) | Nombre avec point, 2 décimales | Toujours 0 pour l’instant (valeur fixe de la requête). | `0.00` |
| Fréquence Remboursement transport | — (aucun paramètre correspondant lu) | Texte | Toujours vide pour l’instant. | *(vide)* |
| Typologie avenant | — (information interne, non importée) | Texte | Libellé du type du dernier avenant valide (signé, publié ou ignoré). | `Avenant - Changement de durée et horaires` |
| Date effet avenant | — (information interne, non importée) | Date AAAA-MM-JJ | Date de début du dernier avenant valide. | `2026-09-22` |
| Date de la fin de contrat | emplois[].dateFin | Date AAAA-MM-JJ | Date de fin du contrat retenu. | `2026-10-24` |
| Motif de fin de contrat | emplois[].motifFinEmploi | Code à 3 chiffres (ex. 008 = fin de contrat de travail) | Toujours vide pour l’instant : à alimenter dans la carte Metabase. | `008` |
| Observations sur la fin de contrat | — (aucun paramètre correspondant lu) | Texte | Toujours vide pour l’instant. | *(vide)* |
| Commentaires éventuels | — (aucun paramètre correspondant lu) | Texte | Toujours vide pour l’instant. | *(vide)* |

## Onglet « Export de paie » — tableau « Absences (export paie 2) » — carte Metabase 540

Une ligne par jour d’absence et par salarié.

| Colonne | Paramètre Silae | Format attendu par Silae | Formule de calcul | Exemple |
|---|---|---|---|---|
| code | SalarieAjouterAbsenceV2 › codeAbsence | Code d’absence Silae du dossier (table `absences`) | Code du type d’absence CAE, converti avec la table de correspondance. « A_MAPPER:xxx » = code Silae à renseigner. | `CP` |
| VALEUR | SalarieAjouterAbsenceV2 › dureeEnHeuresSiJourUnique | Nombre avec point, 2 décimales, positif | Durée de l’absence en minutes ÷ 60 = heures. Une valeur négative dans Metabase (ex. -8) est affichée en positif ; le sens (retenue) est porté par le code d’absence. Valable seulement si l’absence tient sur un seul jour. | `7.00` |
| fin | SalarieAjouterAbsenceV2 › dateFinAbsence | Date-heure AAAA-MM-JJTHH:MM:SS (00:00:00) | Dernier jour de l’absence. | `2026-09-24T00:00:00` |
| debut | SalarieAjouterAbsenceV2 › dateDebutAbsence | Date-heure AAAA-MM-JJTHH:MM:SS (00:00:00) | Premier jour de l’absence. | `2026-09-24T00:00:00` |
| libelle | SalarieAjouterAbsenceV2 › commentaire | Texte | Libellé du type d’absence CAE (sert de commentaire dans Silae). | `Absence non rémunérée (autorisée)` |
| matricule | matriculeSalarie | Texte, 30 caractères max (zéros du début conservés) | Matricule RH du salarié. | `00858` |

## Onglet « Export DPAE » — carte Metabase 384

Une ligne par salarié et par contrat signé.

| Colonne | Paramètre Silae | Format attendu par Silae | Formule de calcul | Exemple |
|---|---|---|---|---|
| DPAE MATRICULE | matriculeSalarie | Texte, 30 caractères max (zéros du début conservés) | Matricule RH du salarié. | `02691` |
| CIVILITE | civilite | Entier : 1 = Monsieur, 2 = Madame | 1 si la civilité est « Monsieur », sinon 2. | `1` |
| CODE ANALYTIQUE | affectation1 | Texte, 30 caractères max | Code de la mission du contrat. | `26CRF24PAR` |
| NOM | nomNaissance | Texte, 50 caractères max | Nom en majuscules. | `ABDEL AZIZ-FOUQUE` |
| PRENOM | prenom | Texte, 40 caractères max | Prénom, première lettre de chaque mot en majuscule. | `Emmanuel` |
| SECURITE SOCIALE | numeroSecuriteSociale | 15 caractères exactement (13 chiffres + clé de 2), sans espace | Numéro de sécurité sociale saisi par le salarié, espaces et points retirés. Une alerte s’affiche si la longueur n’est pas 15. | `189057501234567` |
| DATE DE NAISSANCE | dateNaissance | Date AAAA-MM-JJ | Date de naissance saisie par le salarié. | `1989-05-14` |
| LIEU DE NAISSANCE | communeNaissance | Texte, 32 caractères max | Ville de naissance saisie par le salarié. | `Paris` |
| DEPT NAISSANCE | departementNaissance | Texte, 2 caractères (01 à 95, 2A, 2B, 99 = étranger) | 99 si le pays de naissance n’est pas la France, sinon le département saisi (complété par un 0 devant s’il n’a qu’un chiffre). | `75` |
| CODE NAISSANCE | codePaysNaissance | Code pays ISO sur 2 lettres | Pays de naissance saisi, reconnu dans une liste de pays (vide si non reconnu). | `FR` |
| PAYS NAISSANCE | paysNaissance | Texte, 38 caractères max, majuscules sans accent | Nom du pays correspondant au code ci-dessus. | `FRANCE` |
| CODE NATIONALITE | codePaysNationalite | Code pays ISO sur 2 lettres | Nationalité saisie, reconnue dans une liste de pays. | `FR` |
| NATIONALITE | — (Silae attend le NOM DU PAYS dans paysNationalite ; cette colonne contient l’adjectif, le code ci-dessus suffit : colonne non importée) | Texte | Adjectif de nationalité (FRANCAISE, MAROCAINE…). | `FRANCAISE` |
| N°VOIE | numVoie | Texte, 4 caractères max | Premier mot de l’adresse s’il commence par un chiffre. | `12` |
| Bis Ter Quart.. | btqc | Texte (BIS, TER, QUATER…) | Toujours vide pour l’instant. | *(vide)* |
| NOM DE LA VOIE | nomVoie | Texte, 32 caractères max | Adresse saisie, sans le numéro du début. | `rue de la Paix` |
| COMPLEMENT | complement | Texte, 38 caractères max | Toujours vide pour l’instant. | *(vide)* |
| CODE POSTAL | codePostal | Texte, 5 caractères | Code postal saisi par le salarié. | `75002` |
| VILLE | nomVille | Texte, 32 caractères max | Ville saisie par le salarié. | `Paris` |
| CODE PAYS | codePays | Code pays ISO sur 2 lettres | Toujours FR pour l’instant. | `FR` |
| EMAIL | eMail | Texte, 60 caractères max | E-mail du compte du salarié. | `prenom.nom@exemple.fr` |
| PREMIERE MISSION CAE | — (information interne, non importée) | OUI ou NON | NON si la mission a démarré plus de 5 jours avant ou après le contrat, sinon OUI. | `OUI` |
| FONCTION | emplois[].intituleEmploi | Texte, 120 caractères max | Statut du type de contrat (RD, RE…). | `RE` |
| QUALIFICATION | emplois[].codeStatutProfessionnel | Code à 2 chiffres : 29 = Cadre, 31 = ETAM (table `qualification`) | IC si le statut du contrat commence par « RE », sinon ETAM ; puis converti en code Silae. | `29` |
| POSITION/COEFFICIENT | emplois[].coefficient1 à coefficient4 | Texte découpé par les points | Même règle que dans l’onglet paie. Colonne conservée sous forme de code ; à découper en coefficient1..4 à l’import. | `1.2.240` |
| HEURES / SEM | Horaires de l’emploi (fiche emploi : SEM_HoraireMensuel, SEM_HT…) — paramètre exact à confirmer | Nombre entier (heures par semaine) | Durée de travail par semaine du type de contrat. | `20` |
| SEMAINE | — (planning interne, non importé) | Texte | « Lundi/vendredi » si la mission travaille le lundi, sinon « Mardi/samedi ». | `Mardi/samedi` |
| JOURS OFF | — (planning interne, non importé) | Texte | Jours de la mission que le salarié ne travaille pas (lun, mar…). Vide s’il travaille tous les jours de la mission. | `lun mer` |
| REMUNERATION HORAIRE BRUTE | Rémunération de l’emploi (fiche emploi SEM_SalaireDeBase avec SEM_TypeSalaireDeBase « horaire ») — paramètre exact à confirmer | Nombre avec point, 2 décimales | Salaire horaire brut du contrat. | `12.50` |
| TYPE DE CONTRAT | emplois[].codeContratTravail | Code à 2 chiffres : 01 = CDI, 02 = CDD (table `typeContrat`) | Type du contrat en majuscules (CDI / CDD), converti en code Silae. | `02` |
| MOTIF RECOURS AU CDD | emplois[].motifCDD | Code à 2 chiffres (03 = CDD d’usage) | Toujours 03 (CDD d’usage) : valeur fixe de la requête. | `03` |
| DATE DEBUT CONTRAT | emplois[].dateDebutContrat (et dateDebut) | Date AAAA-MM-JJ | Date de début du contrat signé. | `2026-09-07` |
| DATE FIN CONTRAT | emplois[].dateFin | Date AAAA-MM-JJ | Date de fin du contrat signé. | `2026-10-16` |
| ETABLISSEMENT | emplois[].nomInterneEtablissement | Texte : nom interne de l’établissement dans Silae | Établissement de la mission. Doit être identique au nom interne saisi dans Silae. | `Siège` |
| MUTUELLE CDI | Non couvert par les fonctions lues — valeur conservée telle quelle | OUI ou NON | OUI si le contrat est marqué « mutuelle », sinon NON. | `NON` |
| VERSEMENT SANTE CDD | Non couvert par les fonctions lues — valeur conservée telle quelle | OUI ou NON | Toujours NON pour l’instant. | `NON` |
| SITUATION FAMILIALE | situationFamiliale | Entier : 10 célibataire, 20 vie maritale, 30 pacsé, 40 marié, 50 séparé, 60 divorcé, 70 veuf, 0 vide (table `situationFamiliale`) | Situation saisie par le salarié, convertie en code. « Pacsé ou en concubinage » = 30 (à confirmer). | `10` |
| NB ENFANTS A CHARGE | nbPersACharge | Nombre entier | Nombre d’enfants à charge saisi par le salarié. | `2` |
| MODE DE PAIEMENT | — (aucun paramètre correspondant : voir ribPourVirements) | Texte | Toujours « virement ». | `virement` |
| IBAN | iBan | Texte, 34 caractères max, sans espace, majuscules | IBAN saisi par le salarié. | `FR7612345678901234567890123` |
| SWIFT | bic | Texte, 11 caractères max, sans espace, majuscules | BIC/SWIFT saisi par le salarié. | `BNPAFRPP` |

## Table de correspondance CAE → Silae (`src/lib/silae-codes.js`)

Les codes marqués **À RENSEIGNER** dépendent du paramétrage du dossier de paie dans Silae et ne figurent pas dans la documentation.

### `absences`

| Valeur CAE | Code Silae |
|---|---|
| 1 | **À RENSEIGNER** |
| 100 | **À RENSEIGNER** |
| 105 | **À RENSEIGNER** |
| 300 | **À RENSEIGNER** |
| 360 | **À RENSEIGNER** |
| 361 | **À RENSEIGNER** |
| 620 | **À RENSEIGNER** |
| 630 | **À RENSEIGNER** |
| 000 | **À RENSEIGNER** |

### `heures`

| Valeur CAE | Code Silae |
|---|---|
| Heures non travaillées | **À RENSEIGNER** |
| Dont heures complémentaires 25% | **À RENSEIGNER** |
| Dont heures complémentaires 50% | **À RENSEIGNER** |
| Dont heures jours fériés | **À RENSEIGNER** |

### `elementsVariables`

| Valeur CAE | Code Silae |
|---|---|
| Prime transport | **À RENSEIGNER** |
| Prime conduite | **À RENSEIGNER** |
| Prime RE | **À RENSEIGNER** |
| Prime Exceptionnelle | **À RENSEIGNER** |
| Tickets restaurants | **À RENSEIGNER** |
| Indemnités grand déplacement | **À RENSEIGNER** |
| Remboursement transport | **À RENSEIGNER** |

### `absencesPaie`

| Valeur CAE | Code Silae |
|---|---|
| Nombre de Conges payés | **À RENSEIGNER** |
| Nombre de Repos compensateur | **À RENSEIGNER** |
| Nombre de Repos compensateur Pénibilité | **À RENSEIGNER** |
| Nombre d'heures arrêt maladie | **À RENSEIGNER** |

### `qualification`

| Valeur CAE | Code Silae |
|---|---|
| IC | `29` |
| ETAM | `31` |

### `typeContrat`

| Valeur CAE | Code Silae |
|---|---|
| CDI | `01` |
| CDD | `02` |

### `situationFamiliale`

| Valeur CAE | Code Silae |
|---|---|
| Célibataire | `10` |
| Marié | `40` |
| Pacsé ou en concubinage | `30` |
| Séparé | `50` |
| Divorcé | `60` |
| Veuf | `70` |
| Inconnu | `0` |

## Points d’attention

1. **Format de fichier** : CSV séparé par des points-virgules (UTF-8 avec BOM), décimales avec un point. L’export Excel (.xlsx) est aussi disponible. La doc Silae ne décrit que l’API REST : si vous importez à la main dans Silae, il faudra peut-être renommer les colonnes selon le modèle d’import de Silae.
2. **Un appel API par donnée** : les colonnes d’heures, de primes et d’absences de l’onglet paie sont « une colonne = un code Silae ». Pour l’API, chaque valeur non nulle devient un appel avec son code (table de correspondance ci-dessus).
3. **Acompte** : Silae exige une `dateAcompte`. Elle est ajoutée par l’export : dernier jour du mois de la période, uniquement quand un acompte existe.
4. **Absences** :
   - Préférer le tableau « Absences (export paie 2) » (vraies dates de début et de fin) aux colonnes « Dates de… » de l’export de paie, qui sont recalculées à partir de jours/mois sans année.
   - `dureeEnHeuresSiJourUnique` n’est valable que pour une absence sur un seul jour (une ligne = un jour ici).
   - Le sens des valeurs négatives (ex. -8 pour le code 630) est perdu : à porter par le code d’absence Silae.
5. **Jours fériés** : calculés dans la carte Metabase 290 (fériés fixes + lundi de Pâques, Ascension et lundi de Pentecôte, de 2024 à 2040). Corrigé le 26/10/2026 ; l’ancienne liste, fixée à 2026, n’avait pas le lundi de Pentecôte. Au-delà de 2040, étendre la plage d’années dans la carte.
6. **Coefficients** : le code « 1.2.240 » est découpé en coefficient1 à 4 (découpage validé le 26/10/2026).
7. **Paramètres non vérifiés** (pages non consultées ou tronquées) : nom exact du salaire de base et des horaires dans `CreationSalarieEmplois`, `ModificationSaisieArret`, mutuelle / contrat complémentaire.
8. **DPAE** : l’API n’a pas de fonction « envoyer une DPAE » seule. Le paramètre `envoiDUEEdi` de `CreationSalarieEmplois` déclenche l’envoi d’une DUE en EDI. `SalarieRecupererRecuDPAE` existe aussi (fiche non lue, probablement la récupération du reçu).
9. **Matricule** : le CSV ouvert dans Excel supprime les zéros du début (`02691` devient `2691`). L’export Excel (.xlsx) les conserve.
10. **Données personnelles** : cet export contient numéro de sécurité sociale et IBAN, et le Worker n’a aucune authentification (voir `CONTEXTE-PROJET.md`).
