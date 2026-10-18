import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16),
  MOCK_AI_MODE: z.enum(["true", "false"]).default("true"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  EMAIL_DELIVERY_ENABLED: z.enum(["true", "false"]).default("false"),
  EXPOSE_RESET_LINK: z.enum(["true", "false"]).default("true"),
  SENTRY_DSN: z.string().optional().default(""),
  S3_BUCKET: z.string().optional().default(""),
  S3_REGION: z.string().optional().default(""),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
}).superRefine((env, ctx) => {
  if (env.STORAGE_DRIVER !== "s3") return;
  for (const name of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
    if (!env[name].trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: "requis lorsque STORAGE_DRIVER=s3" });
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuration serveur invalide : ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function isMockAiMode() {
  return getEnv().MOCK_AI_MODE !== "false";
}
