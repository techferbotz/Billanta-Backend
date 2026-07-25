// Request/response shapes for the auth endpoints.
//
// These are provider-agnostic on purpose. `POST /auth/google` is the only sign-in route
// today, but the token half of the contract (AuthResponse, RefreshRequest, LogoutRequest)
// says nothing about Google — adding `POST /auth/apple` later means one new request DTO
// and one new verifier, with no change to the shape clients already handle.

export interface GoogleLoginRequest {
  /// The idToken from Google Sign-In on the device. VERIFIED server-side; the client
  /// never sends email/name/photo, because we would have no way to trust them.
  idToken: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

/// The signed-in user as clients see them. Deliberately minimal — no googleId (an
/// internal join key) and no timestamps.
export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
  isPremium: boolean;
}

export interface AuthResponse {
  accessToken: string;
  /// Raw refresh token — returned exactly once, here. Only its hash is stored, so it can
  /// never be shown again. Clients must persist it securely (Android Keystore / EncryptedSharedPreferences).
  refreshToken: string;
  /// Access-token lifetime in SECONDS, so the client can refresh proactively rather than
  /// waiting for a 401.
  expiresIn: number;
  user: AuthUserDto;
}
