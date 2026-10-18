import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { deliverDueBillingNotices, handleStripeEvent, stripeConfig, verifyStripeSignature, type StripeEvent } from "@/services/stripe-billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = rateLimit(`stripe:${ip}`, 120, 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: { message: "Trop de requêtes." } }, { status: 429 });
  const payload = await request.text();
  const secret = stripeConfig().webhookSecret;
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: { message: "Signature Stripe invalide." } }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: { message: "Événement illisible." } }, { status: 400 });
  }
  if (!event.id || !event.type || !event.data?.object) {
    return NextResponse.json({ error: { message: "Événement incomplet." } }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event);
    await deliverDueBillingNotices().catch(() => undefined);
    return NextResponse.json({ received: true, duplicate: result.duplicate, notice: result.notice });
  } catch {
    return NextResponse.json({ error: { message: "Événement non appliqué." } }, { status: 500 });
  }
}
