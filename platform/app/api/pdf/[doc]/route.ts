// React-PDF renderers land in T017 (bus manifest, room sheet, parent packet,
// board snapshot) — auth-checked, streamed, brand from lib/brand.ts. Stub only.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ doc: string }> },
) {
  const { doc } = await params;

  return new Response(`PDF renderer "${doc}" not implemented (see T017).`, {
    status: 501,
  });
}
