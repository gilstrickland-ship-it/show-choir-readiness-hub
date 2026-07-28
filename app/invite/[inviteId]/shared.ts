import type { FlashMap } from "@/lib/flash";

// /invite/<id>'s URL contract (spec 005 Wave 13 / T165), in the app's one flash
// idiom — so the accept flow reads its message the same prototype-safe way every
// other surface does, and `?error=a&error=b` (an ARRAY) resolves to no message
// rather than to something React is asked to render.
//
// The code used to be a bare `?error=1`, which said nothing about WHICH refusal
// happened; there is still only one, and now it is named.

export type InviteSection = "page";
export type InviteErrorKey = "accept";

const INVITE_ERROR: FlashMap<InviteErrorKey, InviteSection> = {
  accept: {
    section: "page",
    message:
      "We couldn't accept this invite. It may have been used already, or withdrawn — ask your director to send a new one.",
  },
};

export const INVITE_FLASH_MAPS = { error: INVITE_ERROR };
