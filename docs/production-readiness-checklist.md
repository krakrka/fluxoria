# Préparation à la production — 18 octobre 2026

Ce document constate des preuves. Il ne lance ni probe, ni sauvegarde, ni paiement, ni envoi d'email. Fluxora n'est pas prêt pour des clients.

La reprise d'un document déjà commité ne duplique plus le même fait métier. Les quatre commandes ont été relancées après ce changement.

Légende : `PASS` preuve suffisante. `BLOCKED` une action empêche d'avancer. `NOT VERIFIED` la preuve n'a pas été obtenue. `NOT APPLICABLE` justification écrite.

## Vérifications de cette session

| Commande | Code | Observé |
|---|---|---|
| `npm run typecheck` | 0 | `tsc --noEmit` |
| `npm run lint` | 0 | eslint |
| `npm test` | 0 | 33 fichiers, 152 tests. PostgreSQL local `fluxora`, `fluxora_notice_test` pour l'outbox, `fluxora_job_test` pour les jobs, `fluxora_effect_test` pour les effets de l'extraction. Organisations synthétiques. Atlas et Brume non utilisés. |
| `npm run build` | 0 | `next build` termine. |
| `npm audit --omit=dev` | 1 | 5 avis. `next@15.5.28` garde `postcss@8.4.31`. Prisma 6.19.3 est la dernière version 6. Aucun correctif compatible appliqué. |
| `npm run test:e2e` | non exécuté | La suite se connecte aux comptes de démonstration. |
| `npm run storage:probe` | non exécuté | Aucun appel cloud. |
| Sauvegarde ou restauration réelle | non exécutée | Le runbook reste un plan. |

## Contrôles

