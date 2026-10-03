# Validation des indicateurs — Dashboard CAE (03/10/2026)

Périmètre de test : septembre 2026 (01/09 → 30/09), base **Production** (Metabase database 3), clients de test exclus. Chaque indicateur clé a été comparé à une **requête de référence indépendante écrite directement sur les tables** (`lots`, `missions`, `dons`, `donateurs`, `contrats`…), pas à une autre requête du projet.

## 1. Règles appliquées (validées avec Alex)
| Règle | Définition |
|---|---|
| Don valide | statut ∈ `nouveau`, `en_attente`, `transmis` |
| Présence d'un lot | `heures rémunérées ≠ 0` (`presence_recruteur` n'est plus jamais utilisé) |
| Heures (rue / rémunérées) | sommées uniquement sur les lots présents |
| Taux de présence | jours présents / nombre de jours (lots) → **≤ 100 %** |
| Lots futurs | exclus partout (`date <= CURRENT_DATE`) : les lots sont pré-créés sur toute la mission |
| Âge | (date du don − naissance) / 365,25 |
| Absentéisme (/direction) | absences hors motif « maladie » / (présences + absences) |
| Taux réel | BS réel / heures de rue |

## 2. Résultats de validation (chiffre builder = chiffre référence)
| Dashboard | Requêtes exécutées | Valeurs vérifiées (builder = référence) |
|---|---|---|
| /direction | 4/4 | 3 259 lots ; 2 628 présents ; 631 absents ; 12 278,58 h rue ; 5 334 BS ; taux réel 0,4344 ; âge médian 25,203 ; % ≥ 25 ans 0,5135 ; absentéisme 0,16876 (550/3 259) ; 266 recruteurs actifs ; 237 contrats / 60 FPE |
| /rh | 14/14 | mêmes totaux que /direction ; taux de présence 80,64 % (2 628/3 259) ; max par recruteur 100 % ; 237 contrats (3 granularités) ; 1 719 candidatures ; 17 lignes /mission 26GP007MON = /rd |
| /rd (26GP007MON) | toutes | 218 lots = 170 présents + 48 absents ; 772,25 h rue ; 1 158,25 h rém ; 407 BS réel ; don moyen 11,447 ; âge médian 24,4 ; % < 25 ans 56,8 ; pies âge/genre = 407 |
| /mission, /re-collecte | toutes | SQL identiques à /rd (vérifié en node) ; weekly 4 semaines = 407 BS ; dayStats 17 jours = 407 BS ; suspects : 407 dons, aucun doublon |
| /rm-collecte | 5/6 | ligne mission = ligne TOTAL de /rd ; suiviJour 17 jours, 154 présents + 16 RE = 170 ; BS 407 ; âge 407 ; genre 407 ; FPE 21 contrats |
| /client (Greenpeace) | 11 | 798 dons ; 1 714,75 h rue ; 2 440,75 h rém ; don moyen 11,5752 ; genre 798 ; tranches 798 ; 768 BS transmis |
| /emplacement (Montpellier) | 6/6 | 22 jours ; 948,75 h ; 448 BS ; taux 0,4722 ; ventilation par mission/jour/mois = totaux |
| /salarie (A. Picaud) | 6/6 | 50 lots dont 42 présents (84 %) ; 280 h rém ; 168 BS ; 166 BS / 273 h sur le statut global |
| /site-prive | 9/9 | 167 emplacements ; 4 792,25 h ; 2 153 BS ; taux 0,4493 ; enseigne/mission/jour/semaine/mois réconciliés exactement |
| /challenge | 6/6 | 27 BS semaine = référence ; syntaxe et plausibilité (dépend de `current_date`) |
| /mobilisation | 6/7 | 1 383 logements visités ; 858 portes ouvertes ; taux de rencontre 0,66 (858 / (1 383 − 83)) |

Aucune erreur SQL, aucune division par zéro, aucun taux de présence > 100 %. Environ 90 requêtes générées, une quarantaine d'appels Metabase.

## 3. Correctif du jour (signalé par Alex)
`/mission?id_mission=55bc04fe-…` : taux de présence 20 % sur la mission entière vs 100 % sur la semaine 1.
- **Cause** : les lots sont créés d'avance pour tout le mois (25 lots par RD, 20 dans le futur) → 5 présents / 25 lots = 20 %.
- **Correctif** : lots futurs exclus dans `sql-rd.js`, `sql-rh.js`, `sql-direction.js`, `sql-salarie.js`, `sql-rm-collecte.js`.
- **Vérification** : mission entière = 41 présents / 41 lots = **100 %**, identique à la semaine 1.

## 4. Points ouverts (non corrigés — décisions à prendre)
| # | Sujet | Gravité |
|---|---|---|
| A13 | `/direction` objectifMissions : `limit 300` tronque 1 191 missions → avancement non représentatif | Importante |
| A3 | taux réel arrondi à 2 décimales dans /rd, /mission (convention : 3) → 0,527 s'affiche 0,53 | Moyenne |
| A9 | `/client` nb_missions : 9 au lieu de 4 (recouvrement de période absent) | Moyenne |
| A6/A10 | tranches d'âge : trous aux bornes (1 don en « Autre » ; filtre « Autre » ≠ graphe) | Faible |
| A1 | `/salarie` taux_h : heures rue incluent les lots « heures non complètes », heures rém. les excluent (0,818 vs 0,776) | À trancher |
| A4/A5 | bulletins/jour sur `created_at` plutôt que date du lot ; `donateur_stats` compte des lignes donateurs | Faible |
| A2/A11 | classements sans seuil d'heures minimal (taux jusqu'à 1,5) ; listes tronquées 100/300 | Faible |
| A7/A8/A12/A14 | libellés `nb_rd` vs « RD attendus » ; objectif/jour sur toute la mission ; FPE 61 vs 60 ; vue RD mobilisation | Mineure |

## 5. Limites de la validation
- Pour /client, suspects de /rm-collecte et variantes filtrées RD, une version agrégée équivalente (mêmes CTE) a été exécutée et non le texte littéral.
- `suspectsList` de /rm-collecte et `rdInfoQuery` (mobilisation) : syntaxe seulement.
- /challenge repose sur `current_date` : plausibilité, pas de comparaison à un mois figé.
- **`/rm` (carte Metabase 514)** : non vérifiée (hors code du projet).
- Le correctif « lots futurs » a été testé sur la mission signalée ; les autres dashboards ont été validés avant ce correctif (septembre étant passé, il ne change pas leurs résultats, mais un re-test post-déploiement est recommandé).
- Les écrans eux-mêmes (rendu HTML) n'ont pas été testés ; la validation porte sur le SQL et les API.
- Tests faits sur Production uniquement (pas Staging).
