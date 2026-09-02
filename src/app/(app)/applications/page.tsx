import Link from "next/link";

import { ApplicationStageChip } from "@/components/application-status";
import { applicationResultLabel } from "@/domain/application";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listApplications } from "@/server/repos/applications";
import { versionDisplayNames } from "@/server/repos/documents";

export default async function ApplicationsPage() {
  const tenant = await requireTenant();
  const database = getDatabase();
  const applications = listApplications(database, tenant);
  const versionNames = versionDisplayNames(database, tenant);
  const versionLabel = (id: string | null) =>
    id === null ? "—" : (versionNames.get(id) ?? id);

  return (
    <section className="application-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Post-apply pipeline</p>
          <h1>Applications</h1>
          <p className="page-lede">
            Every submitted application, with its stage living on the
            opportunity rather than a second editing surface.
          </p>
        </div>
      </header>
      {applications.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>No applications. Mark an opportunity as applied.</p>
        </div>
      ) : (
        <>
          <div className="table-scroll application-table-wrap">
            <table className="tbl application-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Role</th>
                  <th scope="col">Applied on</th>
                  <th scope="col">Portal</th>
                  <th scope="col">Resume version</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((row) => (
                  <tr key={row.id}>
                    <td>{row.companyName}</td>
                    <td>
                      <Link
                        className="table-link"
                        href={`/opportunities/${row.opportunityId}#application`}
                      >
                        {row.role}
                      </Link>
                    </td>
                    <td className="tnum">{row.appliedOn}</td>
                    <td>{row.portal}</td>
                    <td>{versionLabel(row.resumeVersionId)}</td>
                    <td>
                      <ApplicationStageChip stage={row.stage} />
                    </td>
                    <td>{applicationResultLabel(row.stage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul aria-label="Applications" className="application-card-list">
            {applications.map((row) => (
              <li key={row.id}>
                <Link
                  className="application-list-card"
                  href={`/opportunities/${row.opportunityId}#application`}
                >
                  <span className="application-list-card__heading">
                    <strong>
                      {row.companyName} {row.role}
                    </strong>
                    <ApplicationStageChip stage={row.stage} />
                  </span>
                  <span>
                    {row.portal} · applied {row.appliedOn}
                  </span>
                  <span>{applicationResultLabel(row.stage)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