| Contrôle | Preuve | Statut | Action | Responsable | Preuve pour PASS |
|---|---|---|---|---|---|
| Authentification serveur | Session JWT 12 h. `getTenant` refuse un `sessionVersion` périmé. Les routes privées passent par `requireApi` ou `requirePermission`. | PASS | Aucune sur le mécanisme. | code | Déjà observé dans le code et les tests de compte. |
| Autorisation par rôle | `can()` dans les services. Un MEMBER ne gère pas la facturation. Invitation OWNER refusée par le schéma. | PASS | Aucune. | code | Tests de permissions existants. |
| Isolation multi-tenant | Les requêtes métier filtrent `organizationId` issu de la session, pas du corps. Tests d'isolation documents, factures, anomalies. | PASS | Aucune sur le modèle actuel. | code | Les tests d'isolation restent verts. |
| Sécurité des fichiers | Téléchargement limité à l'organisation. Si la transaction échoue après l'écriture, la clé non référencée est supprimée. La réconciliation locale ne sort pas du dossier de l'organisation et ne touche pas un fichier référencé. Un crash entre l'écriture et ce nettoyage, ou un objet S3, n'est pas rattrapé : le client ne liste pas le bucket. | PASS | Relancer la réconciliation locale après un crash. Ne pas ajouter ListBucket pour ça. | code | Test d'échec de transaction sur un dossier temporaire. |
| Fichiers sur un bucket réel | Aucun appel fournisseur. `storageLiveCheck` est fixé à `not_run`. | BLOCKED | Bucket applicatif, identité et probe isolé autorisé. Voir plus bas. | opérateur, fournisseur | Probe réel code 0, journal relu, puis un contrôle applicatif hors documents clients. |
| Secrets dans le client | Pas de `NEXT_PUBLIC_`. Les erreurs API masquent une URL de base et un secret reconnaissable. Stripe ne renvoie plus le message du fournisseur. | PASS | Ne pas coller de secret dans le chat. | code | Revue du bundle et des réponses. |
| Secrets de production | Le fichier local n'est pas un secret manager. Le processus du shell n'avait aucune variable S3 lors du prévol. | BLOCKED | Déposer les secrets chez l'hébergeur, faire tourner la procédure de `docs/production-deployment.md`. | opérateur | Démarrage production sans secret dans le dépôt ni dans les journaux. |
| Rotation et fuite | Procédure écrite : révoquer, remplacer, changer `AUTH_SECRET`, ne pas recopier la valeur. | PASS | L'exécuter seulement en cas de fuite. | opérateur | Journal d'incident sans la valeur. |
| Migrations | Dossier versionné. `prisma db push` exclu. Colonne `appliedAt` ajoutée et appliquée localement. | PASS | `npm run db:deploy` sur la base cible, pas un reset. | opérateur | `migrate status` vide d'écart sur la base cible. |
| Build | `npm run build`, code 0. | PASS | Relancer sur l'environnement de déploiement. | code | Build de la révision déployée. |
| Tests unitaires | 152 tests, code 0, le 18 octobre. | PASS | Garder les tests négatifs. | code | Suite verte sur la révision livrée. |
| Tests E2E | Non lancés ici, parce qu'ils ouvrent Atlas et Brume. | NOT VERIFIED | Les relancer seulement si une copie de données, pas les organisations de démonstration, est acceptable. | opérateur | Rapport Playwright sans écriture sur Atlas ni Brume. |
| Probe S3 | Garde-fous inchangés : refus avant client si la configuration est ambiguë. 16 tests simulés. Commande non lancée. | BLOCKED | Bucket vide, accès public bloqué, chiffrement, versioning traité, identité à trois actions, variables dans le processus, autorisation explicite. | opérateur, fournisseur | Sortie du probe et journal relu. Deux noms de buckets ne suffisent pas. |
| Stockage applicatif | `STORAGE_DRIVER=local` dans le fichier. Noms `S3_*` absents. Tests simulés seulement. | BLOCKED | Configurer `s3` en production avec des variables distinctes du probe. | opérateur | Dépôt et lecture réels hors documents clients, après le probe. |
| Sauvegarde | Le runbook décrit dump, chiffrement, transfert, rétention, base `*_restore`, contrôles et alerte sans secret. RPO d'une journée et RTO non chiffrés sont des objectifs, pas des mesures. | NOT VERIFIED | Planifier la nuit `15 2 * * *` et une copie chiffrée hors serveur. | opérateur | Fichier chiffré hors serveur et empreinte conservée. |
| Restauration | `npm run backup:plan -- --restore` s'arrête avant connexion. Aucune restauration faite dans cette mission. | NOT VERIFIED | Restaurer dans `<base>_restore`, comparer comptes et migrations. | opérateur | Comptes concordants, puis seulement `BACKUP_CONFIGURED=true`. |
| `BACKUP_CONFIGURED` | Absent. Le plan refuse de le passer à vrai. | BLOCKED | Ne pas le forcer. | opérateur | Restauration isolée de la sauvegarde planifiée. |
| HTTPS public | Origine locale en `http` sur localhost. La redirection 308 et HSTS n'existent qu'en `NODE_ENV=production`. | BLOCKED | Publier `AUTH_URL` en `https://` avant un démarrage de production. | opérateur | Origine https servie, cookie sécurisé observé. |
| Surveillance | `/api/health` et `/api/health/ready` ne renvoient pas de secret. Ready interroge PostgreSQL. `/status` affiche « Non mesuré » sans incident. | PASS | Brancher `ALERT_WEBHOOK_URL` et `ERROR_TRACKING_URL`. | opérateur | Un envoi d'alerte expurgé reçu. |
| Limite de débit | Compteur en mémoire sur connexion, invitation, export, dépôt et webhook. Documenté comme non distribué. | NOT VERIFIED | Ajouter une limite partagée si plusieurs instances tournent. | opérateur | Compteur partagé entre instances, ou une seule instance assumée. |
| Emails | Abstraction présente. `EMAIL_DELIVERY_ENABLED` vaut `false` dans le fichier. Aucun envoi réel. | NOT VERIFIED | Configurer le fournisseur et envoyer un message de test. | opérateur | Message reçu, sans secret dans le journal. |
| Facturation | L'abonnement, `appliedAt` et `BillingNotice` sont dans la même transaction. La reprise est `npm run billing:notices`. Le code 0 ne prouve pas l'envoi. Le code 1 signale un passage impossible. Sans e-mail configuré, la notice reste `PENDING`. L'exemple cron Linux n'est pas installé. L'hôte réel est inconnu. Aucun webhook réel. | NOT VERIFIED | Installer la tâche sur l'hôte, avec `DATABASE_URL` du secret manager, et alerter sur le code 1 et les compteurs. Puis un webhook signé. | opérateur | Tâche observée une minute, puis un e-mail réel unique. |
| Quotas concurrents | Le dépôt et l'import de facture verrouillent la ligne d'organisation avant de compter. Un test crée deux factures en parallèle sous un plafond de 1 et n'en garde qu'une. | PASS | Aucune. | code | Le test de course reste vert. |
| En-têtes HTTP | La politique de production testée ne contient pas `unsafe-eval`. Elle garde `unsafe-inline`, faute de nonce vérifié sur les pages. HSTS n'est ajouté qu'en production. | PASS | Vérifier le rendu des pages sur le staging avant de retirer `unsafe-inline`. | opérateur | Pages chargées avec une politique sans `unsafe-inline`, ou décision écrite de le conserver. |
| Quotas | Factures, documents, invitations, règles et règles par défaut prennent le verrou `FOR UPDATE` dans la même transaction que la création. Isolation observée `read committed`. La course est prouvée par des transactions concurrentes dans un seul processus, sur `fluxora`. | PASS | Relancer la course depuis deux instances de staging. | code | Deux processus, sur deux instances, sous le même plafond. |
| Intégrations | Gmail, Outlook, Drive, OneDrive, Pennylane, Sage, Cegid et EBP ne sont pas opérationnels. Pennylane a un double de test. Les autres restent non branchés. | NOT VERIFIED | Ne pas les afficher comme actives. Brancher un fournisseur seulement avec une preuve. | opérateur | Appel réel hors de cette mission, journal sans secret. |
| Extraction | `MockAIProvider` reste le mode sans clé. Un échec simulé est libellé comme simulé. | NOT VERIFIED | `MOCK_AI_MODE=false` et une clé, sans appeler le fournisseur depuis cette mission. | opérateur | Extraction réelle sur un fichier synthétique. |
| Jobs | `npm run jobs:recover` reprend un `RECEIVED` de plus de deux minutes et un `PROCESSING` dont le bail de quinze minutes est expiré. Un traitement qui a perdu `startedAt` ne commit plus d'écriture. Rejouer le même document après le commit ne duplique pas la notification, l'exécution de règle, l'événement produit ni l'audit de ce fait. L'appel d'extraction déjà lancé n'est pas annulable. La commande n'est pas installée. | NOT VERIFIED | Installer la commande chaque minute, avec `DATABASE_URL` du secret manager, et alerter sur le code 1 et les compteurs. Déployer `20261018160000_processing_fact_dedupe` avant cette version. | opérateur | Tâche observée après un redémarrage, sans ouvrir `/admin/system`. |
| Pages juridiques | Les mentions « À COMPLÉTER » ont été remplacées par la liste de ce qui manque. Le bandeau PLACEHOLDER JURIDIQUE reste. Aucune raison sociale inventée. | BLOCKED | Faire remplir et valider raison sociale, contrat, confidentialité, sous-traitants et contact. | conseil juridique | Texte validé, bandeau retiré seulement après cette revue. |
| RGPD | Export et suppression de compte existent. Registre, bases légales, durées, transferts, sous-traitants, procédure de violation et contrats ne sont pas établis. | BLOCKED | Tenir le registre et faire relire. Ne pas déclarer la conformité. | conseil juridique | Registre et pages validés. |
| Incident | Procédure dans `docs/production-deployment.md`. La page de statut ne se déclare pas opérationnelle sans incident publié. | PASS | Désigner les emails `STATUS_EDITOR_EMAILS`. | opérateur | Un incident de test publié puis résolu, sans donnée client. |
| Rollback | Les migrations sont avancées. Pas de script de retour arrière automatique. La restauration de base est le retour. | NOT VERIFIED | Écrire le retour de la dernière migration avant de la déployer, et tester la restauration. | opérateur | Restauration isolée réussie. |
| Support | Le formulaire reste dans l'organisation. Aucune boîte `SUPPORT_INBOX` prouvée. | NOT VERIFIED | Ouvrir la boîte et un essai d'envoi. | opérateur | Demande reçue hors du dépôt. |
| Dépendances | Aucun correctif Next.js 15 ou Prisma 6 ne retire les avis. `postcss` reste dans Next.js 15.5.28. `deepmerge-ts` reste dans Prisma 6.19.3. `tinypool` reste sous Vitest 3.2.7, hors production. Plan : `docs/dependency-migration.md`. | BLOCKED | Branche séparée pour Next.js 16, Prisma suivant et Vitest 5. Ne pas lancer `npm audit fix --force`. | code | Audit production sans avis haut, ou risque accepté par écrit. |
| Démo et données | Atlas et Brume n'ont pas été modifiés par cette mission. Les tests unitaires créent des organisations synthétiques. | PASS | Ne pas réinitialiser la base. | code | Aucune suppression des organisations de démonstration. |

