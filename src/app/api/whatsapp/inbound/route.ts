import { NextResponse } from "next/server";
import { z } from "zod";
import { handleIncomingWhatsAppMessage } from "@/lib/whatsapp-bot";

const incomingSchema = z.object({
  phone: z.string().min(8).optional(),
  from: z.string().min(8).optional(),
  number: z.string().min(8).optional(),
  message: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  direction: z.string().optional(),
  deliveryMode: z.enum(["SEND", "COLLECT"]).optional(),
  fromMe: z.boolean().optional(),
  agent: z
    .object({
      intent: z.string().nullish(),
      normalizedDateTime: z.string().nullish(),
      rangeStart: z.string().nullish(),
      rangeEnd: z.string().nullish(),
      period: z.string().nullish(),
      selectedOption: z.number().nullish()
    })
    .nullable()
    .optional()
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");

  if (process.env.N8N_WEBHOOK_SECRET && secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = incomingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const phone = parsed.data.phone ?? parsed.data.from ?? parsed.data.number;
  const message = parsed.data.message ?? parsed.data.text ?? parsed.data.body;
  const direction = parsed.data.direction?.toUpperCase();
  const agent = parsed.data.agent
    ? {
        intent: parsed.data.agent.intent ?? undefined,
        normalizedDateTime: parsed.data.agent.normalizedDateTime ?? undefined,
        rangeStart: parsed.data.agent.rangeStart ?? undefined,
        rangeEnd: parsed.data.agent.rangeEnd ?? undefined,
        period: parsed.data.agent.period ?? undefined,
        selectedOption: parsed.data.agent.selectedOption ?? undefined
      }
    : undefined;

  if (!phone || !message) {
    return NextResponse.json({ ok: false, error: "Missing phone or message" }, { status: 400 });
  }

  if (parsed.data.fromMe || direction === "OUTBOUND") {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "IGNORED_OWN_MESSAGE"
    });
  }

  const result = await handleIncomingWhatsAppMessage({
    phone,
    message,
    deliveryMode: parsed.data.deliveryMode,
    agent
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Unknown error"
  }));

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
