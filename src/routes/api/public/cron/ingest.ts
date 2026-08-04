import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        if (!key || key !== process.env["SUPABASE_PUBLISHABLE_KEY"]) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runIngest } = await import("@/lib/pipeline/run.server");
        try {
          const stats = await runIngest();
          return Response.json({ ok: true, stats });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/ingest]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
