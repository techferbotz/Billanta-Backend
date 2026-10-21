-- Server-driven fields (docs/FIELDS.md). A CLEAN BREAK, agreed while the app has no real users:
-- company, customer, product, settings, invoice and line rows now store their data as a `values`
-- JSON map of field id -> value. The old typed columns can't be converted meaningfully, so every
-- row of those tables is DISCARDED first (which also lets the NOT NULL `values` columns be added).
-- Users, sessions and templates are untouched here; the production wipe of those is a separate,
-- operator-run step (docs/DEPLOY.md).
DELETE FROM "InvoiceItem";
DELETE FROM "Invoice";
DELETE FROM "Product";
DELETE FROM "Customer";
DELETE FROM "Settings";
DELETE FROM "Company";

-- DropIndex
DROP INDEX "InvoiceItem_invoiceId_idx";

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "addressLine1",
DROP COLUMN "addressLine2",
DROP COLUMN "bankAccountNumber",
DROP COLUMN "bankIfsc",
DROP COLUMN "bankName",
DROP COLUMN "city",
DROP COLUMN "country",
DROP COLUMN "email",
DROP COLUMN "gstin",
DROP COLUMN "logoThumbnailUrl",
DROP COLUMN "logoUrl",
DROP COLUMN "name",
DROP COLUMN "phone",
DROP COLUMN "pincode",
DROP COLUMN "qrImageUrl",
DROP COLUMN "signatoryDesignation",
DROP COLUMN "signatoryName",
DROP COLUMN "signatureUrl",
DROP COLUMN "state",
DROP COLUMN "stateCode",
DROP COLUMN "upiId",
ADD COLUMN     "values" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "addressLine1",
DROP COLUMN "addressLine2",
DROP COLUMN "city",
DROP COLUMN "country",
DROP COLUMN "email",
DROP COLUMN "pincode",
DROP COLUMN "state",
DROP COLUMN "stateCode",
ADD COLUMN     "values" JSONB NOT NULL,
ALTER COLUMN "name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "defaultCurrency",
DROP COLUMN "defaultNotes",
DROP COLUMN "defaultTaxPercent",
DROP COLUMN "defaultTemplateId",
DROP COLUMN "invoiceNumberPrefix",
DROP COLUMN "nextInvoiceNumber",
ADD COLUMN     "values" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "companySnapshot",
DROP COLUMN "currency",
DROP COLUMN "customerId",
DROP COLUMN "customerSnapshot",
DROP COLUMN "discountBeforeTax",
DROP COLUMN "discountType",
DROP COLUMN "discountValue",
DROP COLUMN "dueDate",
DROP COLUMN "invoiceDate",
DROP COLUMN "notes",
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "values" JSONB NOT NULL,
ALTER COLUMN "invoiceNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InvoiceItem" DROP COLUMN "description",
DROP COLUMN "hsnSac",
DROP COLUMN "quantity",
DROP COLUMN "taxRatePercent",
DROP COLUMN "unitPrice",
ADD COLUMN     "lineId" TEXT NOT NULL,
ADD COLUMN     "values" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "hsnSac",
DROP COLUMN "imageThumbnailUrl",
DROP COLUMN "imageUrl",
DROP COLUMN "taxRatePercent",
DROP COLUMN "unit",
DROP COLUMN "unitPrice",
ADD COLUMN     "values" JSONB NOT NULL,
ALTER COLUMN "name" DROP NOT NULL;

-- DropEnum
DROP TYPE "DiscountType";

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_invoiceId_lineId_key" ON "InvoiceItem"("invoiceId", "lineId");

