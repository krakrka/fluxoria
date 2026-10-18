import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(production) }];
  },
};

export default nextConfig;
