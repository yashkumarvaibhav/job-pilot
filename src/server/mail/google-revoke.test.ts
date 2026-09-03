import { describe, expect, it, vi } from "vitest";

import { revokeGoogleRefreshToken } from "./google-revoke";

describe("Google token revocation", () => {
  it("posts the refresh token to Google's revocation endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(
      revokeGoogleRefreshToken("synthetic-refresh", fetcher),
    ).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      }),
    );
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toBe(
      "token=synthetic-refresh",
    );
  });

  it("reports a remote or network failure without exposing the token", async () => {
    const refused = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));

    await expect(revokeGoogleRefreshToken("token-a", refused)).resolves.toBe(false);
    await expect(revokeGoogleRefreshToken("token-b", offline)).resolves.toBe(false);
  });
});
