# Sauvegardes PostgreSQL

Ce runbook est distinct du probe S3. Il ne dépose aucun objet dans un bucket de documents. Fluxora ne sauvegarde pas la base tout seul. L'opérateur planifie `pg_dump` hors du processus applicatif, puis vérifie qu'un dump se restaure.

Ce document ne lance ni dump, ni restauration, ni webhook. `BACKUP_CONFIGURED` reste vide tant qu'une sauvegarde de production planifiée n'a pas été chiffrée, copiée hors serveur, puis restaurée dans une base `*_restore` dont les comptes et les migrations ont été vérifiés.

## Runbook

1. Sauvegarde. Sur l'hôte de sauvegarde, hors de Next.js : `pg_dump --format=custom --no-owner --file=fluxora-YYYYMMDD.dump "$DATABASE_URL"`. Le fichier reste sur la machine qui le produit.
2. Intégrité. `sha256sum fluxora-YYYYMMDD.dump`, puis conserver l'empreinte à côté du fichier chiffré. `pg_restore --list fluxora-YYYYMMDD.dump` doit lister le dump avant le transfert.
3. Chiffrement. `age -r AGE_PUBLIC_RECIPIENT -o fluxora-YYYYMMDD.dump.age fluxora-YYYYMMDD.dump`, ou GPG. Supprimer le fichier clair. La clé privée reste dans le secret manager, hors de ce serveur. Fluxora ne la détient pas.
4. Transfert. Copier seulement le fichier chiffré vers un hôte ou un bucket distinct du serveur d'application et distinct du bucket des documents.
5. Rétention, sur ce stockage distant seulement : 7 quotidiennes, 4 hebdomadaires, 3 mensuelles. Ne pas effacer la base applicative pour faire de la place.
6. Restauration. Base vide dont le nom est celui de la source suivi de `_restore`. `createdb <base>_restore`, puis `pg_restore --no-owner --dbname=<base>_restore fluxora-YYYYMMDD.dump`. `fluxora`, `postgres`, `template0` et `template1` sont refusées. La base active n'est pas la cible.
7. Après restauration. `npx prisma migrate status` avec l'URL de `<base>_restore`. Comparer les comptes d'organisations, de documents, de factures, de journaux d'audit et de migrations avec ceux notés au moment du dump. Ouvrir une organisation connue : un document, une facture, une ligne d'audit. Déchiffrer seulement dans cette base vide et comparer l'empreinte SHA-256 avec celle calculée avant chiffrement.
8. Alerte. En cas d'échec, envoyer seulement `{"alert":"backup_failed","step":"dump"}` vers `ALERT_WEBHOOK_URL`. L'étape vaut `dump`, `checksum`, `encrypt`, `copy` ou `restore-check`. Le corps ne contient ni URL, ni dump, ni clé.

`npm run backup:plan` affiche ces étapes et n'écrit rien. `npm run backup:plan -- --restore` s'arrête avant toute connexion et affiche l'alerte `restore-check`.

Planifier la séquence sur l'hôte de sauvegarde. Cron : `15 2 * * *`. Sur Windows, la même commande dans le Planificateur de tâches, chaque nuit, et une exécution manuelle avant `npm run db:deploy`.

## Fréquence

- Une sauvegarde complète chaque nuit.
- Une sauvegarde supplémentaire avant `npm run db:deploy`.
- Conserver les fichiers chiffrés, hors du serveur d'application.

## Rétention

- 7 sauvegardes quotidiennes.
- 4 sauvegardes hebdomadaires.
- 3 sauvegardes mensuelles.

La rétention des documents métier dans l'application est distincte : elle est réglée par organisation et ne remplace pas la sauvegarde de la base.

## Sauvegarde

```bash
pg_dump --format=custom --no-owner --file=fluxora-YYYYMMDD.dump "$DATABASE_URL"
```

Le fichier contient les organisations, les journaux d'audit et les secrets chiffrés des connecteurs. Il se chiffre avant de quitter la machine.

## Chiffrement

Le dump en clair ne sort pas du serveur qui l'a produit. Chiffrer avec `age` ou GPG, puis supprimer le fichier clair. La clé privée de déchiffrement reste hors de ce serveur, dans le secret manager de l'opérateur.

```bash
age -r AGE_PUBLIC_RECIPIENT -o fluxora-YYYYMMDD.dump.age fluxora-YYYYMMDD.dump
```

Fluxora ne détient pas cette clé et ne déchiffre pas les sauvegardes.

## Stockage hors serveur

Copier uniquement le fichier chiffré vers un hôte ou un bucket distinct du serveur d'application et distinct du bucket des documents. Le disque local de développement et le conteneur `fluxora-postgres` ne sont pas une destination de rétention.

## Intégrité

Avant chiffrement, calculer l'empreinte du dump. Après rapatriement, déchiffrer dans une base vide et comparer l'empreinte, puis la liste du dump et des comptes métier.

