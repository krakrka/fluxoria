import { DefaultSession } from "next-auth";
import type { MemberRole } from "@/lib/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    organizationId?: string;
    role?: MemberRole;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    organizationId?: string;
    role?: MemberRole;
    sessionVersion?: number;
  }
}
