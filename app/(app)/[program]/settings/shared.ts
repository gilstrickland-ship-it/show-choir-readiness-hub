import { flashSection, type FlashMap } from "@/lib/flash";

// The settings surface's URL contract (spec 005 Wave 13 / T164), written in the
// app's one flash idiom (lib/flash).
//
// What it replaces: `/settings` printed a single "Saved." for five different
// writes and kept three bare `?error=` branches inline in the page, so a failed
// support-consent toggle and a failed rename produced the same paragraph at the
// same place — the top of the page, above four unrelated concerns. `/members`
// and `/export` each hand-rolled the same thing again.
//
// Now every code names its own SECTION, once, here, so the message lands inside
// the block whose control produced it and the redirect that carries it and the
// block that renders it read the answer from the same place.

// ---------------------------------------------------------------------------
// /settings — the four titled sections, in their constant order. Email health is
// a read-only diagnostic (nothing there is a write), so it names no section.
// ---------------------------------------------------------------------------

export type SettingsSection = "program" | "share" | "support";

export type SettingsOkKey = "saved" | "revoked" | "granted" | "ended";
export type SettingsErrorKey =
  | "missing"
  | "timezone"
  | "save"
  | "revoke"
  | "support";

const SETTINGS_OK: FlashMap<SettingsOkKey, SettingsSection> = {
  saved: { section: "program", message: "Program details saved." },
  revoked: {
    section: "share",
    message: "Link revoked. That URL stops working immediately.",
  },
  granted: { section: "support", message: "Support access is on." },
  ended: { section: "support", message: "Support access ended." },
};

const SETTINGS_ERROR: FlashMap<SettingsErrorKey, SettingsSection> = {
  missing: {
    section: "program",
    message: "A program needs a name and a time zone.",
  },
  // Every date and time in the app — including the families' pages — is
  // rendered through this value, and an unknown zone throws rather than falling
  // back. It is refused at the door, not discovered on the next render.
  timezone: {
    section: "program",
    message:
      "That isn't a time zone we recognize. Pick one from the list and save again.",
  },
  save: { section: "program", message: "Couldn't save. Try again." },
  revoke: { section: "share", message: "Couldn't revoke that link. Try again." },
  support: {
    section: "support",
    message: "Couldn't change support access. Try again.",
  },
};

// An unrecognized `?error=` still says something out loud: a stale or renamed
// code means a write really did fail, and staff who see nothing assume it worked.
export const SETTINGS_FLASH_MAPS = {
  ok: SETTINGS_OK,
  error: SETTINGS_ERROR,
  fallbackSection: "program" as const,
};

// Where a section's messages and its `#anchor` both live. The id is the section
// key, so a redirect can scroll to the block it is about.
export const SETTINGS_ANCHOR: Record<SettingsSection, string> = {
  program: "program",
  share: "share-links",
  support: "support-access",
};

export function settingsOkAnchor(key: SettingsOkKey): string {
  return SETTINGS_ANCHOR[flashSection(SETTINGS_OK, key)];
}

export function settingsErrorAnchor(key: SettingsErrorKey): string {
  return SETTINGS_ANCHOR[flashSection(SETTINGS_ERROR, key)];
}

// ---------------------------------------------------------------------------
// /settings/members
// ---------------------------------------------------------------------------
//   page   — above the table: outcomes no single row owns.
//   invite — inside the "Invite someone" disclosure, which reopens on failure.
//   panel  — inside ONE member's Edit panel (arrives with `?edit=<memberId>`).

export type MemberSection = "page" | "invite" | "panel";

export type MemberOkKey = "saved" | "removed";
export type MemberErrorKey =
  | "invite"
  | "invite_director_only"
  | "role"
  | "remove"
  | "last_director"
  | "director_only";

const MEMBER_OK: FlashMap<MemberOkKey, MemberSection> = {
  saved: { section: "page", message: "Member updated." },
  removed: { section: "page", message: "Member removed." },
};

const MEMBER_ERROR: FlashMap<MemberErrorKey, MemberSection> = {
  invite: { section: "invite", message: "Enter an email address and a role." },
  role: { section: "panel", message: "Couldn't change that role. Try again." },
  remove: { section: "panel", message: "Couldn't remove that member. Try again." },
  // The guard that keeps a program from ending up with nobody who can run it.
  last_director: {
    section: "panel",
    message:
      "A program has to keep at least one director. Make someone else a director first, then change this one.",
  },
  // The other half of the same boundary: director is the seat every
  // director-only control answers to (support consent, unarchiving a season), so
  // handing it out is itself a director-only act. Without this an admin could
  // name their OWN row and walk up into it.
  director_only: {
    section: "panel",
    message:
      "Only a director can make someone a director. Ask your director to make this change.",
  },
  invite_director_only: {
    section: "invite",
    message:
      "Only a director can invite someone as a director. Pick another seat, or ask your director to send this invite.",
  },
};

export const MEMBER_FLASH_MAPS = {
  ok: MEMBER_OK,
  error: MEMBER_ERROR,
  fallbackSection: "page" as const,
};

export function memberErrorSection(key: MemberErrorKey): MemberSection {
  return flashSection(MEMBER_ERROR, key);
}

// True when this code belongs to one member's row rather than to the page.
export function isMemberRowError(key: MemberErrorKey): boolean {
  return memberErrorSection(key) === "panel";
}

export function staffMemberAnchor(memberId: string): string {
  return `member-${memberId}`;
}

// ---------------------------------------------------------------------------
// /settings/export — one message area.
// ---------------------------------------------------------------------------

export type ExportSection = "page";

export type ExportOkKey = "requested";
export type ExportErrorKey = "export";

const EXPORT_OK: FlashMap<ExportOkKey, ExportSection> = {
  requested: {
    section: "page",
    message:
      "Export requested — we're building your zip. It appears below when it's ready, and we'll email you a download link.",
  },
};

const EXPORT_ERROR: FlashMap<ExportErrorKey, ExportSection> = {
  export: { section: "page", message: "Couldn't start the export. Try again." },
};

export const EXPORT_FLASH_MAPS = {
  ok: EXPORT_OK,
  error: EXPORT_ERROR,
  fallbackSection: "page" as const,
};

export function exportJobAnchor(jobId: string): string {
  return `export-${jobId}`;
}
