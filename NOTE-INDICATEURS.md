# Indicateurs — Dashboard CAE

## Définitions communes

- **Dons valides** : statut ∈ (`nouveau`, `en_attente`, `transmis`).
- **BS au sens large** : statut ∈ (`nouveau`, `en_attente`, `transmis`, `incomplet`, `annule`).
- **Heures de rue / heures rémunérées** : sommées uniquement sur les lots où `presence_recruteur` est `TRUE` ou `NULL` (exclus si `FALSE`).
- **Âge d'un donateur** : `(date de signature du don − date de naissance) / 365.0`, toujours calculé par rapport à `dons.created_at`, jamais par rapport à la date du jour.

---

## /client

- **Nb missions** : `count(distinct missions.id)` sur statut ∈ (`terminee`, `en_cours`, `en_attente`).
- **Nb dons** : `count(distinct dons.id)` (dons valides).
- **Don moyen** : `avg(dons.montant)` (dons valides).
- **Heures rue / heures rémunérées** : sommes sur les lots filtrés.
- **Taux réel** : `nb dons valides / heures de rue`.
- **Âge moyen** : `avg(âge)` (dons valides).
- **Tranche d'âge** (répartition) : `18-20` (18 ≤ âge < 21), `21-25` (21 ≤ âge < 26), `26-35` (26 ≤ âge < 36), `36-50` (36 ≤ âge < 51), `50 et +` (âge ≥ 51), `Autre` (âge inconnu).

## /mission (suivi de mission)

- **Taux réel par semaine** : `sum(dons valides) / sum(heures de rue)` par semaine.
- **Table équipe, camemberts âge/genre, bulletins/jour, dons suspects** : identiques à `/rd` (voir plus bas — réutilise les mêmes requêtes).
- **Taux réel par jour** : `bs_reel du jour / heures_rue du jour`.
- **Ratio heures (par jour)** : `heures_rue / heures_remuneration`.
- **Don moyen (par jour)** : `avg(montant)` des dons valides du jour.
- **% donateurs −25 ans (par jour)** : `100 × (nb dons valides avec âge < 25) / nb dons valides`.

## /rd (et repris par /re-collecte, /mission)

- **Taux de transformation (`tx_transfo`)** : `100 × BS réel / BS au sens large`.
- **Taux réel** : `BS réel / heures de rue`.
- **Don moyen** : `avg(montant)` (dons valides).
- **Âge médian** : médiane (`percentile_cont(0.5)`) de l'âge des donateurs (dons valides).
- **% donateurs −25 ans (`pct_moins_25`)** : `100 × (nb dons valides avec âge < 25) / BS réel`.
- **Ratio heures (`ratio_h`)** : `heures_rue / heures_rem`.
- **Taux d'absence** : `100 × heures rémunérées / (nombre de lots × 7)`.
- **Taux d'absence injustifiée** : `100 × jours d'absence injustifiée / (jours de présence + jours d'absence)`, où un jour d'absence est injustifié si son motif n'est ni "maladie" ni "autorisée" (ou motif absent).
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

- Reprend telles quelles les requêtes de `/rd` (table, âge, genre, bulletins/jour, motif de don suspect) et de `/mission` (taux réel par semaine).
- **Liste des bulletins suspects** : mêmes 13 règles de motif que `/rd`, sur le périmètre statut ∈ (`nouveau`, `en_attente`, `transmis`, `annule`).

## /rm-collecte

- **Nb RD** : `count(distinct utilisateur_id)` des lots de la mission.
- **Taux de transformation (`tx_transfo`)**, **Taux réel**, **Don moyen**, **Âge médian**, **% donateurs −25 ans (`pct_moins_25`)**, **Ratio heures (`ratio_h`)** : mêmes formules que `/rd`, agrégées par mission (et une ligne TOTAL toutes missions confondues).
- **Répartition par tranche d'âge** et **par genre** : mêmes formules que `/rd`.
- **Liste des bulletins suspects** : mêmes 13 règles de motif que `/rd`, sur le périmètre statut ∈ (`nouveau`, `en_attente`, `annule`) — les dons déjà `transmis` sont exclus (contrôle qualité considéré comme fait).

## /challenge

- **Top recruteurs (jour/semaine/dernière heure)** : classement par `count(distinct dons.id)` (dons valides), sur les missions `en_cours`.
- **Top équipes (semaine en cours)** : classement par taux réel = `sum(BS réel) / sum(heures de rue)`, du lundi de la semaine en cours à aujourd'hui.
- **Âge moyen par mission (classement)** : `avg(âge)` (dons valides) par mission `en_cours`, minimum 3 dons requis pour figurer au classement.
- **Recruteurs actifs du jour** : recruteurs ayant un lot daté d'aujourd'hui sur une mission `en_cours`.

## /salarie

- **Taux réel** : `BS réel / heures de rue`.
- **Taux h (`taux_h`)** : `heures de rue / heures rémunérées` (heures rémunérées limitées aux lots où `heures_remuneration_completes` est vrai ou non renseigné).
- **Taux d'absence** : `heures rémunérées / (nombre de lots × 7)`.
- **Don moyen** : `avg(montant)` (dons valides).
- **% donateurs +25 ans (`pct_plus_25`)** : `(nb dons valides avec âge ≥ 25) / (nb dons valides dont la date de naissance du donateur est connue)`.
- **Score qualité** : `don moyen × % donateurs +25 ans`.
- Les 5 indicateurs ci-dessus existent en 3 déclinaisons : par mission, en cumul sur toute la carrière ("résumé"), et en cumul sur les 270 dernières heures rémunérées déclarées ("statut global").

## /emplacement

- **Taux réel** (par mission ayant utilisé cet emplacement, et global tous jours confondus) : `BS réel / heures de rue`.
- **Don moyen** (par mission, et global) : `avg(montant)` (dons valides).
- **Nombre moyen de recruteurs par jour** : `avg(nb recruteurs distincts par jour)`.
- **Taux réel par jour de la semaine** (1=lundi..7=dimanche, toutes missions/années confondues) : `sum(BS réel du jour de semaine) / sum(heures de rue du jour de semaine)`.
- **Taux réel par mois calendaire** (1=janvier..12=décembre, toutes années confondues) : `sum(BS réel du mois) / sum(heures de rue du mois)`.

## /site-prive

(Périmètre : emplacements où `type_emplacement = 'prive'`.)

- **Taux réel** (global, par typologie d'emplacement, par enseigne, par jour d'activité, par période jour/semaine/mois) : `BS réel / heures de rue`, toujours en moyenne pondérée (somme des BS réels ÷ somme des heures).
- **Don moyen** (global, par typologie, par enseigne) : `avg(montant)` (dons valides).
- **Enseigne** : premier mot du nom de l'emplacement, en majuscules et sans accents.

## /rh

- **Taux réel** (global et par mission) : `BS réel / heures de rue`.
- **Taux d'absence** (global, par mission, par recruteur) : `heures rémunérées / (nombre de lots × 7)`.
- **Taux de complétion de saisie — présence** : `(nb lots où presence_recruteur est renseigné) / (nb lots total)`.
- **Taux de complétion de saisie — emplacement** : `(nb lots où emplacement_id est renseigné) / (nb lots total)`.
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
