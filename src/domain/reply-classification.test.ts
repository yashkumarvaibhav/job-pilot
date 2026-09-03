import { describe, expect, it } from "vitest";

import {
  REPLY_CLASSIFICATIONS,
  isReplyClassification,
  replyClassificationLabel,
} from "./reply-classification";

describe("manual reply classifications", () => {
  it("exposes exactly the seven section 21 choices", () => {
    expect(REPLY_CLASSIFICATIONS.map((item) => item.label)).toEqual([
      "Referral promised",
      "Referral submitted",
      "Declined",
      "Need to respond",
      "No opening",
      "Follow up later",
      "Not relevant",
    ]);
    expect(isReplyClassification("need_to_respond")).toBe(true);
    expect(isReplyClassification("positive")).toBe(false);
    expect(replyClassificationLabel("declined")).toBe("Declined");
  });
});
