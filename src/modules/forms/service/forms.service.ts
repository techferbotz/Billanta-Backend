import { FORMS_CHECKSUM, FORMS_DOCUMENT } from "../../../fields/forms";

// GET /forms — the global business profile, customer, product and settings forms. Built once at
// startup from src/fields/forms.ts; no database, no per-caller variation.
export class FormsService {
  get(): { document: typeof FORMS_DOCUMENT; checksum: string } {
    return { document: FORMS_DOCUMENT, checksum: FORMS_CHECKSUM };
  }
}

export const formsService = new FormsService();
