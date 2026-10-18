import type { NextAuthConfig } from "next-auth";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/documents",
  "/invoices",
  "/orders",
  "/customers",
  "/suppliers",
  "/automations",
  "/reports",
  "/settings",
  "/audit",
  "/inbox",
  "/imports",
  "/sources",
  "/admin",
  "/attention",
  "/anomalies",
  "/approvals",
  "/notifications",
  "/onboarding",
  "/roi",
  "/search",
  "/billing",
  "/support",
  "/parcours",
];

export const authConfig = {
  trustHost: true,
  useSecureCookies: process.env.NODE_ENV === "production",
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const protectedPath = PROTECTED_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      );
      if (!protectedPath) return true;
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
