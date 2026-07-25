import { User } from "@prisma/client";

/// The authenticated user's own profile.
///
/// `googleId` is deliberately absent — it is an internal join key, and echoing it back
/// gives clients something to be tempted to authenticate with.
export interface UserDto {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
  isPremium: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserRequest {
  name?: string;
  /// `null` clears the photo; omitting the key leaves it unchanged.
  photoUrl?: string | null;
}

export const toUserDto = (user: User): UserDto => ({
  id: user.id,
  email: user.email,
  name: user.name,
  photoUrl: user.photoUrl,
  isPremium: user.isPremium,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});
