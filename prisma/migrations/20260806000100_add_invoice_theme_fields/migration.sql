-- AlterTable: per-invoice template customisation, opaque to the server (APP-003).
ALTER TABLE "Invoice" ADD COLUMN     "themeOverrides" JSONB,
ADD COLUMN     "hiddenSections" JSONB;
