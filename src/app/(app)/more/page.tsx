import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { railItems } from "@/lib/navigation";

const directMobileRoutes = new Set(["/", "/contacts", "/opportunities"]);

export default function MorePage() {
  const moreItems = railItems.filter(
    (item) => !directMobileRoutes.has(item.href),
  );

  return (
    <section className="placeholder-page">
      <p className="eyebrow">Navigation</p>
      <h1>More</h1>
      <nav aria-label="More destinations">
        <ul className="more-list">
          {moreItems.map((item) => (
            <li key={item.href}>
              <Link className="more-link" href={item.href}>
                {item.label}
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <SignOutButton className="btn btn--ghost more-sign-out" />
    </section>
  );
}
