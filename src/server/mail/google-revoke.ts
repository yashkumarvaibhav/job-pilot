const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export async function revokeGoogleRefreshToken(
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
