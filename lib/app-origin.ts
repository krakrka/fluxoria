/** Public origin for emails, billing return URLs and OAuth callbacks. APP_URL wins over AUTH_URL. */
export function publicAppOrigin() {
  const raw = process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}
