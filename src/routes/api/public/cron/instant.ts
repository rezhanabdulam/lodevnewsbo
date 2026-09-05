import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/instant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        if (!key || key !== process.env["SUPABASE_PUBLISHABLE_KEY"]) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runInstant } = await import("@/lib/pipeline/instant.server");
        try {
          const stats = await runInstant();
          return Response.json({ ok: true, stats });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/instant]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
