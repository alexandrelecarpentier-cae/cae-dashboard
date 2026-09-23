# Indicateurs — Dashboard CAE

## Définitions communes

- **Dons valides** : statut ∈ (`nouveau`, `en_attente`, `transmis`).
- **BS au sens large** : statut ∈ (`nouveau`, `en_attente`, `transmis`, `incomplet`, `annule`).
- **Heures de rue / heures rémunérées** : sommées uniquement sur les lots où `presence_recruteur` est `TRUE` ou `NULL` (exclus si `FALSE`).
- **Âge d'un donateur** : `(date de signature du don − date de naissance) / 365.0`, toujours calculé par rapport à `dons.created_at`, jamais par rapport à la date du jour.
- **Score qualité** : `don moyen × % donateurs +25 ans`, calculé sur les dons valides. Barème identique sur tous les dashboards qui l'affichent (`/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie`) :
  - 0 à 3 : Très Faible
  - 4 à 5,5 : Faible
  - 5,5 à 6,5 : Moyen
  - 6,5 à 8 : Bon
  - 8 et plus : Très Bon

## Conventions de format d'affichage

Règles communes à tous les dashboards (demande explicite, 9/2026) ; les écarts encore présents sur des indicateurs non listés ci-dessous n'ont pas été touchés (hors périmètre de la demande) :

- **Taux réel** : toujours affiché brut (pas un pourcentage), sur **3 décimales** (ex : `0,354`).
- **Taux de transformation (`tx_transfo`)** : affiché en pourcentage **arrondi à l'unité**, sans décimale (ex : `74 %`).
- **Ratio heures rue / heures rémunérées (`ratio_h`, `taux_h`)** : converti en pourcentage et affiché à **1 décimale** (ex : `71,0 %` pour un ratio brut de 0,71), et non plus comme un nombre décimal brut.
- **Taux de présence / taux d'absence, % donateurs (−25 ans, +25 ans), taux de complétion, taux de FPE** : pourcentages à **1 décimale**.
- **Don moyen** : euros à **2 décimales** (ex : `18,42€`).
- **Âge moyen / âge médian** : entier (0 décimale) sur `/client` (âge moyen) ; 1 décimale sur `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` (âge médian).
- **Score qualité** : nombre brut à 1 ou 2 décimales selon le dashboard (2 sur `/rm-collecte`, 1 ailleurs), toujours accompagné du badge textuel du barème ci-dessus (Très faible/Faible/Moyen/Bon/Très bon).
- **Comptages** (nb dons, nb missions, BS réel/rue/suspects, nb recruteurs, etc.) : entiers, sans décimale.

---

## /client

