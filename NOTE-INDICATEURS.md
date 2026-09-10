# Note méthodologique — Calcul des indicateurs (Dashboard CAE)

Cette note documente la formule exacte de chaque indicateur affiché sur les dashboards du projet, dashboard par dashboard, puis vérifie que les indicateurs qui portent le même nom sur plusieurs dashboards sont bien calculés de la même manière. Elle est basée sur une lecture intégrale des 12 fichiers `src/lib/sql-*.js` qui construisent les requêtes SQL.

Verdict résumé : la grande majorité des indicateurs partagés (taux réel, don moyen, statuts de dons "valides", filtre de présence) sont calculés de façon strictement identique partout. Une incohérence sérieuse et active a été trouvée sur le "Taux d'absence" du dashboard `/salarie`, et une incohérence dormante (code mort non branché à une page actuelle) sur `sql-mission.js` — **les deux ont été corrigées** (voir section 4, mise à jour du 10/09/2026). Une dernière divergence, purement cosmétique (diviseur d'âge 365.0 vs 365.25), reste en l'état, sans impact perceptible.

---

## 1. Conventions communes à (presque) tous les dashboards

**Dons "valides" / "réels"** : un don compte dans le "BS réel" s'il a le statut `nouveau`, `en_attente` ou `transmis`. Cet ensemble de 3 statuts est identique dans les 12 fichiers, mais il n'est PAS centralisé dans un module partagé (contrairement à l'exclusion de clients, voir plus bas) : il est soit une constante `STATUTS_VALIDES` redéfinie dans chaque fichier (sql-mission.js, sql-rd.js, sql-challenge.js, sql-salarie.js, sql-emplacement.js, sql-site-prive.js, sql-rh.js), soit recopié en dur (sql-client.js, sql-mission-suivi.js, sql-rm-collecte.js). Le contenu est identique partout aujourd'hui ; le risque est que quelqu'un modifie cette règle un jour dans un seul fichier et oublie les 11 autres.

**"BS au sens large" (`STATUTS_RUE`)** : `nouveau, en_attente, transmis, incomplet, annule` — utilisé uniquement là où un taux de transformation (BS réel / BS remonté) a du sens (sql-mission.js, sql-rd.js, sql-rm-collecte.js).

**Filtre de présence sur les heures** : partout où des heures de rue/rémunération sont sommées, le lot est gardé si `presence_recruteur` est `TRUE` ou `NULL` (absent seulement si explicitement `FALSE`). Écrit de deux façons équivalentes selon le fichier — `coalesce(presence_recruteur, true)` ou `presence_recruteur <> FALSE OR presence_recruteur IS NULL` — mais le comportement est identique partout.

**Exclusion de 3 clients** (démo/test) : centralisée dans `excluded-clients.js` (`excludeClientsClause`), appliquée dans les dashboards multi-missions (rm-collecte, challenge, salarié, emplacement, site-prive, rh). Absente des dashboards RD/mission/mobilisation/re-collecte/client — ce n'est pas un oubli : ces dashboards sont toujours ouverts avec un `id_mission` déjà choisi, et la validation de cet id (`missionIsExcluded`) filtre en amont au niveau de la route plutôt que dans la requête elle-même.

---

## 2. Indicateurs communs à plusieurs dashboards — vérification de cohérence

### Taux réel (BS réel / heures de rue)

Formule partout : `BS réel / heures de rue`, en moyenne pondérée (somme des BS réels ÷ somme des heures, jamais une moyenne de taux journaliers/par mission). Présent sur `/mission`, `/rd`, `/re-collecte`, `/rm-collecte`, `/challenge`, `/salarie`, `/emplacement`, `/site-prive`, `/rh`.

✅ **Formule identique partout.** Seule différence : la précision d'arrondi SQL diffère (2 décimales sur `/rd` et `/mission-suivi` (`/mission`), 3 décimales sur `/rm-collecte`, pas d'arrondi SQL explicite sur `/emplacement`, `/site-prive`, `/rh`, `/challenge`, `/salarie` — le JS applique son propre formatage à l'affichage). Purement cosmétique, sans impact sur le calcul lui-même.

### Don moyen

Formule partout : `avg(montant)` sur les dons au statut valide uniquement. Présent sur `/client`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte`, `/emplacement`, `/site-prive`, `/rh`, `/salarie`.

✅ **Identique partout.**

### Taux de complétion de saisie (présence, emplacement)

Uniquement sur `/rh` (nouveau dashboard) : part des lots où `presence_recruteur`/`emplacement_id` est renseigné (non NULL). Pas de doublon ailleurs, donc pas de risque de divergence — juste à noter que ces deux indicateurs n'existent qu'à cet endroit.

### Taux d'absence — ⚠️ INCOHÉRENCE ACTIVE (voir section 4.1)

Deux définitions coexistent sous le même nom affiché **"Taux d'absence"** :
- `/rd`, `/re-collecte`, `/rh` : `jours d'absence / (jours de présence + jours d'absence)`, basé sur `lots.presence_recruteur = FALSE` vs `TRUE` (les lots NULL sont exclus du calcul).
- `/salarie` : `heures rémunérées / (nombre de lots × 7)` — un ratio d'heures effectivement payées rapporté à un forfait théorique de 7h/lot. Ce n'est pas la même métrique, et son sens est même inversé (ratio élevé = présent, alors que sur les autres dashboards ratio élevé = absent).

### Taux de transformation (BS réel / BS remonté) et % de donateurs -25 ans

Présents sous deux échelles différentes : ratio 0–1 dans `sql-mission.js` (`taux_transfo`, `pct_moins_25`), pourcentage 0–100 dans `sql-rd.js`/`sql-rm-collecte.js`/`sql-mission-suivi.js` (`tx_transfo` ou `taux_transfo` selon fichier, `pct_moins_25`). Voir section 4.2 — **sans impact aujourd'hui** car le code source de cette divergence (`sql-mission.js`) n'est branché à aucune page active.

### Âge des donateurs

Trois façons de calculer un "âge" coexistent, mais pour des usages différents :
- Âge **au moment du don** (`(date du don − date de naissance) / 365.0`), en médiane : `/mission`, `/rd`, `/re-collecte`, `/rm-collecte` (tableaux, score qualité).
- Âge **actuel** (`age(now(), date de naissance)` ou `(CURRENT_DATE − date de naissance) / 365.25`), en moyenne ou en répartition par tranche : `/client` (répartition), `/rd`/`/rm-collecte` (camemberts), `/challenge` (âge moyen, ≥3 dons requis pour figurer au classement).

C'est un choix intentionnel (âge au don = qualité du recrutement ; âge actuel = profil de la base actuelle de donateurs), pas une erreur. Seul point cosmétique : le diviseur change selon l'endroit (365.0 vs 365.25 jours/an), écart négligeable (< 1 jour d'erreur par an) mais sans raison de ne pas harmoniser.

### Ratio heures rue / heures rémunérées

`/mission`, `/rd`, `/rm-collecte` : `ratio_h = heures_rue / heures_rem`, formule et arrondi (2 décimales) identiques. `/salarie` utilise un indicateur apparenté mais distinct, `taux_h`, avec un dénominateur restreint aux lots où `heures_remuneration_completes` est vrai (filtre absent ailleurs) — nom différent, donc pas de confusion possible pour l'utilisateur, mais à savoir si on veut un jour comparer les deux.

### Badge FPE (fin de période d'essai)

`/rd`, `/re-collecte`, et la table "recruteurs par mission" de `/rh` : même logique — `'FPE'` si le contrat le plus récent du recruteur sur la mission a un avenant de catégorie `fin_period_essai`, sans distinction employeur/salarié. ✅ Identique. Le graphique agrégé de `/rh` (taux de FPE par période, empilé employeur/salarié) est un indicateur différent (un taux, pas un badge individuel) qui réutilise la même détection d'avenant mais distingue l'initiative via le libellé — cohérent avec le badge, juste plus détaillé.

### Statuts de dons "valides" utilisés pour les listes de doublons/suspects

`/rd` (`buildRdBsSuspectsQuery`) exclut les dons annulés ; `/re-collecte` et `/rm-collecte` (listes détaillées) les incluent, et `/rm-collecte` exclut spécifiquement `transmis` (commenté dans le code : une fois transmis, le contrôle qualité est considéré comme fait). Ce sont des choix de périmètre délibérés et documentés dans le code, pas des divergences accidentelles.

---

## 3. Indicateurs propres à un seul dashboard (pas de comparaison possible)

- **`/mobilisation`** (RE/RD porte-à-porte) : taux de rencontre (portes ouvertes / logements visités hors non-conformes), taux de traitement (logements visités / logements recensés), passages moyens par logement.
- **`/salarie`** : score qualité = don moyen × % de donateurs ≥25 ans (à la date du don), calculé sur toute la carrière et sur les 270 dernières heures rémunérées (statut global).
- **`/emplacement`** : taux réel par jour de semaine / par mois calendaire (toutes années confondues), nombre moyen de recruteurs par jour.
- **`/site-prive`** : taux réel par typologie d'emplacement et par enseigne (déduite heuristiquement du nom), évolution du taux réel jour/semaine/mois.
- **`/rh`** : nombre de recrutements et de candidatures (nouveaux candidats TeamTailor) par jour/semaine/mois, jours avant complétion d'équipe (date du dernier recrutement − début de mission, faute de champ d'effectif cible en base).
- **`/rd`, `/re-collecte`** : détection de dons suspects (13 motifs classés par priorité : test, mineur, fraude, coordonnées du recruteur, montant élevé, email/téléphone invalides, don hors heures ouvrées, donateur multiple, etc.).

---

## 4. Incohérences trouvées — détail et recommandation

### 4.1 — "Taux d'absence" sur `/salarie` ne mesurait pas la même chose que sur `/rd`, `/re-collecte` et `/rh` — ✅ CORRIGÉ (10/09/2026)

- `sql-rd.js` / `sql-rh.js` : `jours_absence / (jours_presence + jours_absence)` — un vrai taux d'absence basé sur le pointage (`presence_recruteur`).
- `sql-salarie.js` (avant correction) : `heures_remuneration / (nb_lots × 7)` — un ratio d'heures payées par rapport à un forfait théorique de 7h/lot. Un salarié très présent avait un ratio proche de 1 (donc un "taux d'absence" élevé affiché comme si c'était mauvais, alors que c'était bon).

Les deux étaient affichés à l'écran sous le même libellé français **"Taux d'absence"** (`salarie.html` lignes 257 et 335), ce qui pouvait induire en erreur quiconque comparait la fiche individuelle `/salarie` d'un recruteur avec la vue mission `/rd` ou `/rh` pour la même personne.

**Correction appliquée** : `sql-salarie.js` (`buildPerformanceParMissionQuery` et `buildResumeQuery`) utilise désormais la même formule que `/rd`/`/rh` (`jours_absence / (jours_presence + jours_absence)`, via `lots.presence_recruteur`), validée contre Metabase. Aucun changement de format nécessaire côté `salarie.html` (le JS multipliait déjà par 100 pour l'affichage en %).

### 4.2 — `sql-mission.js` calculait taux de transformation et %-25 ans en ratio 0–1, contre 0–100 ailleurs — ✅ SUPPRIMÉ (10/09/2026)

`sql-mission.js` (fonctions `buildMissionPerformanceQueries`/`buildRecruteurPerformanceQueries`, routes `/api/mission-performance` et `/api/recruteur-performance`) définissait `taux_transfo` et `pct_moins_25` en ratio 0–1, alors que `sql-rd.js`/`sql-rm-collecte.js`/`sql-mission-suivi.js` (qui alimentent réellement `/rd.html`, `/rm-collecte.html`, `/mission.html`) utilisent ces mêmes noms en pourcentage 0–100.

Vérifié : aucune page dans `public/*.html` n'appelait plus ces deux routes — c'était du code mort, laissé en place depuis une itération antérieure du projet (avant la création de `sql-mission-suivi.js` qui a pris le relai pour `/mission.html`).

**Correction appliquée** : les deux fonctions, les deux routes (`/api/mission-performance`, `/api/recruteur-performance`) et leurs handlers ont été supprimés d'`index.js` et de `sql-mission.js` (qui ne conserve que `buildMissionDaysQuery`/`buildResolveMissionIdQuery`, toujours utilisées par `/api/mission-days` et la résolution code→id mission).

### 4.3 — Diviseur d'âge 365.0 vs 365.25 (COSMÉTIQUE)

Les calculs d'âge "au moment du don" divisent par 365.0 jour, les calculs d'âge "actuel" par tranche divisent parfois par 365.25 (camemberts RD/RM) et parfois utilisent la fonction `age()` de Postgres (exacte, `/client`, `/challenge`). Écart de l'ordre de quelques heures par an, sans effet perceptible sur les tranches d'âge affichées. Mentionné pour être complet, mais je ne recommande pas de le corriger — le gain serait nul.

---

## 5. Fichiers audités

`sql-client.js`, `sql-mission.js`, `sql-mission-suivi.js`, `sql-mobilisation.js`, `sql-rd.js`, `sql-re-collecte.js`, `sql-rm-collecte.js`, `sql-challenge.js`, `sql-salarie.js`, `sql-emplacement.js`, `sql-site-prive.js`, `sql-rh.js`, plus `excluded-clients.js` et `metabase.js` (infrastructure, pas d'indicateur métier).
