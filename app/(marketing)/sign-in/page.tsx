import { redirect as redirectTo } from "next/navigation";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { signInWithPassword, sendMagicLink } from "./actions";
import PasswordInput from "./PasswordInput";

// Staff sign-in. Constitution II: this is the leadership team's login surface
// (5–12 accounts per program). No sign-up, no "create account" — parents and
// students are never users and are never invited to register here.

const ERRORS: Record<string, string> = {
  invalid_credentials: "That email and password didn't match. Try again.",
  link_failed: "We couldn't send a sign-in link to that address.",
  link_invalid: "That sign-in link has expired. Request a new one below.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; redirect?: string }>;
}) {
  const { error, sent, redirect } = await searchParams;
  const nextPath = redirect && redirect.startsWith("/") ? redirect : "/launch";

  // Already signed in? Skip the form and route to the right place.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirectTo(nextPath);

  return (
    <main className="auth">
      <h1>Sign in to {brand.name}</h1>
      <p className="muted">For program staff and board members.</p>

      {error && ERRORS[error] && <p className="alert-error">{ERRORS[error]}</p>}
      {sent && (
        <p className="alert-ok">
          If that address belongs to a staff account, a sign-in link is on its way.
          Check your spam folder if you don&apos;t see it in a couple of minutes.
        </p>
      )}

      <form action={signInWithPassword} className="stack">
        <input type="hidden" name="redirect" value={nextPath} />
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <PasswordInput />
        </label>
        <button type="submit">Sign in</button>
      </form>

      <div className="auth-divider">or</div>

      <form action={sendMagicLink} className="stack">
        <input type="hidden" name="redirect" value={nextPath} />
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <button type="submit" className="secondary">
          Email me a sign-in link
        </button>
      </form>
    </main>
  );
}
