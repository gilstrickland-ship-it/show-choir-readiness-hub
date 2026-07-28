// ============================================================================
// Unit tests — revoking a share link asks first (T143e)
// ----------------------------------------------------------------------------
// Revoking is the only IRREVERSIBLE act in the app, and it used to be one click.
// The URL dies immediately, every family holding it loses the schedule, and the
// only recovery is minting a new link and getting the new address to all of them
// — which, for a broadcast link that went out in a newsletter, may be nobody
// knows where. So it now uses the app's confirm idiom: the button is a LINK to
// `?confirm=revoke_<id>`, and the box that address opens holds the only form
// that can post the revoke.
//
// The thing worth testing is not that the confirm box renders — it is that the
// destructive control is UNREACHABLE without it. `revokeShareLinkAction` is
// posted by a form carrying `shareLinkId`, so the proof is that no such form
// exists in the markup until the URL names that exact link. This renders the
// real section (no DB, no Next runtime) and reads the HTML.
// ============================================================================

import { describe, test, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// next/link is a client component and this render has no Next runtime around it;
// an <a> is exactly what it emits, and the hrefs are what the assertions read.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

// The server-actions module reaches for Supabase, next/headers and next/cache at
// import time. The section only needs a function reference to hand to <form>.
vi.mock("@/app/(app)/[program]/settings/actions", () => ({
  revokeShareLinkAction: async () => undefined,
}));

import { ShareLinksSection } from "@/app/(app)/[program]/settings/ShareLinksSection";
import type { ActiveShareLink } from "@/lib/tokens";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const LINK_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LINK_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const LINKS: ActiveShareLink[] = [
  {
    id: LINK_A,
    resource: "itinerary",
    resource_id: "comp-1",
    created_at: "2026-04-01T12:00:00.000Z",
    expires_at: null,
  },
  {
    id: LINK_B,
    resource: "signup_page",
    resource_id: "season-1",
    created_at: "2026-04-02T12:00:00.000Z",
    expires_at: null,
  },
];

const SUBJECTS: Record<string, string> = {
  "comp-1": "Spring Invitational",
  "season-1": "2026 Season",
};

function render(confirmRevokeId: string | null): string {
  return renderToStaticMarkup(
    <ShareLinksSection
      programId={PROGRAM}
      slug="demo"
      tz="America/Chicago"
      flash={{ ok: null, error: null }}
      links={LINKS}
      unavailable={false}
      labelFor={(l) => SUBJECTS[l.resource_id] ?? null}
      confirmRevokeId={confirmRevokeId}
      revokeHref={(id) =>
        `/demo/settings${id ? `?confirm=revoke_${id}` : ""}#share-links`
      }
    />,
  );
}

// A form that can revoke is exactly a form carrying this hidden field. Counting
// them is the whole test: zero means the destructive action is not on the page.
const revokeForms = (markup: string, linkId: string): number =>
  markup.split(`name="shareLinkId" value="${linkId}"`).length - 1;

describe("Settings → Share links: revoke is behind a confirm", () => {
  test("with nothing confirmed, NO form that revokes anything exists", () => {
    const markup = render(null);
    // Both links are listed…
    expect(markup).toContain("Spring Invitational");
    expect(markup).toContain("2026 Season");
    // …and neither can be revoked from here.
    expect(markup).not.toContain("<form");
    expect(revokeForms(markup, LINK_A)).toBe(0);
    expect(revokeForms(markup, LINK_B)).toBe(0);
  });

  test("the first press is a link to the confirm address, not a submit", () => {
    const markup = render(null);
    expect(markup).toContain(
      `href="/demo/settings?confirm=revoke_${LINK_A}#share-links"`,
    );
    expect(markup).toContain("Revoke…");
    expect(markup).not.toContain('type="submit"');
  });

  test("confirming ONE link arms that link and only that link", () => {
    const markup = render(LINK_A);
    expect(revokeForms(markup, LINK_A)).toBe(1);
    // The other row is untouched — a confirm is about one address, never a mode
    // the whole table enters.
    expect(revokeForms(markup, LINK_B)).toBe(0);
    expect(markup).toContain("Revoke this link");
  });

  test("an id that names no live link arms nothing", () => {
    // A hand-typed or stale `?confirm=revoke_<uuid>` must not open a box for a
    // link this program does not have.
    const markup = render("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Revoke this link");
  });

  test("the confirm says what actually happens, in plain language", () => {
    const markup = render(LINK_A);
    // Immediate…
    expect(markup).toContain("The web address stops working immediately.");
    // …everyone holding it loses access…
    expect(markup).toContain("Everyone who already has it loses access");
    expect(markup).toContain("This link is no longer active");
    // …and it cannot be undone; a new link has to be made and sent out.
    expect(markup).toContain("no way to switch it back on");
    expect(markup).toContain("new link");
    expect(markup).toContain(
      "send the new address to everyone who needs it",
    );
    // It names the link it is about, so two live links can't be confused.
    expect(markup).toContain("Revoke the itinerary link for Spring Invitational?");
  });

  test("cancelling is offered, and it drops the confirm from the URL", () => {
    const markup = render(LINK_A);
    expect(markup).toContain('href="/demo/settings#share-links"');
    expect(markup).toContain("Keep it working");
  });

  test("a failed listing still renders no revoke form", () => {
    // `unavailable` is the read having failed. Nothing is listed, so nothing can
    // be revoked — including when the URL names a link id.
    const markup = renderToStaticMarkup(
      <ShareLinksSection
        programId={PROGRAM}
        slug="demo"
        tz="America/Chicago"
        flash={{ ok: null, error: null }}
        links={[]}
        unavailable
        labelFor={() => null}
        confirmRevokeId={LINK_A}
        revokeHref={(id) =>
          `/demo/settings${id ? `?confirm=revoke_${id}` : ""}#share-links`
        }
      />,
    );
    expect(markup).not.toContain("<form");
    expect(markup).toContain("couldn");
  });
});
