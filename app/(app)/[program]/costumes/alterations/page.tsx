import { redirect } from "next/navigation";

// The Alterations queue is now the Wardrobe landing (/costumes). This legacy
// route redirects there, forwarding the saved/error flags the existing
// setAlterationStatus / updateAlterationNotes actions redirect back with (their
// default backTarget still points here). Keeps every old link + action working.

export default async function AlterationsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { saved, error } = await searchParams;
  const qs = new URLSearchParams();
  if (saved) qs.set("saved", saved);
  if (error) qs.set("error", error);
  const query = qs.toString();
  redirect(`/${slug}/costumes${query ? `?${query}` : ""}`);
}
