export type FilterOption = { value: string; label: string };
export type PageSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function pageSearchParams(
  values: PageSearchParams | undefined,
): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values ?? {})) {
    const selected = Array.isArray(value) ? value[0] : value;
    if (selected) {
      search.set(key, selected);
    }
  }
  return search;
}

export function filterOptionValue<T extends FilterOption>(
  options: readonly T[],
  value: string | null,
): T["value"] | undefined {
  const needle = value?.trim().toLocaleLowerCase();
  if (!needle) {
    return undefined;
  }
  return options.find(
    (option) =>
      option.value.toLocaleLowerCase() === needle ||
      option.label.toLocaleLowerCase() === needle,
  )?.value;
}

export function positiveDayCount(value: string | null): number | undefined {
  const normalized = value?.trim() ?? "";
  if (!/^\d{1,3}$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return parsed >= 1 && parsed <= 365 ? parsed : undefined;
}

export function queryFlagEnabled(value: string | null): boolean {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** The list URL for a set of parameters — bare path when nothing is set. */
export function listHref(basePath: string, query: URLSearchParams): string {
  const value = query.toString();
  return value ? `${basePath}?${value}` : basePath;
}

/**
 * The same view with one filter removed. Every other parameter survives, which
 * is what lets a chip clear only itself rather than resetting the whole view.
 */
export function withoutParams(
  query: URLSearchParams,
  ...keys: string[]
): URLSearchParams {
  const next = new URLSearchParams(query);
  for (const key of keys) next.delete(key);
  return next;
}

/** "1 contact" / "12 contacts" — the toolbar states how many records it found. */
export function recordCountLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
