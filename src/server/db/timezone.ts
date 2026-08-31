export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0 || timeZone.trim() !== timeZone) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function assertIanaTimeZone(timeZone: string): string {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }

  return timeZone;
}
