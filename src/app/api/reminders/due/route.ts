import { NextResponse } from "next/server";
import { sendDueAutomaticReminders } from "@/lib/reminders";

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");

  if (process.env.N8N_WEBHOOK_SECRET && secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await sendDueAutomaticReminders().catch((error) => {
    return [
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }
    ];
  });

  return NextResponse.json({
    ok: results.every((result) => !("error" in result)),
    processed: results.length,
    results
  });
}
