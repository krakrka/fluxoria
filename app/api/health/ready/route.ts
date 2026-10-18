import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { logMetrics } from "@/lib/logger";
import { serviceConfiguration } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const services = serviceConfiguration();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      data: {
        status: "ready",
        database: "healthy",
        storage: services.storage,
        storageLiveCheck: "not_run",
        ai: services.ai,
        email: services.email,
        billing: services.billing,
        errorTracking: services.errorTracking,
        alerts: services.alerts,
        metrics: logMetrics(),
      },
    });
  } catch {
    return NextResponse.json(
      {
        data: {
          status: "not_ready",
          database: "unhealthy",
          storage: services.storage,
          storageLiveCheck: "not_run",
          ai: services.ai,
          email: services.email,
          billing: services.billing,
        },
      },
      { status: 503 },
    );
  }
}
