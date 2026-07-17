export default async function DashboardPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program } = await params;

  return (
    <section>
      <h1>Dashboard</h1>
      <p>Season overview for {program}.</p>
    </section>
  );
}
