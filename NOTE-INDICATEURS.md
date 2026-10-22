# Indicateurs — Dashboard CAE

Une ligne par indicateur : **ce qu'il mesure et comment il est calculé, en mots simples** → dashboards où il apparaît. Mise à jour 22/10/2026.

## Règles communes (valables pour tous les indicateurs)

- **Don valide** : un don dont le statut est « nouveau », « en attente » ou « transmis ». Les dons annulés ou incomplets ne comptent pas. **BS au sens large** (« BS rue ») : les dons valides + les dons incomplets + les dons annulés.
- **Jours pris en compte** : uniquement les jours passés ou le jour même, jamais les jours à venir. Si les heures rémunérées d'une journée n'ont pas encore été déclarées, cette journée est ignorée jusqu'au lendemain (le temps que l'équipe les saisisse). Exceptions : `/client` ignore toute la journée en cours ; `/challenge` ne retire rien (classement du jour).
- **Journée « présente »** : une journée où la personne a au moins une heure rémunérée.
- **Heures de rue** : les heures passées sur le terrain. Quand un recruteur est noté absent, ses heures de rue sont comptées 0 (il reste en base des heures « fantômes » pour ces journées, environ 5 500 h en 2026). Même règle que la question Metabase 486.
- **Clients exclus** : les clients de test et de démonstration ne sont jamais comptés, sauf sur `/rd`, `/re-collecte`, `/re-mobilisation` et `/rd-mobilisation`. Les missions de type « mobilisation » sont exclues de tout, sauf de `/re-mobilisation` et `/rd-mobilisation` (impossible à filtrer sur `/rm` et sur les cartes de `/rh-suivi` et `/rh-export`).
- **Mode staging** : ajouter `?staging=1` à l'adresse d'une page affiche les données de la base de test au lieu de la base réelle. `/rm` reste toujours sur la base réelle.
- **Âge d'un donateur** : son âge **le jour où il a signé son don** (pas son âge d'aujourd'hui). Si sa date de naissance n'est pas connue, il est rangé dans « Autre » pour les tranches d'âge et ignoré dans les pourcentages d'âge. La date de naissance est connue pour presque tous les dons de 2026, mais seulement pour environ 15 % des anciennes missions.

## Indicateurs

