import Link from "next/link";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 text-sm font-semibold tracking-tight">
        Fluxora
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </main>
  );
}
