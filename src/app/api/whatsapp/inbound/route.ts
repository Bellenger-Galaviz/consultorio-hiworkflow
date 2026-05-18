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
  agent: z
    .object({
      intent: z.string().optional(),
      normalizedDateTime: z.string().optional(),
      rangeStart: z.string().optional(),
      rangeEnd: z.string().optional(),
      period: z.string().optional(),
      selectedOption: z.number().optional()
    })
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

  if (!phone || !message) {
    return NextResponse.json({ ok: false, error: "Missing phone or message" }, { status: 400 });
  }

  const result = await handleIncomingWhatsAppMessage({ phone, message, agent: parsed.data.agent }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Unknown error"
  }));

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
