export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** Push is optional: without VAPID keys the feature is off instead of breaking the build. */
export function getVapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT || "mailto:admin@example.com" };
}
