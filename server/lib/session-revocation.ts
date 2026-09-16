export type SupabaseSessionRevoker = {
  signOut: (
    jwt: string,
    scope: "global",
  ) => Promise<{ error: { message: string } | null }>;
};

export async function revokeAllSupabaseSessions(
  revoker: SupabaseSessionRevoker,
  jwt: string,
): Promise<{ revoked: true } | { revoked: false; error: string }> {
  try {
    const { error } = await revoker.signOut(jwt, "global");
    return error
      ? { revoked: false, error: error.message }
      : { revoked: true };
  } catch (error) {
    return {
      revoked: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}