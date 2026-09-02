export type FilterOption = { value: string; label: string };

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
