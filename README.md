# JIRAMA Share

Application web de **répartition transparente des factures JIRAMA** entre plusieurs logements (étages,
appartements, boutique, studio, parties communes…) qui partagent un même compteur principal.

- Nombre de consommateurs **dynamique** ; sous-compteurs facultatifs.
- Méthodes : sous-compteur (exact ou proratisé), par différence, part égale, part pondérée, estimation manuelle.
- Le montant **réellement facturé** par JIRAMA (tranches, taxes, TVA, prime fixe compris) est réparti au prorata
  des kWh : aucun recalcul artificiel des tranches par logement.
- **Provenance** de chaque valeur conservée et affichée : Mesuré, Proratisé, Estimé, Manuel, Calculé.
- Répartitions **versionnées** (jamais écrasées), détail de chaque calcul, journal d'audit.
- Photos des compteurs et factures, lecture automatique facultative **toujours confirmée par un humain**.
- Message WhatsApp (malgache + français) et rapport A4 imprimable.

> Principe : l'application ne modifie jamais silencieusement un relevé réel pour obtenir un résultat.

Documentation détaillée : [architecture et modèle de données](docs/ARCHITECTURE.md) ·
[formules du moteur de répartition](docs/BILLING_ENGINE.md).

## Sommaire

1. [Stack](#stack)
2. [Démarrage local](#démarrage-local)
3. [Variables d'environnement](#variables-denvironnement)
4. [Base de données et migrations](#base-de-données-et-migrations)
5. [Tests, vérifications et build](#tests-vérifications-et-build)
6. [Configuration Supabase](#configuration-supabase)
7. [Déploiement sur o2switch](#déploiement-sur-o2switch)
8. [Premier super-administrateur](#premier-super-administrateur)
9. [Sauvegarde et restauration](#sauvegarde-et-restauration)
10. [Lecture automatique des photos](#lecture-automatique-des-photos)
11. [Dépannage](#dépannage)

## Stack

100 % TypeScript (`strict`). Un **seul processus Node.js** sert l'API (`/api/*`) et le frontend compilé.

| Couche | Technologies |
| --- | --- |
| Frontend | React 19, Vite 7, Tailwind CSS 4 (composants façon shadcn/ui), TanStack Query, React Hook Form, Zod, Recharts |
| Backend | Fastify 5, Zod, Pino, Helmet, rate-limit, multipart |
| Données | Supabase PostgreSQL via le pooler Supavisor, Drizzle ORM, postgres.js |
| Fichiers | Supabase Storage (bucket privé) |
| Tests | Vitest, PGlite (PostgreSQL embarqué) |

Node.js **20.12 ou plus** (22 recommandé).

## Démarrage local

Aucun serveur PostgreSQL n'est nécessaire en local : la base embarquée PGlite est créée et migrée
automatiquement.

```bash
npm install
cp .env.example .env
```

Dans `.env`, pour le développement :

```dotenv
NODE_ENV=development
APP_URL=http://localhost:5173
DATABASE_URL=pglite:./.data/pglite
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=.data/uploads
COOKIE_SECURE=false
LOG_LEVEL=debug
```

Puis :

```bash
npm run db:seed:dev   # bâtiment de démonstration « Mangarivotra » + super-administrateur
npm run dev           # API sur :3000, interface sur http://localhost:5173
```

Le seed affiche l'e-mail et un mot de passe provisoire (ou utilise `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).
Il contient la facture d'octobre 2026 (443 kWh, 328 798,76 Ar + 3 770 Ar d'eau), les relevés réels des
sous-compteurs et une répartition d'exemple (RDC 168 kWh et 2e 164 kWh **estimés**, 1er étage par différence
= 111 kWh). Le seed est idempotent.

Pour développer contre Supabase plutôt que PGlite, renseignez `DATABASE_URL` (pooler) puis lancez
`npm run db:migrate:dev`.

## Variables d'environnement

Toutes les valeurs sensibles sont dans `.env` (jamais versionné) ou dans les variables de l'application Node
d'o2switch. Modèle complet et commenté : [`.env.example`](.env.example).

| Variable | Obligatoire | Description |
| --- | --- | --- |
| `NODE_ENV` | | `production` en ligne |
| `APP_URL` | ✓ | `https://jirama.gasycoder.com` : origine autorisée (CORS, CSRF) |
| `DATABASE_URL` | ✓ | URL du **pooler** Supabase (ou `pglite:…` en local) |
| `MIGRATION_DATABASE_URL` | | URL utilisée par les migrations (Session pooler recommandé) |
| `DATABASE_SSL` | | `auto` (défaut), `require`, `verify-full`, `disable` |
| `DATABASE_POOL_MAX` | | Connexions simultanées (défaut 5) |
| `STORAGE_DRIVER` | | `supabase` (défaut) ou `local` |
| `SUPABASE_URL` | si supabase | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | si supabase | Clé **serveur uniquement** |
| `SUPABASE_ANON_KEY` | | Non utilisée par le serveur (aucune clé n'est envoyée au navigateur) |
| `SUPABASE_STORAGE_BUCKET` | | Bucket privé (défaut `jirama-share`, créé au démarrage s'il manque) |
| `UPLOAD_MAX_MB` | | Taille maximale d'un envoi (défaut 10) |
| `SESSION_TTL_DAYS` | | Durée des sessions (défaut 14) |
| `TRUST_PROXY` | | `true` derrière le proxy o2switch (défaut) |
| `EXTRACTOR_PROVIDER` | | `none` (défaut) ou `anthropic` |
| `ANTHROPIC_API_KEY` | si anthropic | Clé de l'API Claude (serveur uniquement) |
| `LOG_LEVEL`, `LOG_FILE` | | Niveau et fichier de journal |
| `RATE_LIMIT_MAX` | | Requêtes par minute et par IP (défaut 300) |

## Base de données et migrations

Le schéma est défini en TypeScript ([`src/server/db/schema.ts`](src/server/db/schema.ts)) et les migrations
SQL versionnées sont dans [`drizzle/`](drizzle/).

```bash
npm run db:generate      # après une modification du schéma : génère une nouvelle migration SQL
npm run db:migrate       # applique les migrations (code compilé, en production)
npm run db:migrate:dev   # idem depuis les sources
```

Les migrations sont idempotentes : la table `drizzle.__drizzle_migrations` mémorise celles déjà appliquées.
La migration `0001_enable_rls` active la Row Level Security sur toutes les tables pour fermer l'API REST
automatique de Supabase ; le serveur, propriétaire des tables, n'est pas concerné.

**Connexion depuis o2switch.** La connexion directe `db.<ref>.supabase.co` n'est disponible qu'en IPv6 (sauf
option IPv4 payante) : utilisez le **pooler Supavisor**, accessible en IPv4.

- `DATABASE_URL` : *Transaction pooler*, port **6543** (adapté à un serveur avec un petit pool) ;
- `MIGRATION_DATABASE_URL` : *Session pooler*, port **5432** (recommandé pour les migrations et `pg_dump`).

Le serveur désactive les requêtes préparées (`prepare: false`), ce qui le rend compatible avec les deux modes.

## Tests, vérifications et build

```bash
npm run typecheck   # TypeScript strict (client et serveur séparément)
npm run lint        # ESLint
npm test            # tests unitaires du moteur + tests d'API sur PostgreSQL embarqué
npm run build       # frontend (dist/client) + serveur et commandes (dist/server)
npm run check       # tout ce qui précède
```

Les tests d'API peuvent aussi tourner contre un vrai PostgreSQL **jetable** (son schéma est réinitialisé) :

```bash
docker run -d --rm --name pg-test -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm test
docker stop pg-test
```

## Configuration Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (région proche, par exemple Europe) et notez le
   mot de passe de la base.
2. **Base** : bouton *Connect* → copiez l'URI *Transaction pooler* (port 6543) dans `DATABASE_URL` et l'URI
   *Session pooler* (port 5432) dans `MIGRATION_DATABASE_URL`. Remplacez `[YOUR-PASSWORD]`.
3. **Clés** : *Project Settings → API Keys* → copiez la clé secrète `service_role` (ou une clé secrète
   `sb_secret_…`) dans `SUPABASE_SERVICE_ROLE_KEY`, et l'URL du projet dans `SUPABASE_URL`.
   Cette clé donne tous les droits : elle ne doit **jamais** apparaître dans le frontend, un dépôt git ou une
   capture d'écran.
4. **Stockage** : le bucket privé `jirama-share` est créé automatiquement au premier démarrage. Pour le créer
   à la main : *Storage → New bucket*, **Public bucket désactivé**. Le serveur refuse de démarrer les envois si
   le bucket est public.
5. L'authentification Supabase n'est pas utilisée : les comptes, sessions et rôles sont gérés par
   l'application elle-même (contrôle d'accès entièrement côté serveur).

## Déploiement sur o2switch

Cible : `https://jirama.gasycoder.com`, application Node.js sous **Phusion Passenger** (« Setup Node.js App »
de cPanel), un seul processus servant l'API et l'interface.

### 1. Sous-domaine et HTTPS

1. cPanel → **Domaines** → créez `jirama.gasycoder.com`. Si le DNS de `gasycoder.com` est géré ailleurs,
   ajoutez un enregistrement `A` vers l'adresse IP de votre hébergement o2switch.
2. cPanel → **SSL/TLS Status** → lancez **AutoSSL** pour `jirama.gasycoder.com` (certificat Let's Encrypt).

### 2. Construire l'archive (sur votre poste)

```bash
npm ci
npm run check        # types, lint, tests, build
npm run package      # → deploy/jirama-share.tar.gz (sans sources, sans node_modules, sans .env)
```

### 3. Envoyer le code

Par SSH (ou le gestionnaire de fichiers cPanel) :

```bash
scp deploy/jirama-share.tar.gz <compte>@<serveur>:~
ssh <compte>@<serveur>
mkdir -p ~/apps && tar -xzf ~/jirama-share.tar.gz -C ~/apps     # → ~/apps/jirama-share
```

N'envoyez **jamais** de dossier `node_modules` : sur o2switch (CloudLinux), il est géré par l'environnement
Node de l'application.

Variante : cloner le dépôt sur le serveur et lancer `npm install && npm run build` dans l'environnement Node
(étape 4), ce qui installe aussi les outils de développement.

### 4. Créer l'application Node.js

cPanel → **Setup Node.js App** → **Create Application** :

| Champ | Valeur |
| --- | --- |
| Node.js version | 22.x (ou 20.x ≥ 20.12) |
| Application mode | Production |
| Application root | `apps/jirama-share` |
| Application URL | `jirama.gasycoder.com` |
| Application startup file | `app.cjs` |

Ajoutez les **variables d'environnement** (section *Environment variables*) d'après `.env.example`, ou créez
un fichier `~/apps/jirama-share/.env` avec `chmod 600`. Au minimum : `NODE_ENV`, `APP_URL`, `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 5. Installer les dépendances, migrer, créer l'administrateur

Dans la page de l'application, cliquez sur **Run NPM Install**, ou par SSH en activant l'environnement Node
(la commande exacte, « Enter to the virtual environment », est affichée en haut de la page de l'application) :

```bash
source ~/nodevenv/apps/jirama-share/22/bin/activate && cd ~/apps/jirama-share
npm install --omit=dev
npm run db:migrate
npm run create-superadmin -- --email vous@exemple.mg --name "Votre nom"
```

### 6. Démarrer et vérifier

Cliquez sur **Restart** (ou `touch ~/apps/jirama-share/tmp/restart.txt`), puis :

```bash
curl https://jirama.gasycoder.com/api/health    # {"status":"ok","database":"ok",…}
```

Sous Passenger, `app.cjs` désactive l'écoute automatique et le serveur appelle `listen('passenger')` une fois
prêt : la variable `PORT` est ignorée.

### 7. Forcer HTTPS

Dans le fichier `.htaccess` du dossier racine du sous-domaine, **au-dessus** du bloc géré par cPanel
(`# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION BEGIN`), ajoutez :

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

L'application envoie aussi un en-tête HSTS et redirige les requêtes signalées en HTTP par le proxy.

### 8. Journaux

Les journaux Pino (JSON) vont sur la sortie standard, récupérée par Passenger (fichier de log indiqué dans la
page de l'application). Pour un fichier dédié : `LOG_FILE=/home/<compte>/logs/jirama-share.log`, puis
`tail -f ~/logs/jirama-share.log`. Les cookies et en-têtes d'autorisation sont masqués.

### 9. Mise à jour

```bash
npm run check && npm run package                      # sur votre poste
# sur le serveur :
tar -xzf ~/jirama-share.tar.gz -C ~/apps
source ~/nodevenv/apps/jirama-share/22/bin/activate && cd ~/apps/jirama-share
npm install --omit=dev && npm run db:migrate
touch tmp/restart.txt
```

## Premier super-administrateur

```bash
npm run create-superadmin -- --email vous@exemple.mg --name "Votre nom"
```

Le mot de passe (10 caractères minimum) est demandé sans écho, ou lu dans `SUPERADMIN_PASSWORD`. Il n'est
jamais écrit dans le code. Si le compte existe déjà, il est promu super-administrateur et son mot de passe est
remplacé. Les autres comptes se créent ensuite dans **Administration → Utilisateurs** (mot de passe provisoire
à changer à la première connexion), puis s'ajoutent aux bâtiments dans **Bâtiment → Membres**.

## Sauvegarde et restauration

**Base de données** (toutes les factures, relevés, versions et le journal d'audit) — via le *Session pooler*,
avec les outils PostgreSQL (`pg_dump` de version égale ou supérieure à celle du serveur) :

```bash
pg_dump "$MIGRATION_DATABASE_URL" --format=custom --no-owner --file="jirama-$(date +%F).dump"
```

Restauration dans une base vide (nouveau projet ou base de test), puis vérification :

```bash
pg_restore --no-owner --clean --if-exists --dbname="$MIGRATION_DATABASE_URL" jirama-AAAA-MM-JJ.dump
npm run db:migrate   # applique les migrations plus récentes que la sauvegarde
```

Supabase réalise aussi des sauvegardes quotidiennes selon l'offre (*Database → Backups*).

**Photos** (bucket `jirama-share`) : téléchargez-les depuis le tableau de bord Supabase, ou synchronisez le
bucket avec un client compatible S3 (Supabase Storage expose un point d'accès S3 : *Storage → Settings*).
Conservez la base et les photos de la même date : la table `files` référence les clés de stockage.

Planifiez la sauvegarde (cron cPanel, par exemple chaque nuit) et testez régulièrement une restauration.

## Lecture automatique des photos

Par défaut (`EXTRACTOR_PROVIDER=none`), l'application lit la **date et l'heure de prise de vue** dans les
métadonnées EXIF ; l'index est saisi en regardant la photo. Avec `EXTRACTOR_PROVIDER=anthropic` et
`ANTHROPIC_API_KEY`, les chiffres du compteur et les champs de la facture sont lus par vision IA (Claude) et
proposés avec un niveau de confiance et des alertes (chiffre en rotation, année supposée, index incohérents).
Dans tous les cas, **rien n'est enregistré sans confirmation humaine**, et la lecture brute est conservée pour
l'audit. Le moteur est isolé derrière l'interface `MeterReadingExtractor` : un autre OCR peut le remplacer.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| `Configuration invalide (.env)` au démarrage | Le message liste les variables manquantes. |
| `getaddrinfo ENOTFOUND` / délai de connexion à la base | Utiliser l'URL du **pooler** (IPv4), pas `db.<ref>.supabase.co`. |
| `prepared statement … does not exist` | Mode transaction : le serveur utilise déjà `prepare: false` ; vérifier qu'aucun autre outil n'est branché sur le port 6543. |
| 403 `CSRF_REJECTED` | `APP_URL` doit correspondre exactement à l'adresse utilisée dans le navigateur (https, sans `/` final). |
| Déconnexion immédiate en local | `COOKIE_SECURE=false` quand on n'est pas en HTTPS. |
| Envoi de photo refusé (415) | Seuls JPEG, PNG, WebP, HEIC (et PDF pour une facture) sont acceptés. |
| Page blanche après mise à jour | Vider le cache du navigateur ; vérifier que `dist/client` a bien été envoyé. |
