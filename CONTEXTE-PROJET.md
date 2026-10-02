# Contexte projet — Dashboard CAE

Cette note sert de mémoire du projet : elle permet de demander une évolution dans une nouvelle conversation sans avoir à reprendre tout l'historique. À lire en premier avant toute nouvelle demande. À mettre en ressource/instruction du projet Claude.

## 1. C'est quoi

Un Worker Cloudflare unique qui sert ~17 dashboards internes (RH, suivi de mission, suivi RD/RE, vue client/association, direction, sites privés, mobilisation porte-à-porte...), tous branchés sur la même base Metabase (requêtes SQL natives).

- Déployé sur : `https://cae-dashboard.alexandrelecarpentier.workers.dev`
- Dépôt local : `/Users/alexandrelecarpentier/Desktop/Dashboard CAE`
- Page d'index listant tous les dashboards avec des exemples d'URL réels : `/all`

## 2. Architecture

- `src/index.js` : point d'entrée unique du Worker. Route chaque `/api/*` vers son handler, sert les fichiers statiques de `public/` sinon (`env.ASSETS.fetch(request)`).
- `src/lib/metabase.js` : exécute le SQL natif contre Metabase (`runQuery`) et gère la question Metabase toute faite utilisée par `/rm` (`runCardQuery`, carte n°514).
- `src/lib/sql-*.js` : un fichier par domaine, qui construit les requêtes SQL (pas d'ORM, tout est du SQL natif sur Postgres via l'API Metabase).
- `src/lib/excluded-clients.js` : liste des id client à exclure systématiquement (clients de test / internes) — appliquée par `excludeClientsClause()` sur les dashboards cross-missions, et par validation d'id amont sur les dashboards à id unique (`readClientId()` / `missionIsExcluded()`).
- `public/*.html` : un fichier HTML autonome par dashboard (CSS + JS inline, pas de framework). Chaque page appelle son `/api/...` en fetch, affiche les résultats côté client.

### Carte dashboard → route API → fichier SQL

