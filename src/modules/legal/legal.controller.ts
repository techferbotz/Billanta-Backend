import { Request, Response } from "express";
import { renderDeleteAccount, renderPrivacyPolicy, renderTermsAndConditions } from "./legal.view";

// Public, server-rendered legal pages (HOA protocol 12). Plain HTML rather than the JSON envelope:
// these are the URLs on the Google Play listing, opened in a desktop browser by store reviewers
// and in an in-app browser tab by the app (which gets them from GET /config -> links.*).
export const legalController = {
  // GET /privacy — the Privacy Policy URL on the store listing.
  privacyPolicy(_req: Request, res: Response): void {
    res.type("html").send(renderPrivacyPolicy());
  },

  // GET /terms — Terms & Conditions.
  termsAndConditions(_req: Request, res: Response): void {
    res.type("html").send(renderTermsAndConditions());
  },

  // GET /delete-account — the "Delete account URL" on the Play listing. Must work without the app
  // and without signing in. The authenticated counterpart that does the work is DELETE /users/me.
  deleteAccount(_req: Request, res: Response): void {
    res.type("html").send(renderDeleteAccount());
  },
};
