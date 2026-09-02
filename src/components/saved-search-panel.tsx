"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  SAVED_SEARCH_SEEDS,
  type SavedSearchEntityType,
} from "@/domain/saved-search";

export type SavedSearchListItem = {
  id: string;
  name: string;
  href: string;
};

export function SavedSearchPanel({
  entityType,
  query,
  searches,
}: {
  entityType: SavedSearchEntityType;
  query: string;
  searches: SavedSearchListItem[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const suggestions = SAVED_SEARCH_SEEDS.filter(
    (seed) => seed.entityType === entityType,
  );
  const listId = `${entityType}-saved-search-names`;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, entityType, query }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "Could not save this search.",
        );
        return;
      }
      setName("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Saved searches" className="saved-search-panel">
      {searches.length > 0 ? (
        <ul className="saved-search-list">
          {searches.map((item) => (
            <li key={item.id}>
              <Link className="saved-search-link" href={item.href}>
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="saved-search-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={`${entityType}-saved-search-name`}>Save this filter as</label>
          <input
            autoComplete="off"
            disabled={pending}
            id={`${entityType}-saved-search-name`}
            list={listId}
            onChange={(event) => setName(event.target.value)}
            placeholder={suggestions[0]?.name ?? "Name this search"}
            value={name}
          />
          <datalist id={listId}>
            {suggestions.map((seed) => (
              <option key={seed.name} value={seed.name} />
            ))}
          </datalist>
        </div>
        {error ? (
          <p className="form-alert" role="alert">
            <span aria-hidden="true">!</span>
            {error}
          </p>
        ) : null}
        <button className="btn btn--ghost" disabled={pending} type="submit">
          Save this filter
        </button>
      </form>
    </section>
  );
}