```bash
sha256sum fluxora-YYYYMMDD.dump
pg_restore --list fluxora-YYYYMMDD.dump
```

Une restauration compte seulement si une organisation connue montre un document, une facture et une ligne d'audit, et si les comptes concordent avec ceux pris au moment du dump. `BACKUP_CONFIGURED` reste vide tant que cette vérification n'a pas été faite sur la sauvegarde de production planifiée.

## Restauration

Restaurer sur une base vide, jamais par-dessus la production sans arrêt d'écriture.

```bash
createdb fluxora_restore
pg_restore --no-owner --dbname=fluxora_restore fluxora-YYYYMMDD.dump
```

Puis pointer une instance de test vers `fluxora_restore` et ouvrir une organisation connue : un document, une facture, un journal.

## Test de restauration

Une sauvegarde qui n'a pas été restaurée ne compte pas.

1. Prendre le dernier dump.
2. Le restaurer sur `fluxora_restore`.
3. Lancer l'application avec cette URL, hors production.
4. Vérifier une connexion, un document et une ligne d'audit.
5. Noter la date du test. `BACKUP_CONFIGURED=true` seulement après cette vérification, et seulement quand la sauvegarde est planifiée hors de la machine de développement.

### Essai local du 11 octobre 2026

Sur la base de développement `fluxora`, dans le conteneur `fluxora-postgres`, un `pg_dump` custom a été restauré dans une base neuve `fluxora_restore`. Les comptes étaient identiques des deux côtés : 77 organisations, 79 documents, 70 factures, 308 journaux d'audit, 129 utilisateurs, 10 migrations. La base de test et le fichier de dump ont ensuite été supprimés. La base d'origine n'a pas été modifiée.

Cet essai prouve que le format est restaurable. Il ne remplace pas une sauvegarde de production planifiée, chiffrée et conservée hors du serveur. `BACKUP_CONFIGURED` reste vide.

Les notices d'abonnement sont des lignes PostgreSQL, pas une file externe. Une restauration les ramène avec leur état. Ne pas brancher le fournisseur d'e-mail de production sur une base `*_restore` : une notice `PENDING` ou un bail expiré peut être renvoyée. La vérification de restauration compare les comptes, elle n'envoie pas de message.

`prisma db push` n'est pas une stratégie de production. Les changements de schéma passent par `npm run db:deploy` (`prisma migrate deploy`).

## Plan exécutable

`npm run backup:plan` affiche les étapes et le nom de la base source. Il ne lance ni `pg_dump`, ni chiffrement, ni copie, ni restauration. Un argument `--restore` s'arrête avant toute connexion.

La cible autorisée par le contrôle est `<base>_restore`. `fluxora`, `postgres`, `template0` et `template1` sont refusées. La restauration ne vise donc pas la base active.

Après une restauration isolée, lancer `npx prisma migrate status` avec l'URL de `<base>_restore`, puis comparer les comptes d'organisations, de documents, de factures, de journaux et de migrations avec ceux notés au moment du dump.

## Exécution périodique

Planifier la séquence sur un hôte de sauvegarde, pas dans le processus Next.js. Cron : `15 2 * * *`. Sur Windows, la même commande dans le Planificateur de tâches, chaque nuit. Ajouter une exécution manuelle avant `npm run db:deploy`.

En cas d'échec, envoyer seulement `{"alert":"backup_failed","step":"dump"}` vers `ALERT_WEBHOOK_URL`. L'étape vaut `dump`, `checksum`, `encrypt`, `copy` ou `restore-check`. Le corps ne contient ni URL, ni dump, ni clé.

La rétention s'applique au stockage distant : 7 quotidiennes, 4 hebdomadaires, 3 mensuelles. On n'efface pas la base applicative pour faire de la place.

L'existence de ce plan ne justifie pas `BACKUP_CONFIGURED=true`. Cette variable attend une sauvegarde planifiée, chiffrée, hors serveur, puis une restauration isolée dont les comptes et les migrations ont été vérifiés.

## Retour arrière de schéma

La seule migration récente ajoute la colonne nullable `BillingEvent.appliedAt`. Elle ne supprime aucune ligne. Sur une base isolée, et seulement si cette colonne n'a pas encore servi, le retour est `ALTER TABLE "BillingEvent" DROP COLUMN "appliedAt";`. Ne pas l'exécuter sur la base qui sert l'application. Le retour des données reste une restauration dans `<base>_restore`, jamais par-dessus la base active.

## Objectifs, non mesurés

La cadence prévue est une sauvegarde complète chaque nuit, plus une sauvegarde avant `npm run db:deploy`. L'objectif de perte de données est donc au plus une journée de saisies, tant que cette cadence est réellement tenue. L'objectif de reprise est le temps nécessaire pour déchiffrer, restaurer dans `<base>_restore`, comparer les comptes, puis basculer. Ces deux objectifs ne sont pas des résultats mesurés. Aucune sauvegarde de production et aucune restauration de production n'ont été chronométrées.
