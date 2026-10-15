# Indicateurs — Dashboard CAE

Une ligne par indicateur : **formule précise** → dashboards où il apparaît. Mise à jour 14/10/2026 (harmonisation des noms et des périmètres).

## Périmètre commun (toutes les formules ci-dessous)

- **Dons valides** : statut ∈ (`nouveau`, `en_attente`, `transmis`). **BS au sens large** : valides + `incomplet` + `annule`.
- **Lots** : `lots.date <= aujourd'hui` ; lots dont `heures_remuneration_completes = faux` ignorés le jour même (`/direction`, `/direction-suivi`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte`, `/rh`, `/emplacement`, `/site-prive`, `/salarie`). `/client` exclut toute la journée en cours. `/challenge` : pas d'exclusion (classement du jour).
- **Présence d'un lot** : heures rémunérées (`nombre_horaires_remuneration`) ≠ 0. **Heures de rue** : lots dont `presence_recruteur` n'est pas faux (`is distinct from false`) ; sinon 0 (heures « fantômes » conservées en base pour un recruteur absent, ≈ 5 500 h en 2026). Même règle que la question Metabase 486.
- **Clients exclus** : 2 clients de test + « ONG de test » (sauf `/rd`, `/re-collecte`, `/re-mobilisation`, `/rd-mobilisation`) ; `AL`, `[Demo] Stores`. **Missions `type_offre = 'mobilisation'`** exclues de tout sauf `/re-mobilisation` et `/rd-mobilisation` (non filtrable : `/rm`, cartes de `/rh-suivi`/`/rh-export`). Mécanisme : `excludeClientsClause` (vues multi-missions) ou validation d'id en amont (fiches à id unique).
- **Staging** : `?staging=1` interroge la base Metabase Staging (id 4) au lieu de Production (id 3) ; `/rm` toujours Production.
- **Âge d'un donateur** : `(dons.created_at::date − date de naissance) / 365.25`. Dons sans date de naissance : comptés dans « Autre » (tranches) et exclus des % d'âge (dénominateur = dons avec date de naissance connue ; couverture ~100 % en 2026, ~15 % sur les anciennes missions).

## Indicateurs

| Indicateur | Formule | Dashboards |
|---|---|---|
| **BS réel** (= Nb dons) | `count(distinct dons.id)` dons valides | tous |
| **BS rue** | `count(distinct dons.id)` BS au sens large | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` |
| **Heures de rue** | `sum(nombre_horaires_rue)` sur lots avec `presence_recruteur ≠ faux` | tous sauf `/rm` |
| **Heures rémunérées** | `sum(nombre_horaires_remuneration)` sur lots présents (≠ 0) | `/client`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte`, `/rh`, `/salarie`, `/direction`, `/direction-suivi` |
| **Taux réel** | `BS réel / heures de rue` (brut, 3 décimales) ; agrégats toujours en moyenne pondérée (Σ BS / Σ heures) | `/client`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte`, `/salarie`, `/rh`, `/direction`, `/direction-suivi`, `/emplacement`, `/site-prive`, `/assistant-site-prive`, `/challenge`, `/rm` (reconstruit côté client depuis la carte 514) |
| **Taux de transformation** (`tx_transfo`) | `100 × BS réel / BS rue` (affiché à l'unité) | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/rm` |
| **Don moyen** | `avg(montant)` dons valides (€, 2 décimales) | tous sauf `/challenge`, `/mobilisation` |
| **Âge médian** | `percentile_cont(0.5)` de l'âge des donateurs, dons valides (1 décimale) | `/client`, `/challenge` (par mission, ≥ 3 dons), `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/direction`, `/direction-suivi` |
| **% donateurs −25 ans** (`pct_moins_25`) | `100 × dons valides avec âge < 25 / dons valides avec date de naissance connue` (1 décimale) | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie`, `/direction` |
| **Score qualité** | `don moyen × (1 − % −25 ans)` ; barème : 0–3 Très faible · 3–5,5 Faible · 5,5–6,5 Moyen · 6,5–8 Bon · > 8 Très bon (2 décimales sur `/rm-collecte` et `/salarie`, 1 ailleurs) | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie` |
| **Ratio h** (heures rue / rém.) | `heures de rue / heures rémunérées` (affiché en %, 1 décimale) | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie`, `/direction`, `/direction-suivi` |
| **Taux de présence** | `100 × lots présents / nb lots` (≤ 100 %) | `/rd`, `/re-collecte`, `/mission`, `/rh` |
| **% absence** | `lots sans heures rémunérées / lots` (= 1 − taux de présence) | `/direction-suivi` |
| **Absentéisme** | `1 − jours de présence hors arrêt maladie / (jours de présence + absence)` ; seules les absences « maladie » sont exclues | `/direction` |
| **Présence des RD** (suivi quotidien) | `100 × Σ RD présents / Σ RD attendus` par jour (RD attendus = recruteurs distincts hors RE ayant un lot ; présents = heures rémunérées ≠ 0) | `/rm-collecte` |
| **Nb lots** | `count(lots)` de la période | `/direction`, `/direction-suivi` (colonne « Lots »), `/rd`, `/rh` (colonne « Lots ») |
| **Nb jours d'activité** | dates distinctes avec lot (par site, emplacement ou mission) | `/site-prive`, `/assistant-site-prive`, `/emplacement`, `/direction` (avancement) |
| **Nb recruteurs** | `count(distinct utilisateur_id)` des lots, RE inclus | `/direction-suivi`, `/rm-collecte`, `/rh` |
| **Nb RD** | recruteurs distincts hors responsable d'équipe (RE = `missions.responsable_equipe_id`) ; format « RD+RE » (ex. 3+1) | `/site-prive`, `/assistant-site-prive` ; grade RD/RDC/RDE sur `/direction` |
| **Nb missions** | `count(distinct missions.id)` ayant au moins un lot dans la période ; `/client` : statut ∈ (terminée, en cours, en attente) | `/client`, `/direction`, `/direction-suivi`, `/site-prive` |
| **Villes de mission** | `missions.ville_principale` des missions du salarié (contrat ou lot), dédoublonnées sans tenir compte de la casse ; infobulle avec la formule sur chaque indicateur de la fiche | `/salarie` |
| **Tranche d'âge** | `18-20` ([18,21[), `21-25` ([21,26[), `26-35`, `36-50`, `50 et +` (≥ 51), `Autre` (âge inconnu ou < 18) | `/client`, `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` |
| **Genre** | `Hommes` (monsieur), `Femmes` (madame), `Autre/NC` | `/client`, `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` |
| **Bulletins par jour** | `count(distinct dons.id)` valides par jour (et par RD) | `/client`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte` |
| **Dons suspects** | motif ≠ « Ok » parmi 14 règles par priorité (test, mineur, fraude = nom recruteur, coordonnées recruteur, autre recruteur, montant ≥ 100, sans email, téléphone non communiqué / suspect, email mal orthographié / faux, adresse < 6 car., hors heures 20h–9h ou dimanche, donateur multiple > 5 dons). Périmètre statuts : `/rd`/`/re-collecte` + annulés ; `/rm-collecte` sans les `transmis` | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` |
| **Objectif / % atteint** | `objectif_bulletin_theorique` réparti à parts égales sur les jours de lots ; objectif prorata = objectif × jours réalisés / jours de la mission ; % = BS réel / objectif. `/rm-collecte` : BS cumulés depuis le début / objectif | `/rm-collecte`, `/re-collecte`, `/direction` |
| **Taux de FPE** | `contrats avec avenant fin_period_essai / contrats du périmètre` ; `/rh` et `/rm-collecte` : split employeur / salarié (libellé) ; `/direction` : global | `/rh`, `/rm-collecte`, `/direction` |
| **Badge FPE / début-fin de contrat** | `FPE` si le contrat le plus récent du recruteur sur la mission porte l'avenant ; dates de ce contrat | `/rd`, `/re-collecte`, `/mission`, `/rh` |
| **Taux de complétion emplacement** | `lots avec emplacement_id / lots` (1 décimale) | `/rh` |
| **Recrutements / candidatures** | `count(distinct contrats.id)` par `date_debut` ; événements `candidate.create` TeamTailor dédupliqués | `/rh` |
| **Délai de complétion d'équipe** | début du contrat du dernier recruteur arrivé − début de mission | `/rh` |
| **Anciens / nouveaux, grades** | anciens = ≥ 3 missions ; RD/RDC/RDE d'après le contrat le plus récent | `/direction` |
| **Horaires 1er / dernier BS** | heure de Paris de min/max `dons.created_at` valides du jour | `/rm-collecte`, `/emplacement` |
| **Taux réel par jour de semaine / mois** | `Σ BS / Σ heures` par jour de semaine (1 = lundi) ou mois calendaire | `/emplacement` |
| **Classement sites / enseignes** | taux réel pondéré par site / enseigne (liste fermée) ; sites sans heures exclus | `/site-prive`, `/assistant-site-prive` |
| **Top recruteurs / équipes** | `count(distinct dons)` par recruteur (jour, semaine, dernière heure) ; taux réel par équipe sur la semaine en cours ; missions `en_cours` | `/challenge` |
| **Volume de dons par statut** | dons créés sur la période (`created_at`), tous statuts, CozApp (`old_cae_id` nul) / BO | `/direction-suivi` |
| **Transmissions / dépôts / facturation** | dons valides créés (à transmettre = nouveau + en attente, transmis) ; dépôts = `date_transmission` dans la période ; facturation = `transmis` hors BO par client × type | `/direction-suivi` |
| **Taux de rencontre** | `passages « porte ouverte » / (logements visités − « non conforme »)` | `/re-mobilisation`, `/rd-mobilisation` |
| **Taux de traitement** | `logements visités / logements_count` de l'habitation | `/re-mobilisation`, `/rd-mobilisation` |
| **Nb logements théorique / trouvés** | `sum(nombre_logements)` / `sum(logements_count)` | `/re-mobilisation`, `/rd-mobilisation` |
| **Passages par logement** | `avg(passages_count)` des logements visités ; statut = dernier passage | `/re-mobilisation`, `/rd-mobilisation` |

## Formats d'affichage

Taux réel brut 3 décimales · tx_transfo % à l'unité · ratio h, taux de présence, % −25 ans, taux de complétion : % 1 décimale · don moyen € 2 décimales · âge médian 1 décimale · comptages entiers.

## Réserves connues

- `/site-prive` (et `/assistant-site-prive`) : périmètre = emplacements privés + lots sans emplacement. Le KPI « Taux réel mission » (`/site-prive`) et le récap « par mission » donnent les heures, BS et taux réel de la mission entière (tous lots, tous emplacements, toutes heures de rue et tous BS, comme `/mission`), quel que soit le filtre emplacement / ville / département ; le KPI « Taux réel (filtres) », les autres KPI, classements et tableaux par site restent limités au filtre. `/emplacement` : le « Taux réel mission » de chaque carte mission = mission entière (tous emplacements, comme `/mission`) ; BS réel, don moyen et jours restent ceux de l'emplacement, et « Taux réel emplacement » (par carte mission) = BS réel / heures de rue de cette mission à cet emplacement uniquement (le taux réel global de l'emplacement, toutes missions, reste dans les KPI de la fiche). `/assistant-site-prive` : aucune donnée tant qu'aucune mission n'est choisie (API: `requiresMission`) ; fiche mission (dates, type, format, ville principale) comme `/client`. Les lots sans emplacement ne figurent que dans les totaux (KPI, récap mission, enseigne « Autres »), pas dans les tableaux par site ou par jour.
- `/rm-collecte` : la liste des RM regroupe par nom (une personne avec plusieurs comptes utilisateurs n'apparaît qu'une fois ; le filtre `id_rm` accepte plusieurs ids séparés par des virgules).

- ~900 lots (2026, surtout sites privés) ont `presence_recruteur = faux` mais des heures rémunérées ≠ 0 : ils restent comptés « présents » pour le taux de présence.
- `/rm` consomme la carte Metabase 514 : formules (dont le dénominateur de « % < 25 ») non vérifiables côté projet.
- `/client` exclut la journée en cours (petit écart de taux réel avec les autres dashboards en cours de journée).
- Les requêtes d'âge / genre / suspects de `/rd` et `/rm-collecte` n'appliquent pas encore la règle « lots non complétés ignorés le jour même » (effet limité à la journée en cours).
- Objectifs par jour : approximation, la base ne porte pas d'objectif journalier.
