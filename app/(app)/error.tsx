"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-6 py-10">
      <h1 className="text-lg font-semibold">Cette page n&apos;a pas pu s&apos;afficher</h1>
      <p className="mt-2 text-sm text-muted">{error.message || "Une erreur inattendue s'est produite."}</p>
      <button className="mt-4 h-10 rounded-lg bg-accent px-4 text-sm text-accent-foreground" type="button" onClick={() => reset()}>
        Réessayer
      </button>
    </div>
  );
}
