"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AUTOMATION_RULES_HELP,
  type AutomationRuleKind,
  type AutomationRuleSlug,
} from "@/domain/rules";

export type AutomationRuleOption = {
  slug: AutomationRuleSlug;
  label: string;
  kind: AutomationRuleKind;
  enabled: boolean;
};

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function AutomationRulesPanel({
  rules,
}: {
  rules: readonly AutomationRuleOption[];
}) {
  const router = useRouter();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(slug: AutomationRuleSlug, enabled: boolean) {
    setPendingSlug(slug);
    setError(null);
    try {
      const response = await fetch("/api/automation-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, enabled }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(responseError(body, "Could not update that rule."));
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPendingSlug(null);
    }
  }

  return (
    <div className="automation-rules">
      <p className="settings-help">{AUTOMATION_RULES_HELP}</p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="automation-rule-list">
        {rules.map((rule) => (
          <li key={rule.slug}>
            <label className="automation-rule-toggle">
              <input
                checked={rule.enabled}
                disabled={pendingSlug === rule.slug}
                name={rule.slug}
                onChange={(event) => toggle(rule.slug, event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="automation-rule-toggle__label">{rule.label}</span>
                <span className="automation-rule-toggle__kind">
                  {rule.kind === "write" ? "Runs on save" : "Stale chip"}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
