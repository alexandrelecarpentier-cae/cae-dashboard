# Audit des calculs — Dashboard CAE (9/2026)

Périmètre : les 13 fichiers `src/lib/sql-*.js` et les 16 dashboards de `public/`. Objectif : vérifier tous les calculs, identifier les erreurs/incohérences, corriger ce qui peut l'être sans arbitrage, et documenter le reste. Le détail des formules est dans `NOTE-INDICATEURS.md` (mis à jour dans le cadre de cet audit) ; ce document liste les anomalies trouvées, les décisions prises, et les tests effectués.

## 1. Bugs corrigés

### 1.1 `sql-rh.js` : champ `taux_absence` mesurait en réalité une présence

**Constat.** `heures_remuneration / (nb_lots × 7)` était nommé `taux_absence` à 5 endroits de `sql-rh.js` (stats globales, missions, recruteurs par mission ×2), alors que plus la valeur est haute, plus la personne est **présente**. Le même bug avait déjà été identifié et corrigé sur `/rd` et `/salarie` lors d'un audit précédent (9/2026), mais la correction n'avait pas été propagée à `/rh`.

**Correction.** Renommage du champ SQL en `taux_presence` (5 occurrences dans `sql-rh.js`) et des libellés affichés dans `rh.html` (en-têtes de tableau ×2, ligne de détail ×2, carte KPI ×1) : "Taux absence" → "Taux de présence".

**Validation Metabase.** Requête reconstruite indépendamment sur des missions réelles (`terminee`/`en_cours`, >5 lots) : résultats entre 0,708 et 0,885 (70,8 % à 88,5 % de présence), cohérent avec un taux de présence plausible et avec les valeurs déjà observées sur `/rd`/`/salarie` pour la même formule.

## 2. Incohérence méthodologique corrigée (avec validation utilisateur)

### 2.1 Dénominateur de `pct_moins_25` / `pct_plus_25`

**Constat.** Deux conventions coexistaient pour le "% de donateurs de moins/plus de 25 ans" :
- **Convention A** (`/rd`, `/re-collecte`, `/mission`, `/rm-collecte`) : dénominateur = tous les BS réel, y compris les dons dont l'âge du donateur est inconnu (qui ne peuvent jamais compter au numérateur → % mécaniquement sous-estimé).
- **Convention B** (`/salarie`, `/direction`) : dénominateur = uniquement les dons dont la date de naissance est connue.

Comme la donnée d'âge est très incomplète sur les missions anciennes (quasi 100 % manquante avant 2024, ~0,2 % après — déjà documenté dans `NOTE-INDICATEURS.md`), ce choix change fortement les pourcentages affichés sur l'historique.

**Décision utilisateur** (question posée explicitement) : harmoniser sur la Convention B partout — dénominateur = dons dont la date de naissance est connue.

**Correction.** Ajout d'un champ `nb_dons_avec_naissance` et changement du dénominateur dans `sql-rd.js` (table RD + total), `sql-rm-collecte.js` (table missions + total) et `sql-mission-suivi.js` (fil par jour). `sql-direction.js` et `sql-salarie.js` utilisaient déjà cette convention, aucun changement nécessaire.

**Validation Metabase — cas de test.**
- Missions historiques (2018-2021, ~500-1250 BS réel) : 0 don avec date de naissance connue → l'ancien calcul affichait `0 %` (laissant croire à aucun jeune donateur), le nouveau affiche `—`/`null` (donnée non disponible, ce qui est la réalité). Résultat : le nouveau comportement est strictement plus honnête.
- Mission avec ~75 % de couverture (761 BS réel, 568 avec date de naissance connue, 214 < 25 ans) : ancien calcul 28,1 %, nouveau 37,7 % — écart de 9,6 points sur des données réelles, confirmant que la convention a un effet non marginal.
- 4 missions à couverture ~100 % : les deux conventions donnent exactement le même résultat (29,7 % à 65,6 %), comme attendu.

## 3. Points vérifiés et jugés sains (pas de bug)

