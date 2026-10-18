# Déploiement

Les migrations versionnées sont la seule voie de schéma. Ne pas utiliser `prisma db push`.

## 1. Base

Créer une base PostgreSQL vide et un utilisateur dédié. Noter `DATABASE_URL` dans le secret manager, pas dans le dépôt.

## Secrets

Les secrets de production restent dans le secret manager de l'hébergeur. Ils ne sont pas committés. Une rotation remplace la valeur, redémarre le processus, puis retire l'ancienne valeur. Au minimum : `AUTH_SECRET`, `DATABASE_URL`, les clés S3 applicatives, les clés du probe, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `INBOUND_WEBHOOK_SECRET` et les jetons d'email. Après une fuite supposée : révoquer la valeur chez le fournisseur, la remplacer, invalider les sessions en changeant `AUTH_SECRET`, et noter l'heure. Ne pas coller la valeur dans un ticket, un journal ou une conversation.

La politique de contenu est statique, définie dans `lib/security-headers.ts` et appliquée par `next.config.ts`. En production elle vaut : `default-src 'self' ; img-src 'self' data: blob: ; style-src 'self' 'unsafe-inline' ; script-src 'self' 'unsafe-inline' ; connect-src 'self' https://api.stripe.com ; frame-src https://js.stripe.com https://hooks.stripe.com ; frame-ancestors 'none' ; base-uri 'self' ; form-action 'self'`. En développement, `script-src` ajoute `'unsafe-eval'` pour le serveur de développement Next.js. `unsafe-eval` n'est pas envoyé quand `NODE_ENV=production`. HSTS n'est ajouté que dans ce mode.

`script-src 'unsafe-inline'` et `style-src 'unsafe-inline'` restent parce que l'App Router injecte des scripts et des balises de style sans nonce. Un nonce se calcule par requête dans le middleware, puis doit être relu par le rendu. Cette vérification n'a pas été faite sur les pages de connexion, d'inscription et d'application. Retirer `unsafe-inline` maintenant casserait le rendu sans preuve du contraire. Le plan de réduction est : nonce par requête, test de staging des pages d'authentification, du tableau de bord et du paiement Stripe, puis seulement suppression de `script-src 'unsafe-inline'`. `style-src 'unsafe-inline'` resterait tant que les styles injectés n'ont pas de hash. Ces en-têtes ne prouvent pas qu'un domaine public est en HTTPS.

Le compteur de débit vit dans le processus. Il n'est pas partagé entre plusieurs instances web. Le stockage `local` non plus : un second processus ne voit pas les fichiers du premier. La production prévue est une seule instance Next.js, avec `STORAGE_DRIVER=s3`. Deux serveurs web ne sont pas sûrs.

Les jobs sont des lignes PostgreSQL. `after()` les démarre tant que le processus vit. Ce n'est qu'une accélération. La reprise après redémarrage est `npm run jobs:recover`, un processus court, pas un second serveur. Elle n'est pas installée : l'hôte réel n'est pas choisi.

Sur un hôte Linux, avec Node, `npm ci`, et `DATABASE_URL` injecté par le secret manager dans l'environnement, jamais sur la ligne de commande :

```cron
* * * * * cd /opt/fluxora && /usr/bin/npm run jobs:recover >> /var/log/fluxora-jobs.log 2>&1
```

Un job `RECEIVED` de moins de deux minutes est laissé à `after()`. Après un crash, le premier passage une fois ces deux minutes écoulées le revendique. Un job `PROCESSING` dont `startedAt` a plus de quinze minutes, ou dont `startedAt` est vide, revient en `RETRYING` si les tentatives sont inférieures à trois, sinon en `FAILED`. Il n'y a pas de second verrou : la revendication est le même `UPDATE` que le traitement normal. La finalisation n'écrit que si `status` est encore `PROCESSING` et que `startedAt` est celui de cette revendication. Un ancien passage ne peut pas terminer le travail d'un autre.

