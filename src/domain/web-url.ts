const WEB_ADDRESS_WITHOUT_SCHEME =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i;

export function canonicalHttpUrl(
  value: string,
  options: { inferHttps?: boolean } = {},
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  if (!hasScheme && (!options.inferHttps || !WEB_ADDRESS_WITHOUT_SCHEME.test(trimmed))) {
    return null;
  }

  try {
    const parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.pathname === "/" && parsed.search === "" && parsed.hash === "") {
      return parsed.origin;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
