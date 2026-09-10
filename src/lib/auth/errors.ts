export function mapAuthError(error: { message?: string; status?: number } | null): string {
  if (error?.status === 429) return "Too many attempts. Please try again later.";
  return "We couldn't complete that request. Check your details and try again.";
}
