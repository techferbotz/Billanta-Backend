import { Router } from "express";
import { legalController } from "./legal.controller";
import { LEGAL_PATHS } from "./legal.view";

// Public, unauthenticated legal pages (HOA protocol 12), mounted at the root before any auth, so
// Play Console's crawler, store reviewers and the app's in-app browser all reach them freely.
// Each page has its canonical path (LEGAL_PATHS — what GET /config hands the app) plus aliases, so
// every URL that has ever been shared keeps working.
const router = Router();

router.get([LEGAL_PATHS.privacy, "/privacy-policy"], legalController.privacyPolicy);
router.get(
  [LEGAL_PATHS.terms, "/terms-of-service", "/terms-and-conditions"],
  legalController.termsAndConditions
);
router.get(
  [LEGAL_PATHS.deleteAccount, "/account-deletion", "/data-deletion"],
  legalController.deleteAccount
);

export default router;
