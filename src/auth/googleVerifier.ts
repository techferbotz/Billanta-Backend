import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env";
import { UnauthorizedError } from "../common/errors/AppError";

// The ONLY file in the codebase that imports google-auth-library.
//
// Everything above this boundary deals in a plain `VerifiedGoogleProfile`, so adding
// Apple Sign-In or phone OTP later means writing a sibling verifier — no service,
// controller or route changes.

/// A profile we have PROVEN belongs to the caller, by verifying Google's signature.
export interface VerifiedGoogleProfile {
  googleId: string; // Google's stable `sub` claim
  email: string;
  name: string;
  photoUrl: string | null;
}

// One client for the process; it caches Google's public signing certs internally, so
// verification does not hit the network on every sign-in.
const client = new OAuth2Client(config.googleClientId);

/**
 * Verify a Google idToken SERVER-SIDE and return the profile it attests to.
 *
 * This is the single most security-critical function in the app. An idToken is just a
 * signed JWT that the client hands us — without checking the signature, anyone could POST
 * `{"email": "someone@else.com"}` and receive that user's session. So:
 *
 *   - `verifyIdToken` checks Google's SIGNATURE, the `iss` claim, and `exp`.
 *   - `audience` pins the `aud` claim to OUR client id, so an idToken minted for a
 *     *different* app (which an attacker can legitimately obtain) is rejected here.
 *   - Every profile field below comes out of the VERIFIED payload. Fields sent in the
 *     request body are never read.
 */
export const verifyGoogleIdToken = async (idToken: string): Promise<VerifiedGoogleProfile> => {
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch (err) {
    // Signature mismatch, wrong audience, expired token, malformed JWT — all the same to
    // the caller. The detail is logged, not returned, so we don't help an attacker probe.
    console.warn("[googleVerifier] idToken verification failed:", (err as Error).message);
    throw new UnauthorizedError("Invalid Google idToken");
  }

  if (!payload) {
    throw new UnauthorizedError("Invalid Google idToken");
  }

  // `email_verified` guards the account-linking path in auth.service: we match an existing
  // account by email, so an unverified address would let someone claim another user's
  // account. Real Google sign-ins always carry a verified email.
  if (!payload.email || !payload.email_verified) {
    throw new UnauthorizedError("Google account has no verified email address");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    // `name` is optional in the Google payload but required by our User model; fall back
    // to the local-part of the email so sign-in never fails over a cosmetic field.
    name: payload.name?.trim() || payload.email.split("@")[0],
    photoUrl: payload.picture ?? null,
  };
};
