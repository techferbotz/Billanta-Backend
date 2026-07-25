import { Router, Request, Response } from "express";
import { PRIVACY_POLICY_HTML } from "./privacyPolicy";
import { TERMS_HTML } from "./terms";
import { DELETE_ACCOUNT_HTML } from "./deleteAccount";

// Public, unauthenticated legal pages. A reachable Privacy Policy and an Account Deletion URL are
// required by Google Play, and the app links to them directly. Mounted with no auth middleware,
// so Play Console's crawler and browsers reach them freely. Several path aliases are served so
// links keep working regardless of which form was used.
const router = Router();

const serve = (html: string) => (_req: Request, res: Response) => res.type("html").send(html);

const servePrivacy = serve(PRIVACY_POLICY_HTML);
const serveTerms = serve(TERMS_HTML);
const serveDeleteAccount = serve(DELETE_ACCOUNT_HTML);

router.get("/privacy", servePrivacy);
router.get("/privacy-policy", servePrivacy);
router.get("/terms", serveTerms);
router.get("/terms-of-service", serveTerms);
router.get("/terms-and-conditions", serveTerms);
router.get("/delete-account", serveDeleteAccount);
router.get("/account-deletion", serveDeleteAccount);
router.get("/data-deletion", serveDeleteAccount);

export default router;
