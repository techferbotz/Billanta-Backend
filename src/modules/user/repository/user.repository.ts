import { User } from "@prisma/client";
import { prisma } from "../../../prisma/client";

// All User database access. No Prisma outside this file.

export interface CreateUserData {
  googleId: string;
  email: string;
  name: string;
  photoUrl: string | null;
}

export interface UpdateUserProfileData {
  name?: string;
  photoUrl?: string | null;
}

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { googleId } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async create(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data });
  }

  // Attach a Google identity to an account that was matched by verified email.
  async linkGoogleId(id: string, googleId: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { googleId } });
  }

  async updateProfile(id: string, data: UpdateUserProfileData): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  }

  /**
   * Hard-delete the account and everything hanging off it.
   *
   * This is the Google Play "delete my account" obligation, so it must be a real delete,
   * not a soft one. Every child relation is declared `onDelete: Cascade`, so refresh
   * tokens (and, from later phases, company/customers/invoices/settings) go with it in a
   * single statement.
   */
  async deleteById(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }
}

export const userRepository = new UserRepository();