## RGPD — liste à tenir, non validée

- Registre des traitements : comptes, documents, factures, journaux, mesures produit.
- Base légale de chaque traitement : non choisie.
- Minimisation : les mesures produit ne copient pas le contenu des factures. À confirmer pour chaque connecteur avant branchement.
- Durées : le réglage de rétention de l'organisation ne remplace pas une durée légale écrite.
- Droits : export JSON et suppression de compte existent. Ils ne remplacent pas la procédure humaine.
- Sous-traitants et transferts : liste réelle absente. Ne pas inventer d'hébergeur.
- Violation : suivre la section Incident, puis le conseil pour l'autorité compétente. Aucun délai légal n'est configuré.
- Contrats de sous-traitance : absents.

## Probe S3 — rappel

La commande reste `npm run storage:probe`. Elle lit `process.env`, pas `.env`. Elle refuse avant tout réseau si `S3_LIVE_CHECK` n'est pas `true`, si `S3_LIVE_CONFIRM` n'est pas `isolated`, ou si le bucket et les identifiants applicatifs ne sont pas présents et distincts. Deux noms différents ne prouvent pas l'isolation. `storageLiveCheck` reste `not_run`.

## Préparation au staging

| Sujet | Où c'est prouvé | Ce qu'il reste |
|---|---|---|
| Typecheck, lint, tests unitaires, build | Machine locale. La plupart des tests PostgreSQL utilisent la base locale `fluxora` et un seul processus. L'outbox et les jobs utilisent chacun une base isolée et, pour une ligne, deux processus. Ce n'est pas un déploiement à deux serveurs. | Relancer la même suite sur le PostgreSQL de staging après `npm run db:deploy`. |
| Quotas d'invitation et de règles | Même transaction que la création, verrou `FOR UPDATE`, sur cette base locale. | Deux instances de staging qui créent en même temps. |
| Fichiers locaux | Dossier temporaire. La réconciliation ne supprime pas un fichier référencé ni celui d'une autre organisation. | Rien sur S3. Inventaire humain du préfixe si un crash suit un `PutObject`. |
| Notices d'abonnement | PostgreSQL isolé `fluxora_notice_test`. Deux processus du système pour une seule revendication. Pas de SMTP. La tâche planifiée n'est pas installée. | L'installer sur l'hôte réel. Webhook signé Stripe et un fournisseur qui honore ou non `Idempotency-Key`. |
| Avis npm | `npm audit --omit=dev` sur les versions installées. Aucun correctif Next.js 15 ou Prisma 6. | Branche séparée. Décision humaine d'accepter le risque ou de migrer. |
| Stockage, sauvegarde, HTTPS, secrets, juridique | Non prouvés. | Opérateur, hébergeur et conseil. Ne pas ouvrir un pilote avant ces preuves. |

## Conclusion de statut

Le code local se construit et passe ses tests. L'application n'est pas prête à être déployée. L'infrastructure n'est pas validée. Le produit n'est pas prêt pour les clients.
