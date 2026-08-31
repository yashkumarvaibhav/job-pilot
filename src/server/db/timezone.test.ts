import { describe, expect, it } from "vitest";

import { assertIanaTimeZone, isValidIanaTimeZone } from "./timezone";

describe("IANA timezone validation", () => {
  it.each(["Asia/Kolkata", "America/New_York", "Europe/London", "Etc/UTC"])(
    "accepts %s",
    (timeZone) => {
      expect(isValidIanaTimeZone(timeZone)).toBe(true);
      expect(assertIanaTimeZone(timeZone)).toBe(timeZone);
    },
  );

  it.each(["", "  ", "Asia/Kolkata ", "UTC+05:30", "Mars/Olympus"])(
    "rejects %s",
    (timeZone) => {
      expect(isValidIanaTimeZone(timeZone)).toBe(false);
      expect(() => assertIanaTimeZone(timeZone)).toThrow(
        `Invalid IANA timezone: ${timeZone}`,
      );
    },
  );
});
