-- AlterEnum
ALTER TYPE "DocumentKind" ADD VALUE 'INVOICE';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "amountCents" INTEGER;

UPDATE "Document" AS d
SET "amountCents" = ROUND(REPLACE(f.value, ',', '.')::numeric * 100)::integer
FROM "DocumentField" AS f
WHERE f."documentId" = d.id
  AND f.key = 'amount_ttc'
  AND f.value ~ '^[0-9]+([.,][0-9]+)?$';
