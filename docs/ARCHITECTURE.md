# Architecture technique

## Vue d'ensemble

```text
                      https://jirama.gasycoder.com
                                  │
              o2switch : Apache + Phusion Passenger (HTTPS, AutoSSL)
                                  │  app.cjs
                     ┌────────────▼─────────────┐
                     │  Un seul processus Node   │
                     │  Fastify 5 (TypeScript)   │
                     │  ├─ /api/*  API REST       │
                     │  └─ /*      React compilé  │  (dist/client, repli SPA)
                     └──────┬──────────────┬─────┘
            Supavisor (IPv4)│              │ HTTPS, clé service_role (serveur seulement)
                     ┌──────▼─────┐  ┌─────▼──────────────┐
                     │ PostgreSQL │  │ Supabase Storage   │
                     │ (Supabase) │  │ bucket privé       │
                     └────────────┘  └────────────────────┘
```

Choix principaux :

| Sujet | Choix | Raison |
| --- | --- | --- |
| Backend | **Fastify** (plutôt que NestJS) | Un fichier d'entrée, démarrage rapide, peu de dépendances : simple à faire tourner sous Passenger. |
| Frontend | React 19 + Vite 7 + Tailwind 4 + TanStack Query + React Hook Form + Zod | Compilé en fichiers statiques servis par le même processus Node. |
| ORM | **Drizzle** (plutôt que Prisma) | Pas de moteur binaire à installer sur l'hébergeur, SQL explicite, migrations SQL versionnées. |
| Pilote PostgreSQL | `postgres` (postgres.js) avec `prepare: false` | Compatible avec le pooler Supavisor en mode transaction comme en mode session. |
| Authentification | Sessions maison (cookie httpOnly, jeton haché SHA-256 en base, scrypt) | RBAC entièrement côté serveur, aucune clé Supabase dans le navigateur, aucune dépendance native. |
| Calculs | Moteur pur partagé (`src/shared/billing`) | Le même code sert au serveur (calcul officiel) et peut servir au client ; testé indépendamment. |
| Tests | Vitest + PGlite (PostgreSQL embarqué) | Les tests d'API tournent sur un vrai moteur PostgreSQL, sans serveur à installer. |

## Arborescence

```text
app.cjs                    Démarrage Passenger (o2switch)
drizzle/                   Migrations SQL versionnées (générées + RLS)
scripts/                   build-server (esbuild), dev, package (archive de déploiement)
src/shared/                Code commun client/serveur
  billing/                 Moteur de répartition, unités entières, dates, formatage
  domain.ts                Énumérations métier, rôles et permissions
  schemas.ts               Schémas Zod des requêtes (validation client ET serveur)
  api.ts                   Types des réponses de l'API
  whatsapp.ts              Génération du message WhatsApp
src/server/
  app.ts                   Fastify : sécurité, sessions, CSRF, routes, fichiers statiques
  index.ts                 Point d'entrée (port local ou socket Passenger)
  db/                      Schéma Drizzle, connexion, migrations
  auth/                    Mots de passe (scrypt), sessions, contrôle d'accès
  routes/                  Routes REST par domaine
  services/                Répartition (versions, validation), audit, paramètres
  extraction/              Lecture des photos (interface + EXIF + Claude vision optionnel)
  storage/                 Supabase Storage / disque / mémoire ; détection du type réel des fichiers
  cli/                     migrate, seed, create-superadmin
src/client/
  auth/, lib/, i18n/       Session, bâtiment actif, client API, cache, traductions (fr, mg)
  components/              Kit UI (cartes, dialogues, tiroirs, badges…), formulaire de relevé
  pages/, features/        Écrans
```

## Modèle de données

Toutes les tables ont une clé UUID, `created_at` / `updated_at`, des clés étrangères explicites et, quand
c'est pertinent, une suppression logique (`deleted_at`). La RLS est activée sur toutes les tables (aucun accès
par l'API REST de Supabase ; le serveur, propriétaire des tables, n'est pas concerné).

