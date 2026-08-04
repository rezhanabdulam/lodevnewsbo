import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

function expectedSecret(token: string): string {
  return createHash("sha256").update(`telegram-webhook:${token}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["TELEGRAM_BOT_TOKEN"];
        if (!token) return new Response("Not configured", { status: 500 });

        const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(provided, expectedSecret(token))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = (await request.json()) as any;
        const message =
          update.message ??
          update.edited_message ??
          update.channel_post ??
          update.my_chat_member;
        const chat = message?.chat;
        if (!chat?.id) return Response.json({ ok: true, ignored: true });

        const status = update.my_chat_member?.new_chat_member?.status;
        const removed = status === "left" || status === "kicked";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("chats").upsert(
          {
            chat_id: chat.id,
            title: chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? null,
            username: chat.username ?? null,
            type: chat.type ?? "private",
            active: !removed,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "chat_id" },
        );

        return Response.json({ ok: true });
      },
    },
  },
});
