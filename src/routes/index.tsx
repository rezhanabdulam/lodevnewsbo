import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in · Iran Desk Bot Console" },
      {
        name: "description",
        content:
          "Private admin console for the Iran–U.S. conflict Telegram news bot: sources, filters, cadence and publishing queue.",
      },
      { property: "og:title", content: "Iran Desk Bot Console" },
      {
        property: "og:description",
        content: "Private operations console for an automated Iran–U.S. conflict news bot.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"in" | "up">("in");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. Check your email to confirm, then sign in.");
        setMode("in");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-sm p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
          Iran Desk
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Bot operations console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Private access. Admin only.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "up" ? "Create admin account" : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-4 w-full text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {mode === "in"
            ? "First time? Create the admin account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
