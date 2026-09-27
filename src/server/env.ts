import "server-only";

export type ServerConfig = {
  appOrigin: string;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  invitePepper: string;
};

const requiredNames = ["APP_ORIGIN", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "INVITE_CODE_PEPPER"] as const;

function validUrl(value: string, protocols: string[]): boolean {
  try { const url = new URL(value); return protocols.includes(url.protocol) && !!url.hostname; }
  catch { return false; }
}

function isConfigured(name: typeof requiredNames[number], value: string | undefined): boolean {
  if (!value?.trim() || /replace-me|replace-with|your-project/i.test(value)) return false;
  if (name === "APP_ORIGIN") return validUrl(value, ["http:", "https:"]);
  if (name === "SUPABASE_URL") return validUrl(value, ["https:"]);
  if (name === "DATABASE_URL") return validUrl(value, ["postgres:", "postgresql:"]);
  if (name === "INVITE_CODE_PEPPER") return value.length >= 32;
  return true;
}

export function missingConfig(): string[] {
  return requiredNames.filter((name) => !isConfigured(name, process.env[name]));
}

export function getServerConfig(): ServerConfig {
  const missing = missingConfig();
  if (missing.length) throw new Error(`Missing server configuration: ${missing.join(", ")}`);
  const appOrigin = new URL(process.env.APP_ORIGIN!).origin;
  const supabaseUrl = new URL(process.env.SUPABASE_URL!).origin;
  const databaseUrl = process.env.DATABASE_URL!;
  if (process.env.NODE_ENV === "production" && !appOrigin.startsWith("https://")) throw new Error("APP_ORIGIN must use HTTPS in production");
  if (!supabaseUrl.startsWith("https://")) throw new Error("SUPABASE_URL must use HTTPS");
  const databaseUser = decodeURIComponent(new URL(databaseUrl).username);
  if (process.env.NODE_ENV === "production" && databaseUser !== "app_backend" && !databaseUser.startsWith("app_backend.")) {
    throw new Error("DATABASE_URL must use the app_backend role in production");
  }
  if (process.env.INVITE_CODE_PEPPER!.length < 32) throw new Error("INVITE_CODE_PEPPER must contain at least 32 characters");
  return { appOrigin, databaseUrl, supabaseUrl, supabaseAnonKey: process.env.SUPABASE_ANON_KEY!, invitePepper: process.env.INVITE_CODE_PEPPER! };
}
