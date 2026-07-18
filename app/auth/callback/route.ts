import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Magic-link / PKCE exchange. Supabase redirects here with a `code` after the
// user clicks the emailed link; we exchange it for a session (cookies are set
// via the SSR client) and forward to `next` (the return path captured at
// sign-in), defaulting to /launch (the post-sign-in router). `next` is constrained to a local
// path so the callback can't be used as an open redirect.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("redirect");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/launch";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=link_invalid`);
}
