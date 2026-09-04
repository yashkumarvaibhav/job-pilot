import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Protect your account · Job Pilot",
};

export default function SetupTotpPage() {
  redirect("/?auth=setup-totp");
}
