# Dashboards CAE

Projet unique regroupant les 7 dashboards de suivi mission/recrutement :
client, salarié, emplacement, mission, RD, RM et le challenge recruteurs.
Cloudflare Worker (assets statiques + routes API), données via Metabase (SQL
natif sur la base "Production").

## Pages

| Page | URL | Scope |
|---|---|---|
| Accueil | `/` | Répertoire des dashboards |
| RM — vue globale | `/rm.html` | Toutes missions en cours, tous clients |
| Challenge | `/challenge.html` | Classements recruteurs (heure/jour/semaine) |
| Salarié | `/salarie.html?id_utilisateur=<uuid>` | Fiche individuelle RD/RE/RM |
| Emplacement | `/emplacement.html?id_emplacement=<uuid>` | Performance par lieu de rue |
| Client | `/client.html?id_client=<uuid>` | Une association, ses missions |
| Mission | `/mission.html?code_mission=<code>` | Détail d'une mission |
| RD | `/rd.html?id_mission=<uuid>&id_utilisateur=<uuid>` | Un recruteur, une mission |

`salarie.html` et `emplacement.html` incluent un écran de recherche quand le
paramètre d'URL est absent. `client.html`, `mission.html` et `rd.html` sont
accessibles uniquement par lien direct (fournis depuis la vue RM ou une autre
page) — pas encore de picker dédié.

## Architecture

```
public/            fichiers statiques servis tels quels (via le binding ASSETS)
src/index.js        point d'entrée du Worker : routage de toutes les /api/*
src/lib/            code partagé : client Metabase, requêtes SQL, signature S3
```

Ce projet est déployé sur Cloudflare comme un **Worker** (commande
`wrangler deploy`, pas `wrangler pages deploy`) — d'où un point d'entrée
unique `src/index.js` plutôt qu'un dossier `functions/` façon Pages
Functions. Le binding `ASSETS` (configuré dans `wrangler.toml`) sert les
fichiers de `public/` pour toute requête qui ne matche pas une route `/api/*`.

- `src/lib/metabase.js` — `runQuery` (SQL natif via `/api/dataset`),
  `runCardQuery` (question Metabase déjà construite, utilisée par `/rm.html`),
  validation des paramètres (`RE_UUID`, `sanitizeFreeText`).
- Les requêtes SQL interpolent des identifiants déjà validés par `RE_UUID`
  (jamais de valeur utilisateur brute) — voir le commentaire en tête de
  chaque `src/lib/sql-*.js`.
- Route `/api/logo` (dans `src/index.js`) — logos clients (bucket S3
  Scaleway, URL signée SigV4), nécessite les secrets `SCW_ACCESS_KEY` /
  `SCW_SECRET_KEY`.

Un dossier `functions/` (ancienne convention Pages Functions) subsiste dans
le dépôt mais n'est plus utilisé par le build — il peut être supprimé.

## Variables d'environnement (secrets du Worker)

À configurer dans Cloudflare : le service Worker `cae-dashboard` → Settings
→ Variables and Secrets (Production **et**, si utilisé, Preview) :

- `METABASE_URL` — ex. `https://prod.metabase.cae.captive.dev`
- `METABASE_API_KEY` — clé API Metabase
- `SCW_ACCESS_KEY` / `SCW_SECRET_KEY` — accès lecture seule au bucket S3 des
  logos clients (optionnel : sans ça, `/api/logo` répond une erreur claire au
  lieu de logos cassés silencieusement)

## Mise en route

### 1. Créer le dépôt GitHub

Sur GitHub, créer un nouveau dépôt **vide** (sans README, sans .gitignore —
ce projet les fournit déjà), par ex. `cae-dashboard`.

### 2. Pousser ce projet

Depuis ce dossier :

```bash
git init
git add .
git commit -m "Initial commit — dashboards CAE unifiés"
git branch -M main
git remote add origin https://github.com/<ton-compte>/cae-dashboard.git
git push -u origin main
```

### 3. Connecter le Worker au dépôt (déploiement automatique)

Le service Cloudflare `cae-dashboard` est déjà provisionné comme **Worker**
avec build Git ("Workers Builds") — déployer commande `npx wrangler deploy`.
Une fois ce dépôt poussé sur `main`, ce build doit fonctionner directement
puisque `wrangler.toml` définit maintenant `main = "src/index.js"`. Vérifier
seulement que les variables d'environnement ci-dessus sont bien renseignées
dans le service → Settings → Variables and Secrets.

### 4. Développement local (optionnel)

```bash
npm install
npm run dev     # wrangler dev
```

Nécessite un fichier `.dev.vars` local (non commité, voir `.gitignore`) avec
les mêmes variables que ci-dessus pour tester les routes `/api/*` en local.

## Anciens projets

Ce projet remplace `cae-dashboard-client` (Cloudflare Pages) et
`rm-dashboard-final` (Cloudflare Worker) — leur code a été repris et
réorganisé ici plutôt que réécrit. Une fois ce projet déployé et validé, les
deux anciens déploiements peuvent être désactivés.
