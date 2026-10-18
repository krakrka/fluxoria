import { NextResponse } from "next/server";
import { serviceConfiguration } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const services = serviceConfiguration();
  return NextResponse.json({
    data: {
      status: "ok",
      storage: services.storage,
      storageLiveCheck: "not_run",
      ai: services.ai,
      email: services.email,
      billing: services.billing,
      errorTracking: services.errorTracking,
    },
  });
}
