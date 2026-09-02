"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { railItems } from "@/lib/navigation";
import { trapDialogTab } from "./quick-add-dialog";
import { QUICK_ADD_ACTIONS, type QuickAddAction } from "./quick-add";

export type PaletteCatalog = {
  companies: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  opportunities: { id: string; role: string; companyName: string }[];
  savedSearches: {
    id: string;
    name: string;
    href: string;
    entityType: string;
  }[];
};

const EMPTY_CATALOG: PaletteCatalog = {
  companies: [],
  contacts: [],
  opportunities: [],
  savedSearches: [],
};

const ADD_ACTIONS = QUICK_ADD_ACTIONS.filter(
  (item) => !("disabled" in item),
);

export default function CommandPalette({
  catalog,
  onOpenChange,
  onQuickAdd,
  open,
  returnFocusTo,
}: {
  catalog?: PaletteCatalog;
  onOpenChange: (open: boolean) => void;
  onQuickAdd: (action: QuickAddAction) => void;
  open: boolean;
  returnFocusTo: HTMLElement | null;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<PaletteCatalog>(EMPTY_CATALOG);
  const loaded = catalog ?? fetched;

  function close() {
    onOpenChange(false);
  }

  useEffect(() => {
    if (catalog || !open) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/palette?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : EMPTY_CATALOG))
        .then((body: PaletteCatalog) => setFetched(body))
        .catch(() => {
          if (!controller.signal.aborted) setFetched(EMPTY_CATALOG);
        });
    }, query ? 120 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [catalog, open, query]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const container = dialog;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      container.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      trapDialogTab(container, event, document.activeElement);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => returnFocusTo?.focus());
    };
  }, [open, onOpenChange, returnFocusTo]);

  if (!open) return null;

  function go(href: string) {
    close();
    router.push(href);
  }

  return (
    <div
      className="command-palette-backdrop"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <section
        aria-labelledby="command-palette-title"
        aria-modal="true"
        className="command-palette"
        ref={dialogRef}
        role="dialog"
      >
        <header className="command-palette__header">
          <div>
            <p className="eyebrow">Jump</p>
            <h2 id="command-palette-title">Command palette</h2>
          </div>
          <button
            aria-label="Close command palette"
            className="command-palette__close"
            onClick={close}
            type="button"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <Command label="Command palette" loop vimBindings={false}>
          <Command.Input
            data-dialog-initial-focus
            onValueChange={setQuery}
            placeholder="Search contacts, jobs, or actions"
            value={query}
          />
          <Command.List>
            <Command.Empty>No matching screens, actions, or records.</Command.Empty>
            <Command.Group heading="Go to">
              {railItems.map((item) => (
                <Command.Item
                  key={item.href}
                  onSelect={() => go(item.href)}
                  value={`go ${item.label}`}
                >
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Add">
              {ADD_ACTIONS.map((item) => (
                <Command.Item
                  key={item.key}
                  onSelect={() => {
                    close();
                    onQuickAdd(item.key);
                  }}
                  value={item.label}
                >
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
            {loaded.savedSearches.length > 0 ? (
              <Command.Group heading="Saved searches">
                {loaded.savedSearches.map((item) => (
                  <Command.Item
                    key={item.id}
                    onSelect={() => go(item.href)}
                    value={`saved ${item.name}`}
                  >
                    {item.name}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {loaded.contacts.length > 0 ? (
              <Command.Group heading="Contacts">
                {loaded.contacts.map((item) => (
                  <Command.Item
                    key={item.id}
                    onSelect={() => go(`/contacts/${item.id}`)}
                    value={`contact ${item.name}`}
                  >
                    {item.name}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {loaded.companies.length > 0 ? (
              <Command.Group heading="Companies">
                {loaded.companies.map((item) => (
                  <Command.Item
                    key={item.id}
                    onSelect={() => go(`/companies/${item.id}`)}
                    value={`company ${item.name}`}
                  >
                    {item.name}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {loaded.opportunities.length > 0 ? (
              <Command.Group heading="Opportunities">
                {loaded.opportunities.map((item) => (
                  <Command.Item
                    key={item.id}
                    onSelect={() => go(`/opportunities/${item.id}`)}
                    value={`job ${item.companyName} ${item.role}`}
                  >
                    {item.role}
                    <span className="command-palette__meta">{item.companyName}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </section>
    </div>
  );
}
