# Dashboards CAE

Projet unique regroupant les 7 dashboards de suivi mission/recrutement :
client, salarié, emplacement, mission, RD, RM et le challenge recruteurs.
Cloudflare Pages + Pages Functions, données via Metabase (SQL natif sur la
base "Production").

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
public/            fichiers statiques servis tels quels (Cloudflare Pages)
functions/api/     un fichier = une route API (Pages Functions)
functions/lib/     code partagé : client Metabase, requêtes SQL, signature S3
```

- `functions/lib/metabase.js` — `runQuery` (SQL natif via `/api/dataset`),
  `runCardQuery` (question Metabase déjà construite, utilisée par `/rm.html`),
  validation des paramètres (`RE_UUID`, `sanitizeFreeText`).
- Les requêtes SQL interpolent des identifiants déjà validés par `RE_UUID`
  (jamais de valeur utilisateur brute) — voir le commentaire en tête de
  chaque `functions/lib/sql-*.js`.
- `functions/api/logo.js` — logos clients (bucket S3 Scaleway, URL signée
  SigV4), nécessite les secrets `SCW_ACCESS_KEY` / `SCW_SECRET_KEY`.

## Variables d'environnement (secrets Cloudflare Pages)

À configurer dans Cloudflare : projet Pages → Settings → Environment
variables (Production **et** Preview) :

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

### 3. Connecter Cloudflare Pages au dépôt (déploiement automatique)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Sélectionner le dépôt `cae-dashboard`
3. Build settings :
   - Framework preset : `None`
   - Build command : *(laisser vide)*
   - Build output directory : `public`
4. Ajouter les variables d'environnement ci-dessus (Production et Preview)
5. **Save and Deploy**

À partir de là, chaque `git push` sur `main` redéploie automatiquement.

### 4. Développement local (optionnel)

```bash
npm install
npm run dev     # wrangler pages dev public
```

Nécessite un fichier `.dev.vars` local (non commité, voir `.gitignore`) avec
les mêmes variables que ci-dessus pour tester les routes `/api/*` en local.

## Anciens projets

Ce projet remplace `cae-dashboard-client` (Cloudflare Pages) et
`rm-dashboard-final` (Cloudflare Worker) — leur code a été repris et
réorganisé ici plutôt que réécrit. Une fois ce projet déployé et validé, les
deux anciens déploiements peuvent être désactivés.
