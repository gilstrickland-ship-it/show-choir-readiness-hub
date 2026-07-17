import { notFound } from "next/navigation";
import { flag, type FlagKey, type FlaggableProgram } from "@/lib/flags";

// Server-side flag gate (Constitution VIII). A flagged-off route must 404 on the
// server, not merely hide in the nav — otherwise a guessed URL reaches a
// disabled feature. Call this at the top of every flag-gated page.
export function requireFlag(program: FlaggableProgram, key: FlagKey): void {
  if (!flag(program, key)) {
    notFound();
  }
}