| Table | Rôle | Contraintes notables |
| --- | --- | --- |
| `users` | Comptes (`SUPERADMIN` / `USER`) | e-mail unique (insensible à la casse) parmi les comptes non supprimés |
| `sessions` | Sessions (hash du jeton uniquement) | expiration, révocation |
| `app_settings` | Paramètres globaux | |
| `buildings` | Bâtiments (n° client, référence compteur, mode eau, tolérance) | |
| `building_members` | Accès d'un utilisateur à un bâtiment : rôle `MANAGER` / `CONTRIBUTOR` / `VIEWER`, permissions supplémentaires, logement occupé | unique (bâtiment, utilisateur) |
| `meters` | Compteurs `MAIN` / `SUB_METER` / `WATER` / `COMMON`, normalisation, capacité | un seul `MAIN` actif par bâtiment |
| `consumers` | Consommateurs dynamiques (ordre, type, méthode, coefficients) | `has_sub_meter` **généré** à partir de `meter_id` ; un compteur par consommateur ; `SUB_METER` exige un compteur |
| `meter_readings` | Relevés : valeur lue, valeur normalisée, source, photo, confiance, extraction brute, validation | valeurs ≥ 0, confiance entre 0 et 1 |
| `files` | Métadonnées des fichiers (clé aléatoire, type détecté, SHA-256) | clé unique |
| `bills` | Factures (période, jours, index, kWh, montants, statuts) | fin > début, montants ≥ 0, n° de facture unique par bâtiment |
| `bill_documents` | Photos/PDF rattachés à une facture | |
| `allocations` | Versions de répartition : statut, version du moteur, **instantané d'entrée**, configuration, totaux, avertissements, erreurs, correction | (facture, version) unique ; **une seule version officielle par facture** (index unique partiel) |
| `allocation_items` | Résultat par consommateur : méthode appliquée, **provenance**, kWh, part, montants, relevés utilisés | |
| `allocation_calculation_steps` | Étapes lisibles du calcul | ordre unique par répartition |
| `audit_logs` | Journal : utilisateur, action, entité, ancienne/nouvelle valeur, IP | index par bâtiment, facture, entité, date |

Provenance d'une valeur : `MEASURED`, `PRORATED`, `ESTIMATED`, `MANUAL`, `DIFFERENCE` — conservée dans
`allocation_items.provenance`, dans l'instantané et dans l'audit, et affichée par des badges.

## Rôles et permissions

| Permission | VIEWER | CONTRIBUTOR | MANAGER |
| --- | :-: | :-: | :-: |
| `building.read`, `bill.read`, `report.share` | ✓ | ✓ | ✓ |
| `reading.create` | | ✓ | ✓ |
| `building.update`, `building.manage_members`, `consumer.manage`, `meter.manage`, `bill.write`, `reading.validate`, `allocation.calculate`, `allocation.validate`, `allocation.lock`, `audit.read` | | | ✓ |

Des permissions peuvent être ajoutées membre par membre. Le `SUPERADMIN` a tous les droits sur tous les
bâtiments, gère les comptes, crée les bâtiments, les paramètres, et peut corriger une répartition verrouillée.
Toutes les vérifications ont lieu côté serveur ; l'interface se contente de masquer ce qui n'est pas permis.
Sans accès à un bâtiment, l'API répond 404 (son existence n'est pas révélée).

## API REST (`/api`)

