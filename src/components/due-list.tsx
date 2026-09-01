import Link from "next/link";

import { ConvertDueItemButton } from "@/components/task-forms";
import { taskEntityHref } from "@/components/task-status";
import type { DueItem } from "@/server/repos/tasks";

export function DueItemCollection({ rows }: { rows: DueItem[] }) {
  if (rows.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>Nothing due yet. Add a next action or a task to start the loop.</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-scroll task-table-wrap">
        <table className="tbl task-table">
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
              <th scope="col">Due</th>
              <th scope="col">Next step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = taskEntityHref(row.entityType, row.entityId);
              return (
                <tr key={row.sourceKey}>
                  <td>{row.title}</td>
                  <td>
                    {href ? (
                      <Link className="table-link" href={href}>
                        {row.entityLabel}
                      </Link>
                    ) : (
                      row.entityLabel
                    )}
                  </td>
                  <td className="tnum">{row.dueOn ?? "—"}</td>
                  <td>
                    {row.origin === "derived" ? (
                      <ConvertDueItemButton
                        sourceKey={row.sourceKey}
                        title={row.title}
                      />
                    ) : (
                      "Open task"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul aria-label="Due items" className="task-card-list">
        {rows.map((row) => {
          const href = taskEntityHref(row.entityType, row.entityId);
          return (
            <li className="task-list-card" key={row.sourceKey}>
              <span className="task-list-card__heading">
                <strong>{row.title}</strong>
              </span>
              <span>
                {href ? (
                  <Link className="inline-link" href={href}>
                    {row.entityLabel}
                  </Link>
                ) : (
                  row.entityLabel
                )}
              </span>
              <span className="tnum">
                {row.dueOn ? `Due ${row.dueOn}` : "No due date"}
              </span>
              {row.origin === "derived" ? (
                <ConvertDueItemButton
                  sourceKey={row.sourceKey}
                  title={row.title}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
