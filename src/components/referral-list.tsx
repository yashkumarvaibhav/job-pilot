import Link from "next/link";

import { ReferralStageChip } from "@/components/referral-status";
import { StaleFlag } from "@/components/stale-chip";
import type { StaleMark } from "@/domain/rules";
import type { ReferralListItem } from "@/server/repos/referrals";

export function ReferralCollection({
  empty,
  labelledBy,
  rows,
  staleById,
}: {
  empty: string;
  labelledBy?: string;
  rows: ReferralListItem[];
  staleById?: Map<string, StaleMark[]>;
}) {
  if (rows.length === 0) {
    return <p className="section-empty">{empty}</p>;
  }

  return (
    <>
      <div className="table-scroll referral-table-wrap">
        <table className="tbl referral-table">
          <thead>
            <tr>
              <th scope="col">Contact</th>
              <th scope="col">Company</th>
              <th scope="col">Role</th>
              <th scope="col">Stage</th>
              <th scope="col">Requested on</th>
              <th scope="col">Follow-up</th>
              <th scope="col">Next action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link className="table-link" href={`/referrals/${row.id}`}>
                    {row.contactName}
                  </Link>
                </td>
                <td>{row.companyName ?? "—"}</td>
                <td>{row.role ?? "—"}</td>
                <td>
                  <ReferralStageChip stage={row.stage} />
                  <StaleFlag reasons={staleById?.get(row.id) ?? []} />
                </td>
                <td className="tnum">{row.requestedOn ?? "—"}</td>
                <td className="tnum">{row.followUpOn ?? "—"}</td>
                <td>{row.nextAction ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul
        aria-labelledby={labelledBy}
        className="referral-card-list"
      >
        {rows.map((row) => (
          <li key={row.id}>
            <Link className="referral-list-card" href={`/referrals/${row.id}`}>
              <span className="referral-list-card__heading">
                <strong>{row.contactName}</strong>
                <ReferralStageChip stage={row.stage} />
              </span>
              <StaleFlag reasons={staleById?.get(row.id) ?? []} />
              <span>
                {row.companyName ?? "No company"}
                {row.role ? ` · ${row.role}` : ""}
              </span>
              <span className="tnum">
                {row.requestedOn
                  ? `Requested ${row.requestedOn}`
                  : "No request date"}
              </span>
              <span>{row.nextAction ?? "No next action"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