| Dashboard (`public/`)         | Route API                                      | Fichier SQL                  |
|---|---|---|
| `client.html`                 | `/api/client`, `/api/facets`, `/api/client-missions`, `/api/mission-days` | `sql-client.js` |
| `mission.html`                | `/api/mission-suivi`                           | `sql-mission-suivi.js`, `sql-mission.js` |
| `rd.html`                     | `/api/rd`                                      | `sql-rd.js` |
| `re-collecte.html`            | `/api/re-collecte`                             | `sql-re-collecte.js` |
| `rm-collecte.html`            | `/api/rm-collecte`                             | `sql-rm-collecte.js` |
| `salarie.html`                | `/api/salarie`                                 | `sql-salarie.js` |
| `emplacement.html`            | `/api/emplacement`                             | `sql-emplacement.js` |
| `site-prive.html`             | `/api/site-prive`                              | `sql-site-prive.js` |
| `assistant-site-prive.html`   | `/api/assistant-site-prive`                    | `sql-site-prive.js` (réutilisé) |
| `rh.html`                     | `/api/rh`                                      | `sql-rh.js` |
| `direction.html`              | `/api/direction`                               | `sql-direction.js` |
| `re-mobilisation.html`        | `/api/re-mobilisation`                         | `sql-mobilisation.js` |
| `rd-mobilisation.html`        | `/api/rd-mobilisation`                         | `sql-mobilisation.js` |
| `challenge.html`              | `/api/challenge`                               | `sql-challenge.js` |
| `rm.html`                     | `/api/rm-missions`                             | — (carte Metabase 514 en dur, pas de SQL du projet) |
| `index.html`                  | — (page d'accueil)                             | — |
| `all.html`                    | — (index des dashboards, liens d'exemple)      | — |

## 3. Définitions des indicateurs

**`NOTE-INDICATEURS.md`** (racine du projet) est la référence : toutes les formules (taux réel, taux de transfo, taux de présence, pct_moins_25, score qualité...), harmonisées entre dashboards. Toujours vérifier ce fichier avant de modifier ou ajouter une formule, et le mettre à jour si une formule change.

`AUDIT-INDICATEURS-2026-09.md` est le rapport de l'audit complet mené en 9/2026 (bugs trouvés et corrigés, incohérences harmonisées). Historique, pas à maintenir au fil de l'eau — mais utile pour comprendre pourquoi certaines conventions ont été choisies (ex. dénominateur de `pct_moins_25`, exclusion de la journée en cours sur `/client`).

## 4. Mode staging

Depuis 10/2026, n'importe quel dashboard peut interroger la base Metabase **Staging** (id 4) au lieu de **Production** (id 3, par défaut) en ajoutant `?staging=1` à son URL. Le paramètre se propage automatiquement à tous les appels `/api/*` de la page (patch de `window.fetch` injecté en tête de chaque page). Un badge rouge « ◆ STAGING » s'affiche pour le signaler. `/all` liste la version staging de chaque dashboard.

Exception : `/rm` reste toujours branché sur Production, car il s'appuie sur une carte Metabase (514) liée en dur à sa base à la création — `?staging=1` n'a aucun effet dessus.

Mécanisme technique : `resolveDatabaseId(url)` dans `src/index.js` lit le paramètre et pose `env.METABASE_DATABASE_ID`, lu ensuite par `runQuery()` dans `metabase.js`.

## 5. Workflow pour toute modification (à appliquer systématiquement)

1. Modifier le(s) fichier(s) concerné(s) (`src/lib/sql-*.js`, `src/index.js`, `public/*.html`).
2. Vérifier la syntaxe : `node --check` sur les `.js`, et sur le JS extrait des `<script>` pour les `.html`.
3. Valider toute requête SQL nouvelle/modifiée contre Metabase (base Production, `database_id: 3`) avant de considérer que c'est fait.
4. Mettre à jour `NOTE-INDICATEURS.md` si une formule ou un filtre change.
5. `git add -A` puis donner la commande exacte de commit/push à l'utilisateur (voir ci-dessous) — **ne pas se contenter de dire que c'est prêt, toujours fournir la commande**.
6. Rappeler que le déploiement Cloudflare n'est **pas automatique** : il faut lancer `npx wrangler deploy` après le push.

Commande type à donner après chaque modification :

```
cd "/Users/alexandrelecarpentier/Desktop/Dashboard CAE"
rm -f .git/index.lock
git add -A
git commit -m "message décrivant le changement"
git push
```

(`rm -f .git/index.lock` est nécessaire car ce verrou reste parfois bloqué d'une session de terminal à l'autre — sans gravité, il suffit de le supprimer avant de relancer git.)

Puis, pour que le changement soit visible en ligne : `npx wrangler deploy`.

## 6. Points de vigilance connus

- `sql-mission.js` existe encore mais a été vidé de `buildMissionPerformanceQueries`/`buildRecruteurPerformanceQueries` (dashboards Metabase 15 retirés en 9/2026) : il ne sert plus qu'à des requêtes utilitaires mission par id/code, encore utilisées par `mission.html`.
- `/rm`'s "% < 25 ans" vient d'une carte Metabase externe (514) et n'a pas pu être vérifié comme suivant la même convention de dénominateur que le reste du projet (cf. audit 9/2026) — à garder en tête si un écart apparaît un jour sur ce chiffre précis.
- Les 3 clients exclus (tests internes) sont filtrés différemment selon le type de dashboard : clause SQL (`excludeClientsClause`) sur les vues cross-missions, validation d'id en amont sur les fiches à id unique. Si un nouveau dashboard est créé, penser à appliquer le bon mécanisme.

## 7. Comment formuler une demande d'évolution

Donner : le dashboard concerné (nom de fichier ou route), ce qui doit changer concrètement (un filtre, un indicateur, un libellé, une mise en page), et si besoin un exemple de résultat attendu. Pas la peine de redonner le contexte technique ci-dessus — cette note suffit.
