"use client";

import { useEffect } from "react";

export const QUICK_ADD_OPEN_EVENT = "job-pilot:open-quick-add";

export function QuickAddLaunch() {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(QUICK_ADD_OPEN_EVENT));
  }, []);

  return null;
}
