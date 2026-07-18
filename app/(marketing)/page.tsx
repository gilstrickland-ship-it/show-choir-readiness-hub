import { brand } from "@/lib/brand";

export default function LandingPage() {
  return (
    <main>
      <h1>{brand.name}</h1>
      <p>Season OS for competitive show choir.</p>
      <p>
        Questions? <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
      </p>
    </main>
  );
}