Deux passages peuvent se chevaucher. Un seul obtient la ligne. Si le premier travaille encore après quinze minutes, le second reprend la ligne. Le premier ne peut plus la clôturer. La prise du document et chaque écriture (facture, champs, anomalies, usage, audit, notification d'échec) revérifient dans la même transaction que `startedAt` est encore le sien. Sinon rien n'est écrit. L'appel d'extraction déjà parti ne peut pas être annulé : son résultat est ignoré, et un nouvel appel n'est pas lancé si le bail est déjà perdu. Ce n'est pas une extraction exactement une fois. Une reprise légitime, après un commit puis un crash avant la clôture du job, remplace la facture du document (une seule ligne). Elle ne crée pas une seconde notification, une seconde exécution de règle, un second événement produit, ni un second audit pour le même fait. La migration `20261018160000_processing_fact_dedupe` ajoute `dedupeKey` nullable sur `Notification`, `ProductEvent` et `AuditLog`, avec une unicité `(organizationId, dedupeKey)`. Les clés nulles restent distinctes : les lignes déjà présentes ne sont ni réécrites ni supprimées. Déployer avec `npm run db:deploy` avant de lancer cette version. L'exécution d'une règle change si le contexte métier change (montant, fournisseur, rapprochement) : c'est alors un autre fait. Un autre document, une autre règle ou une autre action d'audit restent enregistrés. L'historique `DocumentProcessingRun` et les lignes `AiUsage` continuent de s'ajouter à chaque passage.

Le code 0 signifie que le passage a fini. Il ne signifie pas que chaque job a réussi. Le code 1 signifie que `DATABASE_URL` est absent ou que la base est injoignable. La sortie est un JSON : `received`, `processing`, `stale`, `retrying`, `failed`, `oldestReceivedAgeSeconds`. Aucun nom de fichier, aucun contenu, aucun secret.

Alerter sur le code 1. Alerter si `failed` est supérieur à 0. Alerter si `stale` reste supérieur à 0 après un passage. Alerter si `oldestReceivedAgeSeconds` dépasse 180 : un job reçu attend depuis plus de trois minutes, donc la tâche ne le reprend pas. L'alerte ne reprend que ces nombres. Le journal `job_stuck` non plus.

## Incident

1. Confirmer le symptôme sur `/api/health/ready` et les journaux JSON. Ne pas y chercher de secret.
2. Si des données d'une organisation sont exposées à une autre, couper l'accès concerné et ne pas relancer avant correction.
3. Publier un incident sur `/status` seulement depuis un email listé dans `STATUS_EDITOR_EMAILS`. Le message ne contient ni document, ni facture, ni secret.
4. Si la base est douteuse, suivre `docs/production-backups.md` vers une base `*_restore`. Ne pas restaurer par-dessus la base active.
5. Après correction, résoudre l'incident. Ne pas déclarer le service opérationnel seulement parce que la page n'a plus d'incident : sans sonde, le statut reste non mesuré.

## 2. Environnement

Copier les noms de `.env.example`. Remplir les valeurs dans le secret manager.

Obligatoires : `DATABASE_URL`, `AUTH_SECRET` (32 octets aléatoires), `AUTH_URL` en `https://`.

`APP_URL` reprend la même origine si les liens email, OAuth et facturation doivent diverger de `AUTH_URL`.

`EXPOSE_RESET_LINK` reste vide. Le processus refuse de démarrer en production si cette variable vaut `true`, si l'origine n'est pas en https, si `STORAGE_DRIVER` n'est pas `s3`, ou s'il manque `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` ou `S3_SECRET_ACCESS_KEY`. Un `S3_ENDPOINT` renseigné doit commencer par `https://`. Le développement local conserve `STORAGE_DRIVER=local`.

## 3. Migrations

```bash
npm ci
npm run db:deploy
```

Ordre : développement avec `npm run db:migrate`, puis le même dossier `prisma/migrations` en staging, puis en production.

## 4. Stockage

`STORAGE_DRIVER=s3` avec `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `S3_ENDPOINT` seulement pour un stockage compatible, et seulement en https.

Les clés d'objet commencent par `organizations/{organizationId}/`. Une clé d'une autre organisation, une clé qui remonte d'un répertoire, ou un fichier absent est refusé avant lecture. Une panne du fournisseur répond `Stockage indisponible` sans corps de réponse et sans secret. Le disque local ne convient pas à un serveur éphémère.

Ces variables ne prouvent pas qu'un bucket répond. `/api/health` expose `storageLiveCheck: not_run` tant qu'aucun dépôt réel n'a été exécuté. Le chiffrement au repos se règle sur le bucket (chiffrement par défaut du fournisseur), pas dans Fluxora.

Le même client signe `PutObject`, `GetObject` et `DeleteObject`. L'upload écrit `organizations/{organizationId}/documents/{documentId}/original`, et le téléchargement relit cette clé après avoir vérifié le préfixe de l'organisation. Le corps signé est l'empreinte SHA-256 du fichier.

Si la transaction échoue alors que le processus vit encore, Fluxora supprime la clé seulement quand aucun document de cette organisation ne la référence. `reconcileLocalUnreferenced` peut être relancé sur le disque local : il ne sort pas de `organizations/{organizationId}/documents/` et il ne supprime pas un fichier référencé. Il ne voit pas S3. Le client applicatif n'a pas `ListBucket`. Après un crash entre `PutObject` et le commit, ou entre `PutObject` et le nettoyage, un objet distant peut rester sans ligne. Le rattrapage demande un inventaire humain du préfixe, puis une suppression ciblée des clés absentes de `Document.storageKey`. Ne pas accorder `ListBucket` au compte applicatif pour combler ce trou.

## Notifications d'abonnement

La ligne `BillingNotice` est créée dans la même transaction que l'abonnement et `appliedAt`. Les états sont `PENDING`, `PROCESSING`, `SENT` et `FAILED`. Chaque passage revendique la ligne avec un jeton et un bail de deux minutes. Huit tentatives, puis `FAILED`. Le journal `billing_notice_stuck` ne contient que des compteurs et des identifiants.

L'envoi exactement une fois n'est pas garanti. Le fournisseur HTTP reçoit l'en-tête `Idempotency-Key` égal à l'identifiant de la notice, mais rien ne prouve qu'il le déduplique. Si SMTP accepte le message et que le processus meurt avant `SENT`, le bail expire et un autre passage renvoie. Les autres courses sont fermées par le jeton : un seul passage détient le bail, et un bail perdu ne peut pas marquer `SENT`.

La reprise n'attend pas un nouveau webhook. `deliverDueBillingNotices` prend les lignes `PENDING` dont `nextAttemptAt` est atteint, et les lignes `PROCESSING` dont le bail est expiré. Il n'y a pas de worker dans le processus Next. Un import depuis `instrumentation.ts` casse `next build`, parce que ce fichier est compilé sans les modules Node `crypto`. Le webhook Stripe appelle encore la reprise après un événement appliqué. Ce n'est pas une reprise après crash : s'il n'y a plus d'événement, la ligne reste en place.

L'hôte de production n'est pas connu. La machine de développement est Windows. L'exemple suivant n'est installé nulle part.

Sur un hôte Linux, le compte applicatif peut lancer la commande chaque minute. Prérequis, à réunir avant de l'installer : Node.js et `npm ci` dans le répertoire de l'application, `DATABASE_URL` injecté par le secret manager dans l'environnement de la tâche et jamais sur la ligne de commande, les mêmes variables e-mail que le serveur si un envoi doit vraiment partir. Sans ces variables, la commande se termine quand même et laisse la notice `PENDING`. Le journal ne doit être lisible que par ce compte. Ne pas viser une base `*_restore`.

```cron
* * * * * cd /opt/fluxora && /usr/bin/npm run billing:notices >> /var/log/fluxora-billing-notices.log 2>&1
```

Le code 0 signifie que le passage a fini. Il ne signifie pas qu'un e-mail est parti. Le code 1 signifie que le passage n'a pas pu finir : `DATABASE_URL` absent, ou base injoignable. La sortie standard est un objet JSON : `pending`, `processing`, `expired`, `failed`, `oldestPendingAgeSeconds`, `oldestFailedAgeSeconds`. Aucun e-mail, aucun secret, aucun texte de `lastError`.

Alerter sur le code 1. Alerter si `failed` est supérieur à 0, ou si `oldestFailedAgeSeconds` dépasse 3600 : la notice a épuisé ses huit tentatives. Alerter si `expired` reste supérieur à 0 après un passage : un bail expiré n'a pas été repris. Alerter si `oldestPendingAgeSeconds` dépasse 86400 : une notice attend depuis plus d'un jour. L'alerte ne reprend que ces nombres.

Deux passages peuvent se chevaucher si un envoi dure plus d'une minute. C'est sûr pour la revendication. L'UPDATE PostgreSQL ne donne le jeton qu'à un seul passage. L'autre lit `busy` et ne marque pas `SENT`. Un bail encore valable n'est pas repris. Si le premier passage dépasse les deux minutes du bail après un SMTP déjà accepté, le second peut renvoyer. Ce n'est pas une livraison exactement une fois.

Tant que cette tâche n'est pas installée sur l'hôte réel, une notice bloquée attend le prochain webhook.

Si `EMAIL_DELIVERY_ENABLED` n'est pas `true`, ou si l'URL ou la clé manque, la notice reste `PENDING` avec `email_not_configured`. Elle n'est pas marquée envoyée. Aucun message n'est parti.

### Permissions du stockage applicatif

Le compte applicatif est distinct du compte du probe. Il agit sur le bucket de l'application, sous `organizations/*` :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::BUCKET/organizations/*"
    }
  ]
}
```

Fluxora n'appelle pas `ListObjects`. Les seules actions utilisées sont `GetObject`, `PutObject` et `DeleteObject`. Aucune action `s3:ListBucket`, `s3:DeleteBucket`, `s3:PutBucketPolicy` ou `s3:*` n'est requise. Si le bucket impose une clé KMS, ajouter `kms:Decrypt` et `kms:GenerateDataKey` sur cette clé seulement.

Sur le bucket applicatif, l'opérateur active le blocage de l'accès public et un chiffrement par défaut (SSE-S3 ou SSE-KMS). Fluxora ne règle ni l'un ni l'autre. Une politique IAM limitée aux objets ne prouve pas que le bucket est isolé de la production.

### Probe S3

Cette procédure n'a pas été exécutée. Les noms ci-dessous sont des emplacements à remplir par l'opérateur. Aucune valeur n'est déjà opérationnelle.

Prérequis du bucket :

- bucket vide, créé pour ce probe, distinct du bucket applicatif et de tout bucket de production ;
- aucun document client ;
- blocage de l'accès public activé ;
- chiffrement par défaut activé ;
- gestion des versions désactivée, pour qu'une suppression retire l'objet ;
- le nom du bucket ne prouve pas cette isolation.

Identité technique du probe, distincte de l'identité applicative. Elle ne reçoit que les actions réellement appelées, sur le préfixe du probe :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::PROBE_BUCKET/organizations/s3-live-check/probes/*"
    }
  ]
}
```

Cette restriction ne prouve pas que `PROBE_BUCKET` est un bucket isolé. L'opérateur le confirme en choisissant un bucket différent, des identifiants différents, et `S3_LIVE_CONFIRM=isolated`.

Le probe lit le processus, pas le fichier `.env`. Exporter les variables pour une seule commande, puis les retirer. Ne pas les écrire dans le dépôt.

```powershell
$env:S3_LIVE_CHECK = "true"
$env:S3_LIVE_CONFIRM = "isolated"
$env:S3_LIVE_BUCKET = "<bucket isolé>"
$env:S3_LIVE_REGION = "<région>"
$env:S3_LIVE_ACCESS_KEY_ID = "<identité du probe>"
$env:S3_LIVE_SECRET_ACCESS_KEY = "<secret du probe>"
# $env:S3_LIVE_ENDPOINT = "<https://point-d-acces>"  # seulement hors AWS
npm run storage:probe
Remove-Item Env:S3_LIVE_CHECK, Env:S3_LIVE_CONFIRM, Env:S3_LIVE_BUCKET, Env:S3_LIVE_REGION, Env:S3_LIVE_ACCESS_KEY_ID, Env:S3_LIVE_SECRET_ACCESS_KEY, Env:S3_LIVE_ENDPOINT -ErrorAction SilentlyContinue
```

La commande s'arrête avant tout appel réseau si `NODE_ENV=production`, si `S3_LIVE_CHECK` n'est pas `true`, si `S3_LIVE_CONFIRM` n'est pas `isolated`, si une variable dédiée manque ou si la région n'est pas un nom simple. Elle s'arrête aussi si `S3_BUCKET`, `S3_ACCESS_KEY_ID` ou `S3_SECRET_ACCESS_KEY` est absent : la comparaison est alors impossible. Deux noms différents ne prouvent pas l'isolation. Le probe refuse encore un bucket ou des identifiants identiques à ceux de l'application, un `S3_LIVE_ENDPOINT` qui porte un mot de passe, qui vise le bucket applicatif, ou qui a la même origine que `S3_ENDPOINT`. Si l'application a un `S3_ENDPOINT`, `S3_LIVE_ENDPOINT` doit être présent et différent. Le processus doit déjà contenir les variables applicatives. Ne pas les afficher.

L'identifiant et la clé sont écrits avant le premier appel réseau. La clé est toujours `organizations/s3-live-check/probes/{id}/probe.txt`, où `{id}` est 16 caractères hexadécimaux. Juste avant le dépôt, le journal passe à `dépôt potentiellement effectué`. `non démarré` signifie qu'aucun dépôt n'a été tenté. Le probe ne liste pas le bucket et ne supprime pas le préfixe. Il ne supprime que la clé reconstruite depuis son identifiant. Les permissions restent `s3:GetObject`, `s3:PutObject` et `s3:DeleteObject` sur ce préfixe. Le journal local n'ajoute pas `ListBucket`.

Le rapport sépare l'appel fournisseur, le refus local d'une clé étrangère et la panne simulée par un client factice. Les états sont `non démarré`, `dépôt potentiellement effectué`, `dépôt effectué`, `lecture vérifiée`, `suppression réussie` et `suppression échouée`. Un échec de dépôt, de lecture ou de suppression est enregistré dans `issues`, avec ces trois mots seulement. Le rapport ne contient ni secret, ni en-tête `Authorization`, ni corps de réponse, ni contenu du fichier de test. Il ne dit qu'une suppression a été acceptée que si l'appel `DeleteObject` a abouti.

Le journal est le fichier local `storage/probe-journal/{id}.json`. Il contient seulement l'identifiant, la clé, l'état, l'heure de mise à jour et `issues`. Il ne contient pas les identifiants, le bucket, ni le texte déposé. L'écriture crée un fichier temporaire exclusif, demande sa synchronisation, puis le renomme. Un fichier `.tmp` laissé par une interruption est ignoré. Un journal absent, illisible, tronqué, incohérent, ou un lien symbolique à la place du dossier ou du fichier, est refusé sans appel réseau. Un journal illisible n'est pas écrasé. Le dossier et le fichier demandent les modes `0700` et `0600`. Le dossier `storage/` est ignoré par Git. Fluxora ne le sert pas. Conserver le fichier tant que l'état n'est pas `suppression réussie`. L'effacer ensuite. Ne pas le commiter.

Limites, sans garantie supplémentaire :

- Le journal n'est pas authentifié. Le compte qui exécute la commande est la limite de confiance. Remplacer le fichier peut seulement demander la clé canonique de cet identifiant, ou faire croire que le fichier indique déjà `suppression réussie`. Cet état décrit le fichier. Il ne prouve pas un nouvel appel au fournisseur.
- Le contrôle de lien et l'écriture ne sont pas atomiques. Sous Windows, `O_NOFOLLOW` peut être absent : le refus s'appuie alors sur le contrôle qui précède l'ouverture.
- La synchronisation du contenu est demandée avant le renommage. La synchronisation du dossier peut échouer, notamment sous Windows. Un arrêt pendant le renommage peut laisser l'ancien journal ou un `.tmp` ignoré.
- Windows peut ignorer les modes `0700` et `0600`. L'accès reste celui du compte du processus.

Codes de sortie du probe :

- `0` : le fournisseur a accepté la suppression de la clé créée, après lecture et vérification. Cela ne rend pas le stockage applicatif opérationnel. `storageLiveCheck` reste `not_run`. `BACKUP_CONFIGURED` n'est pas modifié.
- `1` : échec. La sortie contient l'état, l'identifiant et la clé. Si la suppression n'a pas abouti, un objet peut rester.
- `2` : refus avant tout appel réseau. Aucun journal et aucun objet ne sont créés.

Reprise, uniquement avec l'identifiant affiché au départ :

```powershell
npm run storage:probe:recover -- <identifiant-16-hex>
```

La commande exige la même configuration dédiée que le probe. Elle reconstruit la clé depuis l'identifiant, lit seulement `storage/probe-journal/{id}.json` et refuse une clé fournie à la place de l'identifiant. Elle ne liste pas le bucket et ne supprime pas de préfixe.

- Journal absent, tronqué, illisible ou incohérent : arrêt avant tout appel réseau. Aucune suppression n'est annoncée.
- État `non démarré` : aucun dépôt confirmé. Aucun appel réseau.
- État `suppression réussie` : le journal a déjà enregistré une suppression acceptée. La reprise n'appelle pas le fournisseur et ne confirme pas une nouvelle suppression.
- Autre état cohérent : `DeleteObject` sur la seule clé reconstruite. La suppression n'est déclarée acceptée que si cet appel aboutit. Le code 0 exige en plus que le journal relu porte exactement cet état. Si l'appel aboutit mais que le journal n'est pas relu conforme, le code est 1 : le texte le dit, et le fichier seul ne prouve pas la suppression. Sinon, l'état reste `suppression échouée` et une nouvelle tentative vise encore uniquement cette clé.

Si le journal est inutilisable mais que l'identifiant a été affiché, la reprise automatique ne fait rien. L'opérateur peut, avec l'identité du probe, exécuter lui-même `aws s3api delete-object` sur la clé reconstruite. Il ne conclut que la suppression a été acceptée que si le fournisseur répond sans erreur. Il n'utilise ni `aws s3 rm` avec un préfixe, ni l'identité applicative, ni un listage. Cette action manuelle ne change pas `storageLiveCheck`.

### Checklist avant le premier probe

Cette liste n'a pas été cochée. Elle ne lance pas le probe.

Fluxora vérifie seul, avant tout client et avant tout appel réseau :

- `S3_LIVE_CHECK` vaut exactement `true` et `S3_LIVE_CONFIRM` vaut exactement `isolated`.
- `S3_LIVE_BUCKET`, `S3_LIVE_REGION`, `S3_LIVE_ACCESS_KEY_ID` et `S3_LIVE_SECRET_ACCESS_KEY` sont présents. La région est un nom simple, sans point.
- `S3_BUCKET`, `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY` sont présents. Le bucket et les deux identifiants du probe en diffèrent. La comparaison du nom de bucket ignore la casse.
- Si `S3_ENDPOINT` est présent, `S3_LIVE_ENDPOINT` est une URL `http` ou `https` d'une autre origine, sans identifiant dans l'URL, et ni son hôte ni son chemin ne désignent `S3_BUCKET`.
- `NODE_ENV` n'est pas `production`.

Un humain, ou le fournisseur, doit confirmer le reste. Fluxora ne peut pas le voir :

- Le bucket de test est dédié, vide, et ne contient aucun document client.
- Le blocage de l'accès public est actif.
- Le chiffrement par défaut est actif.
- Le versioning est désactivé. S'il reste actif, une suppression n'efface pas les versions anciennes : l'opérateur prévoit de les retirer sans listage de préfixe, ou il n'autorise pas le probe.
- L'identité est dédiée. Sa politique ne contient que `s3:GetObject`, `s3:PutObject` et `s3:DeleteObject` sur `organizations/s3-live-check/probes/*`.
- Les variables du probe sont dans le processus pour une seule commande. Leurs valeurs ne sont ni affichées, ni commitées, ni écrites dans le journal.
- La comparaison automatique a refusé les valeurs identiques. Elle ne se fait pas en lisant les secrets à voix haute. Deux noms différents ne suffisent pas à prouver l'isolation.
- L'opérateur autorise explicitement cette unique exécution.
- La procédure d'objet résiduel est connue : reprise par identifiant, sinon `aws s3api delete-object` sur la seule clé reconstruite, sans listage ni suppression de préfixe. Un résultat ambigu ne change pas `storageLiveCheck`.

### Décision : premier probe

Décision de mécanisme : **premier probe envisageable sous conditions**. Cette décision n'autorise pas l'exécution. Le probe et la reprise n'ont pas été lancés. `storageLiveCheck` reste `not_run`. `BACKUP_CONFIGURED` n'est pas modifié. Le stockage applicatif et les sauvegardes restent non validés.

Le code refuse le réseau tant que la configuration dédiée n'est pas valide. La reprise refuse aussi le réseau tant que l'identifiant n'est pas 16 caractères hexadécimaux et que le journal n'est pas cohérent. La seule clé supprimable est `organizations/s3-live-check/probes/{id}/probe.txt`, reconstruite depuis cet identifiant. Il n'y a ni listage ni suppression de préfixe. Une réponse `202`, ou toute réponse de suppression autre que `200` ou `204`, n'est pas une réussite. Un `404` de suppression n'est pas non plus une réussite : un objet peut rester. Le code `0` du probe exige que le journal relu porte le même état. Le code `0` de la reprise, lorsqu'une suppression a été demandée, exige l'acceptation HTTP et le même contrôle. Le code de sortie ne suffit pas : il faut lire le texte.

Conditions avant toute exécution réelle :

1. Bucket vide, isolé, distinct du bucket applicatif, avec blocage de l'accès public, chiffrement par défaut et versions désactivées. `S3_BUCKET` doit être présent pour la comparaison. Son absence bloque le probe. La différence de nom ne prouve pas l'isolation.
2. Identité dédiée, limitée à `s3:GetObject`, `s3:PutObject` et `s3:DeleteObject` sur le préfixe du probe. Pas de `ListBucket`.
3. Variables `S3_LIVE_*` présentes dans le processus, distinctes des identifiants applicatifs, avec `S3_LIVE_CHECK=true`, `S3_LIVE_CONFIRM=isolated` et `NODE_ENV` différent de `production`.
4. Compte système dédié à l'opérateur. Le dossier `storage/probe-journal` est créé par ce compte, n'est pas un lien, n'est pas partagé et n'est pas servi.
5. Autorisation humaine explicite pour une seule commande `npm run storage:probe`. Conserver la sortie, puis retirer les variables.

Risques résiduels acceptés seulement si ces conditions tiennent :

- Le journal n'est pas authentifié. Le même compte peut le modifier, le rejouer ou l'effacer. Il peut écrire `suppression réussie` sans appel fournisseur, ou effacer l'identifiant. Il ne peut pas, par le journal, faire supprimer une autre clé : une clé altérée est refusée.
- Le contrôle de lien précède l'ouverture. Ce n'est pas une protection atomique contre une course. Sous Windows, `O_NOFOLLOW` peut manquer, les modes `0700` et `0600` peuvent être ignorés, et la synchronisation du dossier peut échouer. Sur POSIX, la création exclusive du temporaire ne suit pas un lien déjà présent. Un lien dans un dossier parent est suivi.
- Deux reprises du même identifiant ne visent que sa clé. Une interruption laisse l'état déjà écrit. Un `.tmp` n'est pas lu.

Risques bloquants, qui interdisent le probe :

- compte système partagé, ou dossier de journal modifiable par un autre compte ;
- bucket ou identifiants non démontrés comme distincts de l'application ;
- politique plus large que les trois actions sur le préfixe du probe ;
- versions activées, accès public ouvert, ou documents clients dans le bucket.

Résultats :

- Probe `0`, texte d'acceptation, et journal relu au même état : la suppression HTTP de cette clé a été acceptée. Cela n'autorise ni le stockage applicatif, ni une sauvegarde, ni un pilote.
- Probe ou reprise `1`, ou texte indiquant que le journal ne confirme pas : ne pas conclure. Suivre la procédure ambiguë.
- Code `2` : aucun appel. Ne pas relancer sans corriger la condition refusée.
- Reprise `0` avec le texte « n'appelle pas le fournisseur » : aucune nouvelle confirmation. Ne pas traiter ce code comme la preuve qu'un objet a disparu.

Suppression ambiguë :

1. Ne pas relire le bucket et ne pas supprimer un préfixe.
2. Lire l'identifiant affiché et, s'il est encore cohérent, `storage/probe-journal/{id}.json`.
3. Reconstruire uniquement `organizations/s3-live-check/probes/{id}/probe.txt`.
4. Si le fichier est absent, tronqué ou incohérent, la reprise automatique ne fait rien. `aws s3api delete-object` sur cette seule clé, avec l'identité du probe, est la seule action manuelle. Elle n'est acceptée que si la commande fournisseur se termine sans erreur.
5. Si l'état est `suppression échouée`, `dépôt potentiellement effectué`, `dépôt effectué` ou `lecture vérifiée`, relancer `npm run storage:probe:recover -- <identifiant>` une fois. Un second code `1` laisse la possibilité d'un objet résiduel.
6. Ne pas modifier `storageLiveCheck` ni `BACKUP_CONFIGURED`.

### Contrôle applicatif, distinct du probe

Les tests automatisés déposent un fichier de test sur un disque temporaire ou un client simulé. Ils comparent les octets, refusent une autre organisation, refusent une clé étrangère avant lecture, traduisent une panne en « Stockage indisponible. » et ne suppriment que l'objet du test. Ils ne contactent pas un fournisseur.

Le contrôle sur le bucket applicatif reste à faire après un probe autorisé, avec les identifiants de l'application et un document de test non sensible :

1. déposer le fichier sous `organizations/{organizationId}/documents/{documentId}/original` ;
2. le télécharger par la route authentifiée et comparer les octets ;
3. vérifier que le compte autorisé peut le lire ;
4. vérifier qu'une autre organisation reçoit « Fichier introuvable. » ;
5. supprimer uniquement cet objet de test ;
6. si le fournisseur ne répond pas, la route répond « Stockage indisponible. » sans corps de réponse.

Ce contrôle ne change pas `BACKUP_CONFIGURED`. La sauvegarde PostgreSQL est décrite dans `docs/production-backups.md`.

## 5. Email

`EMAIL_DELIVERY_ENABLED=true`, `EMAIL_API_URL`, `EMAIL_API_KEY`. Le service métier appelle `sendMail`. Le fournisseur HTTP est remplaçable. `SUPPORT_INBOX` reçoit les demandes de support, sans le texte libre de la demande dans le journal.

## 6. Extraction

`MOCK_AI_MODE=false` et `OPENAI_API_KEY`. Sans cela, l'extraction reste simulée et le statut est `development`.

## 7. Facturation

Sans `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER` et `STRIPE_PRICE_PRO`, l'écran affiche « Billing non configuré » et le reste de l'application fonctionne.

Avec Stripe, le webhook `POST /api/stripe/webhook` est la seule preuve de paiement. Le retour navigateur ne change pas le plan. Un événement déjà reçu est ignoré.

## 8. Surveillance

`GET /api/health` répond sans secret. `GET /api/health/ready` vérifie PostgreSQL.

`ERROR_TRACKING_URL` reçoit l'erreur expurgée et un `correlationId`. `ALERT_WEBHOOK_URL` reçoit au plus une alerte toutes les 10 secondes. Aucun SDK Sentry n'est chargé.

Les journaux sont JSON : DEBUG, INFO, WARN, ERROR. DEBUG est tu en production, sauf `LOG_LEVEL=debug`.

## 9. Domaine

`AUTH_URL` et `APP_URL` en https. Derrière le proxy, `x-forwarded-proto: http` est redirigé vers https, sauf localhost. Les cookies de session sont `secure` en production. Les callbacks OAuth et les liens de facturation utilisent `APP_URL` puis `AUTH_URL`.

## 10. Déployer

```bash
npm run build
npm run start
```

Le processus doit voir les variables au démarrage. Un redémarrage est nécessaire après un changement de secret.

## 11. Fumée

Suivre `docs/go-live-checklist.md`, puis :

- la page d'accueil
- une inscription et un lien de vérification reçu par email
- une connexion et une déconnexion
- un document qui reste dans son organisation
- la facturation, configurée ou explicitement non configurée
- `/api/health` et `/api/health/ready`
- un compte manager qui ne publie pas un incident et n'ouvre pas la facturation