- **Nb missions** : `count(distinct missions.id)` sur statut ∈ (`terminee`, `en_cours`, `en_attente`).
- **Nb dons** : `count(distinct dons.id)` (dons valides).
- **Don moyen** : `avg(dons.montant)` (dons valides).
- **Heures rue / heures rémunérées** : sommes sur les lots filtrés.
- **Taux réel** : `nb dons valides / heures de rue` (affiché brut, 3 décimales).
- **Âge moyen** : `avg(âge)` (dons valides), affiché arrondi à l'entier.
- **Tranche d'âge** (répartition) : `18-20` (18 ≤ âge < 21), `21-25` (21 ≤ âge < 26), `26-35` (26 ≤ âge < 36), `36-50` (36 ≤ âge < 51), `50 et +` (âge ≥ 51), `Autre` (âge inconnu).
- **Journée en cours toujours exclue** : tous les indicateurs basés sur les lots/dons (heures, nb dons, don moyen, taux réel, âge moyen, tranches d'âge, graphes bulletins, tableau "Suivi des missions"...) n'incluent jamais la date du jour, quel que soit le filtre de période choisi (données du jour incomplètes/non fiables tant qu'il n'est pas terminé). Le raccourci de période "Aujourd'hui" a été retiré du dashboard pour cette raison (demande explicite, 9/2026).
- Bloc infos mission + résultats globaux figé (sticky) sous le header au scroll ; taux réel positionné en dernier dans le bloc KPI (demandes explicites, 9/2026).
- Camemberts genre et tranche d'âge : pourcentage de chaque part affiché dans la légende et l'infobulle (1 décimale), également ajouté à l'export CSV "Profil des donateurs". Les dons dont l'âge du donateur est inconnu restent comptés dans "Autre" plutôt qu'exclus (cf. audit de complétude ci-dessous).
- Filtres : passent sur plusieurs lignes plutôt que défiler horizontalement sur les écrans de moins de 720px de large.
- **Complétude des données d'âge** : l'âge d'un don dépend de `donateurs.date_de_naissance`, disponible seulement quand `dons.donateur_id` est renseigné. Or ce champ est resté vide pour la quasi-totalité des dons antérieurs à 2025 (migration de données) : 100 % des dons de 2017 à 2024 n'ont pas de `donateur_id`, contre 0,2 % en 2026 (quasi complet). Sur les missions actives ("en_cours"), la couverture est de 100 % ; elle tombe à ~15 % sur les missions terminées plus anciennes. Aucune clé de correspondance alternative fiable n'existe pour récupérer ces dons a posteriori (`old_cae_don_id` ne recouvre que ~100 dons sur les 348 000 concernés). La requête elle-même (LEFT JOIN) n'exclut aucun don : ceux sans âge connu sont comptés dans la tranche "Autre" plutôt qu'omis.

## /mission (suivi de mission)

- **Taux réel par semaine** : `sum(dons valides) / sum(heures de rue)` par semaine.
- **Table équipe, camemberts âge/genre, bulletins/jour, dons suspects** : identiques à `/rd` (voir plus bas — réutilise les mêmes requêtes).
- **Taux réel par jour** : `bs_reel du jour / heures_rue du jour` (affiché brut, 3 décimales).
- **Ratio heures (par jour)** : `heures_rue / heures_remuneration` (affiché en pourcentage, 1 décimale).
- **Don moyen (par jour)** : `avg(montant)` des dons valides du jour.
- **% donateurs −25 ans (par jour)** : `100 × (nb dons valides avec âge < 25) / nb dons valides`.

## /rd (et repris par /re-collecte, /mission)

- **Taux de transformation (`tx_transfo`)** : `100 × BS réel / BS au sens large` (affiché en pourcentage arrondi à l'unité).
- **Taux réel** : `BS réel / heures de rue` (affiché brut, 3 décimales).
- **Don moyen** : `avg(montant)` (dons valides), affiché en euros à 2 décimales.
- **Âge médian** : médiane (`percentile_cont(0.5)`) de l'âge des donateurs (dons valides), affiché à 1 décimale.
- **% donateurs −25 ans (`pct_moins_25`)** : `100 × (nb dons valides avec âge < 25) / BS réel` (affiché en pourcentage, 1 décimale).
- **Ratio heures (`ratio_h`)** : `heures_rue / heures_rem` (affiché en pourcentage, 1 décimale — ex : `71,0 %`).
- **Taux de présence** (champ `taux_presence` ; anciennement nommé à tort "taux d'absence" — corrigé le 9/2026, la formule mesure bien une présence : plus la valeur est haute, plus la personne est présente sur les heures prévues, ce qui est l'inverse de ce que le nom "absence" laissait penser) : `100 × heures rémunérées / (nombre de lots × 7)` (affiché en pourcentage, 1 décimale).
- **Taux d'absence injustifiée** : `100 × jours d'absence injustifiée / (jours de présence + jours d'absence)`, où un jour d'absence est injustifié si son motif n'est ni "maladie" ni "autorisée" (ou motif absent). Celui-ci, contrairement au précédent, mesure bien une absence. Affiché en pourcentage, 1 décimale.
- **Score qualité** : `don moyen × % donateurs +25 ans` (voir barème commun dans Définitions communes) ; affiché à 1 décimale, accompagné du badge textuel du barème.
- **Badge FPE** : `'FPE'` si le contrat le plus récent du recruteur sur la mission porte un avenant de catégorie `fin_period_essai`.
- **Répartition par tranche d'âge** : mêmes bornes que `/client` (18-20, 21-25, 26-35, 36-50, 50+).
- **Répartition par genre** : `Hommes` (civilité = monsieur), `Femmes` (civilité = madame), `Autre/NC` sinon.
- **Bulletins par jour** : `count(distinct dons.id)` (dons valides) groupé par jour et par RD.
- **Motif de don suspect** (13 règles, dans l'ordre de priorité — la première qui matche l'emporte) :
  1. `🧪 Test` — email/prénom/nom du donateur contient "test".
  2. `🚨 Donateur mineur` — date de naissance postérieure à (date du don − 18 ans).
  3. `🚩 Suspicion fraude` — nom du donateur = nom du recruteur actuel.
  4. `🆔 Coordonnées du recruteur` — email ou téléphone du donateur = email/téléphone du recruteur actuel.
  5. `🆔 Coordonnées d'un autre recruteur` — email/téléphone du donateur = email/téléphone d'un autre recruteur (tiers).
  6. `⚠️ Montant élevé` — montant ≥ 100.
  7. `🚫 Donateur sans email` — email contient "nomail".
  8. `📵 Téléphone non communiqué` — téléphone = `0000000000` ou motif `0[067]0000000`.
  9. `✏️ Email mal orthographié` — format d'email invalide, ou domaine dans une liste de fautes courantes (gamil.com, gmai.com, etc.).
  10. `📧 Faux email` — domaine jetable (yopmail, tempmail, mailinator, etc.).
  11. `📱 Téléphone suspect` — 6 chiffres identiques consécutifs ou plus dans le numéro.
  12. `🏠 Adresse trop courte` — adresse < 6 caractères.
  13. `🌙 Don hors heures ouvrées` — créé entre 20h et 9h ou un dimanche (uniquement pour les dons non issus de l'ancien système).
  14. `👥 Donateur multiple` — le donateur (par email) a plus d'un don au total.
  15. Sinon `✅ Ok`.
  - Un don est compté "suspect" si son motif ≠ `✅ Ok`, sauf `👥 Donateur multiple` qui n'est retenu que si le donateur a strictement plus de 5 dons au total.

## /re-collecte

- Reprend telles quelles les requêtes de `/rd` (table, âge, genre, bulletins/jour, motif de don suspect, taux de présence) et de `/mission` (taux réel par semaine).
- Sur `/re-collecte` et `/mission`, possibilité de filtrer sur un RD en cliquant sur sa ligne dans la table équipe, en plus du select déjà existant (demande explicite, 9/2026).
- **Liste des bulletins suspects** : mêmes 13 règles de motif que `/rd`, sur le périmètre statut ∈ (`nouveau`, `en_attente`, `transmis`, `annule`). Colonnes affichées (restreint le 9/2026, demande explicite) : Date / Statut / Motif / Montant / Donateur / RD (prénom + NOM) — l'adresse et l'email du donateur ne sont ni affichés ni remontés par la requête.

## /rm-collecte

- **Nb RD** : `count(distinct utilisateur_id)` des lots de la mission.
- **Taux de transformation (`tx_transfo`)**, **Taux réel**, **Don moyen**, **Âge médian**, **% donateurs −25 ans (`pct_moins_25`)**, **Ratio heures (`ratio_h`)** : mêmes formules et mêmes formats d'affichage que `/rd` (voir ci-dessus), agrégées par mission (et une ligne TOTAL toutes missions confondues). Possibilité de filtrer la table "Suivi des missions" sur une seule mission en cliquant sur sa ligne (demande explicite, 9/2026).
- **Répartition par tranche d'âge** et **par genre** : mêmes formules que `/rd`.
- **Liste des bulletins suspects** : mêmes 13 règles de motif que `/rd`, sur le périmètre statut ∈ (`nouveau`, `en_attente`, `annule`) — les dons déjà `transmis` sont exclus (contrôle qualité considéré comme fait).

## /challenge

- **Top recruteurs (jour/semaine/dernière heure)** : classement par `count(distinct dons.id)` (dons valides), sur les missions `en_cours`.
- **Top équipes (semaine en cours)** : classement par taux réel = `sum(BS réel) / sum(heures de rue)`, du lundi de la semaine en cours à aujourd'hui.
- **Âge moyen par mission (classement)** : `avg(âge)` (dons valides) par mission `en_cours`, minimum 3 dons requis pour figurer au classement.
- **Recruteurs actifs du jour** : recruteurs ayant un lot daté d'aujourd'hui sur une mission `en_cours`.

## /salarie

- **Taux réel** : `BS réel / heures de rue` (affiché brut, 3 décimales).
- **Taux h (`taux_h`)** : `heures de rue / heures rémunérées` (heures rémunérées limitées aux lots où `heures_remuneration_completes` est vrai ou non renseigné), affiché en pourcentage, 1 décimale.
- **Taux d'absence** : `heures rémunérées / (nombre de lots × 7)`, affiché en pourcentage, 1 décimale.
- **Don moyen** : `avg(montant)` (dons valides), affiché en euros à 2 décimales.
- **% donateurs +25 ans (`pct_plus_25`)** : `(nb dons valides avec âge ≥ 25) / (nb dons valides dont la date de naissance du donateur est connue)`, affiché en pourcentage, 1 décimale.
- **Score qualité** : `don moyen × % donateurs +25 ans` (voir barème commun dans Définitions communes), affiché à 1 décimale avec le badge du barème.
- Les 5 indicateurs ci-dessus existent en 3 déclinaisons : par mission, en cumul sur toute la carrière ("résumé"), et en cumul sur les 270 dernières heures rémunérées déclarées ("statut global").
- Note : le "Taux d'absence" ci-dessus utilise la même formule que le "Taux de présence" de `/rd`/`/re-collecte`/`/mission` (`heures rémunérées / (nombre de lots × 7)`) — non renommé ici, la correction de nom demandée portait explicitement sur `/rd`, `/re-collecte` et `/mission`. Idem pour `/rh`.

## /emplacement

- **Taux réel** (par mission ayant utilisé cet emplacement, et global tous jours confondus) : `BS réel / heures de rue` (affiché brut, 3 décimales).
- **Don moyen** (par mission, et global) : `avg(montant)` (dons valides), affiché en euros à 2 décimales.
- **Nombre moyen de recruteurs par jour** : `avg(nb recruteurs distincts par jour)`.
- **Taux réel par jour de la semaine** (1=lundi..7=dimanche, toutes missions/années confondues) : `sum(BS réel du jour de semaine) / sum(heures de rue du jour de semaine)`.
- **Taux réel par mois calendaire** (1=janvier..12=décembre, toutes années confondues) : `sum(BS réel du mois) / sum(heures de rue du mois)`.

## /site-prive

(Périmètre : emplacements où `type_emplacement = 'prive'`.)

- **Taux réel** (global, par typologie d'emplacement, par enseigne, par mission, par site, par jour d'activité, par période jour/semaine/mois) : `BS réel / heures de rue`, toujours en moyenne pondérée (somme des BS réels ÷ somme des heures). Affiché brut, 3 décimales.
- **Don moyen** (global, par typologie, par enseigne, par mission, par site) : `avg(montant)` (dons valides), affiché en euros à 2 décimales.
- **Enseigne** : premier mot du nom de l'emplacement, en majuscules et sans accents.
- **Filtres ville / département** (demande explicite, 9/2026) : ville = `emplacements.ville` exacte ; département = 2 premiers chiffres de `emplacements.code_postal` (3 premiers pour les DOM 97x/98x). Ne distingue pas 2A/2B (Corse), tous deux sous "20".
- **Récap par mission** (demande explicite, 9/2026) : une ligne par mission du périmètre filtré (nb d'emplacements couverts, heures rue, BS réel, taux réel, don moyen) — vue globale, pas de détail par site.
- **Classement des sites privés** (demande explicite, 9/2026) : un site par ligne, taux réel = moyenne pondérée sur la période sélectionnée (filtre Du/Au), triés par taux réel décroissant — permet d'identifier le meilleur SP sur une période donnée (ex. le mois en cours). Sites sans heure de rue sur la période exclus.
- **RD / RE par emplacement/jour/mission** (table "Emplacements", demande explicite, 9/2026 — utilisé par /assistant-site-prive) : nb_rd/nb_re = recruteurs distincts présents ce jour-là, différenciés selon qu'ils sont ou non `missions.responsable_equipe_id` (même logique que le rôle affiché sur /salarie).

## /assistant-site-prive

Version restreinte de `/site-prive` à destination des ASP (assistant(e)s site privé), demande explicite 9/2026. Mêmes formules que `/site-prive` (voir ci-dessus), mais :

- **Filtres** : recherche par code mission + dates (Total/Aujourd'hui/Hier/Du-Au) + recherche par site privé uniquement. Pas de filtre association, ville ou département.
- **Pas d'accès** aux statistiques globales par ville, par département, au récap "toutes missions confondues", ni au filtre association — restriction appliquée côté serveur (`/api/assistant-site-prive` ignore tout paramètre id_client/ville/departement, même envoyé manuellement), pas seulement côté affichage.
- **Effectif RD+RE par emplacement/jour/mission** (table "Emplacements") : affiché au format "3+1" (3 recruteurs + 1 responsable d'équipe), pour vérifier l'effectif présent sans ouvrir les diagrammes de performance de la mission. RE = personne dont l'`utilisateur_id` correspond au `responsable_equipe_id` de la mission ce jour-là ; tous les autres recruteurs distincts présents sont comptés en RD.

## /rh

- **Taux réel** (global et par mission) : `BS réel / heures de rue` (affiché brut, 3 décimales).
- **Taux d'absence** (global, par mission, par recruteur) : `heures rémunérées / (nombre de lots × 7)` (affiché en pourcentage, 1 décimale). Note : même remarque que sur `/salarie` — cette formule mesure en réalité une présence (voir la correction faite sur `/rd`/`/re-collecte`/`/mission`), non renommée ici car hors du périmètre demandé.
- **Taux de complétion de saisie — présence** : `(nb lots où presence_recruteur est renseigné) / (nb lots total)`, affiché en pourcentage, 1 décimale.
- **Taux de complétion de saisie — emplacement** : `(nb lots où emplacement_id est renseigné) / (nb lots total)`, affiché en pourcentage, 1 décimale.
- **Taux de FPE** (global, par initiative employeur/salarié) : `nb contrats avec avenant "fin de période d'essai" (par initiative) / nb contrats du périmètre`, basé sur `contrats.date_debut`.
- **Nb recrutements par jour/semaine/mois** : `count(distinct contrats.id)` par période, sur `contrats.date_debut`.
- **Nb candidatures par jour/semaine/mois** : nb d'événements `candidate.create` distincts (dédupliqués par id candidat) reçus de TeamTailor, par période.
- **Délai de complétion d'équipe** : `date de début de contrat du dernier recruteur arrivé sur la mission − date de début de la mission`.
- **Badge FPE par recruteur** : `'FPE'` si le contrat le plus récent du recruteur sur la mission porte un avenant de catégorie `fin_period_essai`.
- **Don moyen par recruteur** (table détail mission) : `avg(montant)` (dons valides).

## /mobilisation (re-mobilisation, rd-mobilisation)

- **Statut d'un logement** : statut de son passage le plus récent.
- **Nb logements théorique / trouvés** : `sum(habitations.nombre_logements)` / `sum(habitations.logements_count)` sur les habitations de la mission.
- **Taux de rencontre** : `nb passages "porte ouverte" / (nb logements visités − nb logements "non conforme")`.
- **Taux de traitement** (par habitation) : `nb logements visités / logements_count de l'habitation`.
- **Nombre moyen de passages par logement** : `avg(logements.passages_count)` sur les logements visités.
