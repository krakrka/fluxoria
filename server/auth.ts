import "server-only";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/server/auth.config";
import { prisma } from "@/server/db";
import { loginSchema } from "@/lib/schemas";
import { resolveActiveMembership } from "@/lib/active-organization";
import type { MemberRole } from "@/lib/permissions";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user) return null;
        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          include: { memberships: { orderBy: { createdAt: "asc" } } },
        });
        const membership = dbUser
          ? resolveActiveMembership(dbUser.memberships, dbUser.activeOrganizationId)
          : null;
        token.userId = user.id;
        token.organizationId = membership?.organizationId;
        token.role = membership?.role;
        token.sessionVersion = dbUser?.sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = String(token.userId ?? "");
      session.organizationId = token.organizationId as string | undefined;
      session.role = token.role as MemberRole | undefined;
      session.sessionVersion = Number(token.sessionVersion ?? 0);
      return session;
    },
  },
});