| Domaine | Routes |
| --- | --- |
| Système | `GET /health` · `GET, PUT /settings` · `GET /audit?buildingId&billId&entityType&page` |
| Session | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/change-password` |
| Comptes (SUPERADMIN) | `GET, POST /users` · `PATCH, DELETE /users/:id` · `POST /users/:id/reset-password` |
| Bâtiments | `GET, POST /buildings` · `GET, PATCH, DELETE /buildings/:buildingId` · `GET /buildings/:buildingId/dashboard` |
| Membres | `GET, POST /buildings/:buildingId/members` · `PATCH, DELETE /members/:id` |
| Consommateurs | `GET, POST /buildings/:buildingId/consumers` · `POST /buildings/:buildingId/consumers/reorder` · `PATCH, DELETE /consumers/:id` |
| Compteurs | `GET, POST /buildings/:buildingId/meters` · `PATCH /meters/:id` |
| Relevés | `GET, POST /meters/:id/readings` · `PATCH, DELETE /readings/:id` · `POST /readings/:id/validate` |
| Fichiers | `POST /buildings/:buildingId/files?kind=METER_PHOTO\|BILL_PHOTO\|BILL_PDF` · `GET, DELETE /files/:id` |
| Factures | `GET, POST /buildings/:buildingId/bills` · `GET, PATCH, DELETE /bills/:id` |
| Répartitions | `GET /bills/:id/allocation-draft` · `POST /bills/:id/allocations/simulate` · `GET, POST /bills/:id/allocations` · `GET /allocations/:id` · `POST /allocations/:id/validate` · `POST /allocations/:id/lock` |

Erreurs : `{ "error": { "code", "message", "issues"? } }` — 400 validation, 401 non connecté, 403 interdit,
404 introuvable, 409 conflit (données modifiées, doublon), 415 type de fichier refusé, 429 trop de requêtes.

## Lecture des photos

`MeterReadingExtractor.extract(file: Buffer)` et `BillExtractor.extract(file: Buffer)` sont des interfaces ;
la logique métier n'en connaît pas l'implémentation :

- `ExifMeterExtractor` : date et heure de prise de vue (EXIF), sans IA ;
- `ClaudeMeterExtractor` / `ClaudeBillExtractor` (si `EXTRACTOR_PROVIDER=anthropic`) : lecture par vision IA
  avec sortie structurée ; signale un tambour en rotation, une année supposée, une incohérence de facture ;
- `CompositeMeterExtractor` : combine les deux (la date EXIF est préférée à une date lue sur l'image).

Le résultat est renvoyé à l'interface comme **proposition** : un relevé n'est enregistré qu'avec
`confirmed: true`, envoyé par le bouton « Confirmer » après vérification humaine. La valeur brute extraite est
conservée (`meter_readings.extracted`) pour l'audit.

## Sécurité

- Cookie de session `httpOnly`, `SameSite=Lax`, `Secure` en production ; jeton aléatoire de 256 bits, seul son
  hash SHA-256 est stocké ; sessions révoquées au changement de mot de passe ou à la désactivation du compte.
- Mots de passe : scrypt (N = 2¹⁵), comparaison à temps constant, temps de réponse égalisé quand l'e-mail
  n'existe pas ; changement obligatoire après création ou réinitialisation par l'administrateur.
- CSRF : toute requête modifiante doit venir de l'origine de l'application (`Origin`/`Referer` contrôlés).
- En-têtes Helmet : CSP stricte (`script-src 'self'`), HSTS, `frame-ancestors 'none'`, `nosniff`…
- CORS limité à `APP_URL` (+ `CORS_ORIGINS`).
- Limitation de débit : 300 requêtes/min/IP, 10 tentatives de connexion / 15 min, 30 envois / min.
- Validation Zod de toutes les entrées ; erreurs PostgreSQL traduites sans fuite d'information.
- Fichiers : type réel détecté par signature (JPEG, PNG, WebP, HEIC, PDF), taille maximale, nom de stockage
  aléatoire, bucket privé, téléchargement uniquement via le serveur après contrôle des droits.
- `SUPABASE_SERVICE_ROLE_KEY` et `ANTHROPIC_API_KEY` ne quittent jamais le serveur ; aucune variable n'est
  injectée dans le bundle client.
- Journaux Pino avec masquage des cookies et en-têtes d'autorisation.
