import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create account · Job Pilot",
};

export default function SignupPage() {
  redirect("/?auth=sign-up");
}
