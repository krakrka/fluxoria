# Go-live

Statut de cette machine au moment de la rédaction. Les valeurs de secrets ne sont pas listées.

Légende : READY, NOT_READY, NOT_CONFIGURED, BLOCKED.

## SECURITY

- [READY] Mots de passe hashés avec bcrypt. Session JWT 12 h. Cookie `secure` quand `NODE_ENV=production`.
- [READY] Déconnexion et révocation par `sessionVersion` après réinitialisation ou anonymisation.
- [READY] Permissions vérifiées dans les services, pas seulement dans l'interface.
- [NOT_CONFIGURED] Vérification email et réinitialisation : les liens sont préparés, l'envoi réel dépend de l'email.
- [READY] `EXPOSE_RESET_LINK=true` empêche le démarrage en production.

## DATABASE

- [READY] Migrations Prisma versionnées. Production : `npm run db:deploy`. `prisma db push` est exclu.
- [READY] Les tables métier portent `organizationId`, des index, des clés étrangères et des cascades.

## STORAGE

- [READY] Adaptateur `S3StorageProvider` derrière `DocumentStorage`, clés `organizations/{organizationId}/`.
- [NOT_CONFIGURED] Cette machine utilise le disque local. Le démarrage production refuse `STORAGE_DRIVER` autre que `s3` et des variables S3 vides. Aucun bucket réel n'a été testé.

## EMAIL

- [READY] `EmailProvider` interchangeable (`HttpMailProvider`). Vérification, invitation, reset, approbation, onboarding, facturation, support.
- [NOT_CONFIGURED] `EMAIL_DELIVERY_ENABLED` n'est pas activé. Aucun message ne part.

## AI

- [NOT_CONFIGURED] Extraction simulée (`MOCK_AI_MODE`). Un client payant a besoin d'une clé et de `MOCK_AI_MODE=false`.

## BILLING

- [NOT_CONFIGURED] Stripe. L'écran affiche « Billing non configuré ». L'application continue.
- [READY] Le webhook est la seule activation. Un événement déjà reçu est ignoré. Le retour navigateur ne change pas le plan.

## DOMAIN

- [NOT_CONFIGURED] Pas de domaine public https. En production, HTTP est redirigé vers HTTPS hors localhost.
- [NOT_READY] Cookies, callbacks OAuth et liens email/facturation ne sont pas encore pointés vers le domaine réel.

## MONITORING

- [READY] `GET /api/health` et `GET /api/health/ready`. Journaux JSON DEBUG, INFO, WARN, ERROR. DEBUG tu en production.
- [NOT_CONFIGURED] `ERROR_TRACKING_URL` et `ALERT_WEBHOOK_URL`. Aucun SDK Sentry n'est chargé.

## BACKUPS

- [NOT_CONFIGURED] Procédure dans `docs/production-backups.md`. `npm run backup:plan` n'écrit rien. `BACKUP_CONFIGURED` reste faux tant qu'une restauration isolée d'une sauvegarde planifiée n'a pas été vérifiée.

## LEGAL

- [BLOCKED] Pages en PLACEHOLDER JURIDIQUE. Avant un client payant, faire relire : CGV, confidentialité, cookies, mentions légales, sécurité, traitement des données, sous-traitants.
- Aucune conformité RGPD, ISO, SOC ou comptable n'est déclarée.

## SUPPORT

- [READY] Formulaire enregistré dans l'organisation. Publication d'incident limitée à `STATUS_EDITOR_EMAILS`.
- [NOT_CONFIGURED] Boîte `SUPPORT_INBOX` et envoi email.

## DEMO

- [READY] Atlas est une organisation `demo`. Les autres comptes ne voient pas ses factures. Le rappel de mot de passe disparaît en production.

## ADMIN

- [READY] `/admin/system` est limité à OWNER et ADMIN de leur organisation.
- [NOT_READY] Il n'existe pas de console Super Admin transverse. Le rôle EMPLOYEE n'existe pas : le compte salarié est MEMBER.

## Fumée après déploiement

- [ ] homepage
- [ ] signup
- [ ] email verification
- [ ] login
- [ ] onboarding
- [ ] document upload
- [ ] document processing
- [ ] invoice
- [ ] anomaly
- [ ] automation
- [ ] approval
- [ ] audit
- [ ] billing
- [ ] support
- [ ] admin
- [ ] logout
