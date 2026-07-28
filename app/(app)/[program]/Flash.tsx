import type { PageFlash } from "@/lib/flash";

// The app's one after-a-write message (spec 005 Wave 8 / T142). A server
// component: there is no state here, only what the URL says happened.
//
// It takes the page's resolved flash (lib/flash `readFlash`) and the section
// asking, and renders the ok and error messages that belong to THAT section —
// which is how a message lands beside the form that produced it instead of in a
// pile at the top of the page that the reader then has to map back to a control.
// A page with one message area passes its single section and gets the old
// behaviour; a page with several drops one of these into each.
//
// Both can render at once, and deliberately: "Saved." for the write that
// succeeded and a refusal for the one that didn't are two facts, not a choice.

export function Flash<S extends string>({
  flash,
  section,
}: {
  flash: PageFlash<S>;
  section: S;
}) {
  const ok = flash.ok?.section === section ? flash.ok.message : null;
  const error = flash.error?.section === section ? flash.error.message : null;
  if (!ok && !error) return null;
  return (
    <>
      {ok && <p className="alert-ok">{ok}</p>}
      {error && <p className="alert-error">{error}</p>}
    </>
  );
}
