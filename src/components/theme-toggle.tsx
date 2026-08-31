"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function resolveTheme(): Theme {
  const selected = document.documentElement.dataset.theme;

  if (selected === "light" || selected === "dark") {
    return selected;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribeToTheme(onChange: () => void) {
  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
  });
  preference.addEventListener("change", onChange);

  return () => {
    observer.disconnect();
    preference.removeEventListener("change", onChange);
  };
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "dark") {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height="18"
        viewBox="0 0 24 24"
        width="18"
      >
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    resolveTheme,
    () => "light" as Theme,
  );
  const nextTheme: Theme = theme === "dark" ? "light" : "dark";

  function toggleTheme() {
    document.documentElement.dataset.theme = nextTheme;

    try {
      localStorage.setItem("theme", nextTheme);
    } catch {}
  }

  return (
    <button
      aria-label={`Switch to ${nextTheme} theme`}
      className="theme-toggle"
      onClick={toggleTheme}
      type="button"
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}
