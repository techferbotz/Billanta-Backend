-- AlterTable: authorised-signatory identity on the company profile (BE-012).
-- Templates bind these as signature.name / signature.designation (the image stays signature.url).
ALTER TABLE "Company" ADD COLUMN     "signatoryName" TEXT,
ADD COLUMN     "signatoryDesignation" TEXT;