| Indicateur | Comment il est calculé | Dashboards |
|---|---|---|
| **BS réel** (= Nb dons) | Nombre de dons valides. | tous |
| **BS rue** | Nombre de dons au sens large (valides + incomplets + annulés). | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` |
| **Heures de rue** | Total des heures passées sur le terrain (voir règles communes). | tous sauf `/rm` |
| **Heures rémunérées** | Total des heures payées, uniquement sur les journées « présentes ». | `/client`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte`, `/rh`, `/salarie`, `/direction`, `/direction-suivi` |
| **Heures par salarié et par mission** | Heures rémunérées et heures de rue de chaque salarié présent (au moins une heure rémunérée) dans une mission, mêmes règles que ci-dessus. Vue en tableau sur `/rm-collecte` ; `/mission` affiche aussi les heures par RD et par journée. | `/rm-collecte`, `/mission` |
| **Taux réel** | Nombre de dons valides divisé par le nombre d'heures de rue (exemple : 0,250 = 1 don toutes les 4 heures). Affiché avec 3 décimales. Pour un groupe (équipe, mission…), on additionne d'abord tous les dons et toutes les heures, puis on divise — on ne fait pas la moyenne des taux individuels. | `/client`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte`, `/salarie`, `/rh`, `/direction`, `/direction-suivi`, `/emplacement`, `/site-prive`, `/assistant-site-prive`, `/challenge`, `/rm` (recalculé depuis la carte 514) |
| **Taux de transformation** | Part des dons valides parmi tous les dons signés : dons valides ÷ dons au sens large × 100. Affiché sans décimale. | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/rm` |
| **Don moyen** | Montant moyen des dons valides, en euros, avec 2 décimales. | tous sauf `/challenge`, `/mobilisation` |
| **Âge médian** | L'âge « du milieu » des donateurs : la moitié des donateurs est plus jeune, l'autre moitié plus âgée. Calculé sur les dons valides dont la date de naissance est connue. Affiché avec 1 décimale. | `/client`, `/challenge` (par mission, à partir de 3 dons), `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie` (global et par mission), `/direction`, `/direction-suivi` |
| **% donateurs −25 ans** | Part des donateurs qui avaient moins de 25 ans au moment du don, parmi les dons valides dont la date de naissance est connue. Affiché avec 1 décimale. | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie`, `/direction` |
| **Score qualité** | Don moyen × (100 % − part des −25 ans). Plus le don moyen est élevé et plus les donateurs sont âgés de 25 ans ou plus, plus le score monte. Barème : de 0 à 3 = très faible · 3 à 5,5 = faible · 5,5 à 6,5 = moyen · 6,5 à 8 = bon · plus de 8 = très bon. 2 décimales sur `/rm-collecte` et `/salarie`, 1 ailleurs. | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie` |
| **Ratio h** (heures de rue / rémunérées) | Heures de rue ÷ heures rémunérées, en %. Plus il est proche de 100 %, plus les heures payées ont été passées sur le terrain. Affiché avec 1 décimale. | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie`, `/direction`, `/direction-suivi` |
| **Taux de présence** | Part des journées prévues où la personne était présente : journées présentes ÷ journées prévues × 100 (100 % maximum). | `/rd`, `/re-collecte`, `/mission`, `/rh` |
| **% absence** | Part des journées prévues sans heure rémunérée (= 100 % − taux de présence). | `/direction-suivi` |
| **Taux d'absence** | Part des journées prévues de la personne où elle n'a aucune heure payée. Ne comptent pas comme absences (journées écartées du calcul, y compris du total des journées prévues) : maladie (dont longue durée et professionnelle), accident du travail ou de trajet, temps partiel thérapeutique, maternité, paternité, adoption, congés parental et de présence parentale, événement familial, maladie grave du conjoint, congés payés, repos compensateurs, formation et CIF, activité partielle et chômage partiel, absence rémunérée, congé sans solde, férié chômé non dû, absence non rémunérée autorisée (code 620). Restent comptées : journées sans heure payée et sans motif, retards, absences non rémunérées « logo » (code 1) ou non autorisées, mise à pied, préavis non effectué. | `/salarie` (global et par mission) |
| **Absentéisme** | 1 − (journées de présence hors arrêt maladie ÷ (journées de présence + journées d'absence)). Seules les absences pour maladie ne sont pas comptées comme absences. | `/direction` |
| **Présence des RD** (suivi quotidien) | Chaque jour : RD présents ÷ RD attendus × 100. Les RD attendus sont les recruteurs (hors responsable d'équipe) qui avaient une journée prévue ; ils sont présents s'ils ont des heures rémunérées. | `/rm-collecte` |
| **Nb lots** | Nombre de journées de travail (une journée = un lot) sur la période. | `/direction`, `/direction-suivi`, `/rd`, `/rh` |
| **Nb jours d'activité** | Nombre de dates différentes où il y a eu du travail (par site, emplacement ou mission). | `/site-prive`, `/assistant-site-prive`, `/emplacement`, `/direction` (avancement) |
| **Nb recruteurs** | Nombre de personnes différentes ayant travaillé, responsables d'équipe compris. | `/direction-suivi`, `/rm-collecte`, `/rh` |
| **Nb RD** | Nombre de recruteurs différents, sans le responsable d'équipe (RE). Affiché sous la forme « RD+RE » (ex. 3+1). Le grade RD / RDC / RDE vient du contrat le plus récent. | `/site-prive`, `/assistant-site-prive` ; grade sur `/direction` |
| **Nb missions** | Nombre de missions différentes ayant au moins une journée de travail sur la période. Sur `/client` : missions terminées, en cours ou en attente. | `/client`, `/direction`, `/direction-suivi`, `/site-prive` |
| **Villes de mission** | Villes principales des missions du salarié (contrat ou journée de travail), sans doublon même si la casse diffère. | `/salarie` |
| **Tranche d'âge** | Âge du donateur au moment du don, rangé en : 18-20 ans · 21-25 ans · 26-35 ans · 36-50 ans · 51 ans et plus · « Autre » (âge inconnu ou moins de 18 ans). | `/client`, `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` |
| **Genre** | Civilité du donateur : Hommes (« monsieur »), Femmes (« madame »), Autre/NC (non renseigné ou autre). Sur `/salarie`, c'est la part de chaque groupe parmi tous les dons valides, affichée « 45 % H · 55 % F » (le reste = Autre/NC), en global et par mission. | `/client`, `/rd`, `/re-collecte`, `/mission`, `/rm-collecte`, `/salarie` |
| **Bulletins par jour** | Nombre de dons valides signés chaque jour (et par RD). | `/client`, `/mission`, `/rd`, `/re-collecte`, `/rm-collecte` |
| **Dons suspects** | Un don est signalé dès qu'il déclenche l'une de ces 14 situations (la première qui s'applique est retenue) : don de test, donateur mineur, nom identique à celui du recruteur, coordonnées identiques à celles du recruteur, coordonnées d'un autre recruteur, montant de 100 € ou plus, pas d'email, téléphone non communiqué ou suspect, email mal orthographié ou faux, adresse de moins de 6 caractères, don saisi entre 20h et 9h ou un dimanche, donateur ayant plus de 5 dons. Sinon le motif est « Ok ». `/rd` et `/re-collecte` y ajoutent les dons annulés ; `/rm-collecte` ignore les dons déjà transmis. | `/rd`, `/re-collecte`, `/mission`, `/rm-collecte` |
| **Objectif / % atteint** | L'objectif de dons de la mission est réparti à parts égales sur les jours de travail. Objectif au prorata = objectif × jours déjà réalisés ÷ jours de la mission. % atteint = BS réel ÷ objectif. Sur `/rm-collecte`, on compare tous les dons depuis le début de la mission à l'objectif. | `/rm-collecte`, `/re-collecte`, `/direction` |
| **Taux de FPE** | Part des contrats qui ont un avenant de fin de période d'essai **publié** (un avenant seulement « signé » n'est pas compté). Sur `/rh` et `/rm-collecte`, séparé entre fins à l'initiative de l'employeur et du salarié ; sur `/direction`, un taux global. | `/rh`, `/rm-collecte`, `/direction` |
| **Badge FPE / début-fin de contrat** | Le badge « FPE » s'affiche si le contrat le plus récent du recruteur sur la mission comporte un avenant de fin de période d'essai **publié** (pas simplement signé) ; les dates affichées sont celles de ce contrat. | `/rd`, `/re-collecte`, `/mission`, `/rh` |
| **Taux de complétion emplacement** | Part des journées de travail pour lesquelles l'emplacement a été renseigné (1 décimale). | `/rh` |
| **Recrutements / candidatures** | Recrutements : nombre de contrats commençant sur la période. Candidatures : nombre de candidatures reçues dans TeamTailor, sans doublon. | `/rh` |
| **Délai de complétion d'équipe** | Nombre de jours entre le début de la mission et le début du contrat du dernier recruteur arrivé. | `/rh` |
| **Anciens / nouveaux, grades** | « Ancien » = a déjà fait au moins 3 missions. Le grade (RD, RDC, RDE) est celui du contrat le plus récent. | `/direction` |
| **Horaires 1er / dernier BS** | Heure (heure de Paris) du premier et du dernier don valide de la journée. | `/rm-collecte`, `/emplacement` |
| **Taux réel par jour de semaine / mois** | Taux réel (dons ÷ heures de rue, tous cumulés) calculé pour chaque jour de la semaine (1 = lundi) ou chaque mois. | `/emplacement` |
| **Classement sites / enseignes** | Les sites (ou enseignes) sont classés selon leur taux réel, calculé en cumulant dons et heures. Les sites sans heures sont écartés. | `/site-prive`, `/assistant-site-prive` |
| **Top recruteurs / équipes** | Recruteurs classés par nombre de dons (sur le jour, la semaine, la dernière heure) ; équipes classées par taux réel sur la semaine en cours ; uniquement les missions en cours. | `/challenge` |
| **Volume de dons par statut** | Nombre de dons créés sur la période, tous statuts confondus, séparés entre ceux saisis dans CozApp et ceux de l'ancien back-office (BO). | `/direction-suivi` |
| **Transmissions / dépôts / facturation** | Transmissions : dons valides créés sur la période, séparés entre « à transmettre » (nouveaux + en attente) et « transmis ». Dépôts : dons dont la date de transmission tombe dans la période. Facturation : dons transmis hors ancien back-office, par client et par type. | `/direction-suivi` |
| **Taux de rencontre** | Part des logements visités où quelqu'un a ouvert la porte, sans compter les logements « non conformes ». | `/re-mobilisation`, `/rd-mobilisation` |
| **Taux de traitement** | Logements visités ÷ nombre de logements de l'habitation. | `/re-mobilisation`, `/rd-mobilisation` |
| **Nb logements théorique / trouvés** | Théorique : nombre de logements annoncé. Trouvés : nombre de logements réellement comptés sur place. | `/re-mobilisation`, `/rd-mobilisation` |
| **Passages par logement** | Nombre moyen de passages par logement visité ; le statut affiché est celui du dernier passage. | `/re-mobilisation`, `/rd-mobilisation` |

## Formats d'affichage

Taux réel : 3 décimales · taux de transformation : sans décimale · ratio h, taux de présence, % −25 ans, taux de complétion : en %, 1 décimale · don moyen : en €, 2 décimales · âge médian : 1 décimale · comptages : nombres entiers.

## Réserves connues

- `/site-prive` et `/assistant-site-prive` : ne portent que sur les emplacements privés et les journées sans emplacement. Le « Taux réel mission » (`/site-prive`) et le récapitulatif « par mission » donnent les chiffres de la mission entière (comme `/mission`), quel que soit le filtre choisi (emplacement, ville, département). Les autres chiffres, classements et tableaux par site restent limités au filtre. Les journées sans emplacement n'apparaissent que dans les totaux (chiffres clés, récapitulatif mission, enseigne « Autres »), pas dans les tableaux par site ou par jour. `/assistant-site-prive` n'affiche rien tant qu'aucune mission n'est choisie.
- `/emplacement` : le « Taux réel mission » de chaque carte mission concerne la mission entière (tous emplacements, comme `/mission`). Le BS réel, le don moyen et les jours restent ceux de l'emplacement, et le « Taux réel emplacement » de chaque carte ne regarde que cette mission à cet emplacement. Le taux réel global de l'emplacement (toutes missions) est dans les chiffres clés de la fiche.
- `/rm-collecte` : la liste des RM regroupe les personnes par nom — quelqu'un qui a plusieurs comptes n'apparaît qu'une fois.
- Environ 900 journées en 2026 (surtout en sites privés) sont notées « recruteur absent » mais ont pourtant des heures rémunérées : elles restent comptées comme « présentes » pour le taux de présence.
- `/rm` reprend la carte Metabase 514 : ses formules (notamment le calcul du « % < 25 ans ») ne peuvent pas être vérifiées depuis ce projet.
- `/client` ignore la journée en cours, d'où un petit écart de taux réel avec les autres dashboards en cours de journée.
- Les calculs d'âge, de genre et de dons suspects de `/rd` et `/rm-collecte` ne tiennent pas encore compte de la règle « heures non déclarées ignorées le jour même » (effet limité à la journée en cours).
- Objectifs par jour : simple approximation, la base ne contient pas d'objectif journalier.
