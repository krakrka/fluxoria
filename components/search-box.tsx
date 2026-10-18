"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = value.trim();
      router.replace(next ? `/search?q=${encodeURIComponent(next)}` : "/search");
    }, 300);
    return () => window.clearTimeout(handle);
  }, [router, value]);

  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder="Numéro, fournisseur, SIREN, montant…"
      aria-label="Recherche"
      className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm"
    />
  );
}
