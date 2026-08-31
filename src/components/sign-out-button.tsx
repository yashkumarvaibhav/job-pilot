"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
      setPending(false);
    }
  }

  return (
    <button
      className={className ?? "btn btn--ghost"}
      disabled={pending}
      onClick={signOut}
      type="button"
    >
      Sign out
    </button>
  );
}
