import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        if (!key || key !== process.env["SUPABASE_PUBLISHABLE_KEY"]) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runPublish } = await import("@/lib/pipeline/run.server");
        try {
          const result = await runPublish();
          return Response.json({ ok: true, result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/publish]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
