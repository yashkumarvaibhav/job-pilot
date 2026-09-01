import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QuickAddDialog, trapDialogTab } from "./quick-add-dialog";

describe("quick-add dialog", () => {
  it("renders the modal contract and an explicit close control", () => {
    const html = renderToStaticMarkup(
      <QuickAddDialog
        onClose={() => undefined}
        returnFocusTo={null}
        title="Add to Job Pilot"
      >
        <button type="button">Add contact</button>
      </QuickAddDialog>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="quick-add-title"');
    expect(html).toContain('aria-label="Close quick add"');
    expect(html).toContain("Add contact");
  });

  it("wraps Tab and Shift+Tab inside the dialog", () => {
    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const container = { querySelectorAll: vi.fn(() => [first, last]) };
    const forward = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
    const backward = { key: "Tab", shiftKey: true, preventDefault: vi.fn() };

    trapDialogTab(container, forward, last);
    trapDialogTab(container, backward, first);

    expect(forward.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    expect(backward.preventDefault).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();
  });

  it("uses kit tokens for a raised dialog and a mobile bottom sheet", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const dialog = css.slice(
      css.indexOf(".quick-add-backdrop"),
      css.indexOf("/* Quick-add mobile sheet */"),
    );
    const mobile = css.slice(css.indexOf("/* Quick-add mobile sheet */"));

    expect(dialog).toContain("background: var(--raised)");
    expect(dialog).toContain("border: 1px solid var(--line)");
    expect(dialog).toContain("border-radius: var(--radius-lg)");
    expect(dialog).toContain("box-shadow: var(--shadow-lg)");
    expect(mobile).toContain("@media (max-width: 767px)");
    expect(mobile).toContain("border-bottom-right-radius: 0");
    expect(mobile).toContain("border-bottom-left-radius: 0");
  });
});
