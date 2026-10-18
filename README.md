# Fluxora

Plateforme B2B pour automatiser les flux administratifs d'une PME : dépôt de documents, extraction simulée avec scores de confiance, validation humaine, factures, commandes, rapprochement, règles et journal d'audit.

B2B platform for French SMEs. Upload a document, review extracted fields with confidence scores, validate, match an invoice to a purchase order, and see the action in the audit log. No external AI key is required.

## Démarrage / Setup

1. Start PostgreSQL: `docker compose up -d`
2. Copy `.env.example` to `.env`
3. `npm install`
4. `npx prisma migrate dev`
5. `npm run db:seed`
6. `npm run dev`

Open http://localhost:3000

## Comptes de démonstration / Demo accounts

Mot de passe / password: `Fluxora-Demo-2026`

- owner@atlas-industrie.test — OWNER
- admin@atlas-industrie.test — ADMIN
- member@atlas-industrie.test — MEMBER
- accountant@atlas-industrie.test — ACCOUNTANT

Organisation isolée : owner@brume-conseil.test

`MOCK_AI_MODE=true` simule l'extraction. Les valeurs ne sont pas lues dans le fichier et ne sont jamais présentées comme certaines.

Mock mode does not read the file. Extracted values stay unvalidated until a person confirms them.

Aucun email n'est envoyé. `EMAIL_DELIVERY_ENABLED` reste à false.

## Rôles / Roles

- OWNER : organisation, facturation, suppression, membres, y compris admin
- ADMIN : membres (hors propriétaire), documents, règles, paramètres
- MEMBER : dépôt, lecture, correction et validation
- ACCOUNTANT : factures, commandes, rapprochement, relances, journal

## Vérifications / Checks

- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run test:e2e` (Playwright, base de données démarrée)

Le cadrage RGPD (export, suppression, conservation, consentement, journal) prépare le produit. Il ne constitue pas une conformité juridique certifiée.
