import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    data: {
      name: "Fluxora API",
      authentication: "Session cookie Auth.js. Les routes métier exigent une session de l'organisation.",
      routes: [
        { method: "POST", path: "/api/documents", body: "multipart files" },
        { method: "GET", path: "/api/documents" },
        { method: "GET", path: "/api/documents/:id" },
        { method: "POST", path: "/api/documents/:id/process" },
        { method: "POST", path: "/api/documents/:id/validate" },
        { method: "POST", path: "/api/documents/:id/reject", body: "{ reason }" },
        { method: "PATCH", path: "/api/documents/:id/fields", body: "{ key, value }" },
        { method: "GET", path: "/api/invoices" },
        { method: "GET", path: "/api/purchase-orders" },
        { method: "GET", path: "/api/workflows" },
        { method: "POST", path: "/api/workflows" },
        { method: "GET", path: "/api/audit-logs" },
      ],
    },
  });
}