- **Moyenne pondérée du taux réel partout.** Vérifié par calcul indépendant sur des lots réels de missions en cours : moyenne pondérée (somme BS réel / somme heures) = 0,416, moyenne naïve des taux journaliers = 0,181 — un écart de plus du double, qui confirme que le choix (déjà fait partout dans le code) de la moyenne pondérée plutôt que la moyenne de ratios journaliers est important et correctement appliqué dans les 13 fichiers `sql-*.js` inspectés.
- **Département depuis le code postal (`/site-prive`).** Vérifié sur des codes postaux réels de La Réunion (974xx) : dérivation correcte sur 3 chiffres pour les DOM. Aucun code postal corse (20xxx) trouvé en base au moment du test, donc le regroupement documenté 2A/2B → "20" n'a pas pu être vérifié sur donnée réelle, mais la logique (`left(code_postal,2)`) est correcte par construction pour ce cas.
- **Protection des clients exclus.** Deux mécanismes différents selon le type de dashboard, tous deux vérifiés en lisant le code : filtrage SQL direct (`excludeClientsClause`) pour les dashboards multi-missions, validation de l'id en amont (`readClientId`, `missionIsExcluded`) pour les dashboards scopés à une seule entité. Initialement suspecté comme un trou de sécurité sur `/client` et `/mobilisation` (ces fichiers SQL n'appellent pas `excludeClientsClause`), la lecture de `metabase.js`/`index.js` a confirmé que la protection est bien faite, juste à un autre niveau (`readClientId` rejette explicitement un `id_client` exclu ; `missionIsExcluded` est appelé avant toute requête sur `/re-mobilisation`/`/rd-mobilisation`). Pas de bug.
- **`sql-mission.js`** : ne contient plus que deux requêtes utilitaires (résolution code_mission→id, liste des jours d'une mission), sans formule de calcul — l'ancien code mort (`buildMissionPerformanceQueries`, etc.) a déjà été supprimé lors d'un audit précédent.
- **`sql-excluded-clients.js`** *(nommé `excluded-clients.js`)* : logique simple et correcte (liste d'ids + helpers de clause), pas de calcul.

## 4. Différences volontaires et déjà bien documentées (pas des anomalies)

- **`/direction`** : `taux_reel_point_mort` = BS réel / heures **rémunérées** (pas heures de rue comme le "taux réel" standard) — vient d'un document source fourni par l'utilisateur, mentionné explicitement en commentaire.
- **`/direction`** : `absentéisme` exclut seulement les absences "maladie" du numérateur (contrairement à `taux_absence_injustifiee` de `/rd` qui exclut aussi les absences "autorisées") — signalé dans le code comme une règle non tranchée sur le périmètre exact.
- **`/challenge`** : âge moyen (pas médian) — demande explicite documentée en commentaire.
- **`/rm`** : ne fait aucun calcul dans ce projet — s'appuie sur une carte Metabase existante (n°514) dont la logique est hors du périmètre auditable ici (voir NOTE-INDICATEURS.md, section `/rm`).

## 5. Fichiers modifiés dans le cadre de cet audit

- `src/lib/sql-rh.js` — renommage `taux_absence` → `taux_presence` (5 occurrences + commentaire d'en-tête).
- `public/rh.html` — renommage des libellés affichés (5 occurrences).
- `src/lib/sql-rd.js` — dénominateur `pct_moins_25` harmonisé (table RD + total).
- `src/lib/sql-rm-collecte.js` — dénominateur `pct_moins_25` harmonisé (table missions + total).
- `src/lib/sql-mission-suivi.js` — dénominateur `pct_moins_25` harmonisé (fil par jour).
- `NOTE-INDICATEURS.md` — sections `/direction` et `/rm` ajoutées (absentes de la note), section "Protection des clients exclus" ajoutée, formules `pct_moins_25`/`taux_absence` mises à jour partout où elles ont changé.

Tous les fichiers `.js`/scripts extraits des `.html` modifiés ont été vérifiés avec `node --check` (syntaxe OK). Toutes les requêtes modifiées ont été rejouées contre la base Metabase de production avant validation.
