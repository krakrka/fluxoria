import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/server/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const host = request.nextUrl.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  if (process.env.NODE_ENV === "production" && !local && request.headers.get("x-forwarded-proto") === "http") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
