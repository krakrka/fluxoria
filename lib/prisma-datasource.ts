function pooled(url: string) {
  return /[-.]pooler[.]|pgbouncer=true/i.test(url);
}

export function directUrlForPrisma(databaseUrl: string, directUrl: string | undefined) {
  const database = databaseUrl.trim();
  const direct = directUrl?.trim() ?? "";
  if (!database) return { error: "DATABASE_URL est absent." };
  if (direct && pooled(direct)) return { error: "DIRECT_URL pointe vers un pooler. Les migrations exigent la connexion directe." };
  if (!direct && pooled(database)) return { error: "DIRECT_URL est absent. Une URL poolée ne peut pas migrer." };
  return { directUrl: direct || database };
}
