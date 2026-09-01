import Link from "next/link";

import { ConvertDueItemButton, TaskCompleteButton } from "@/components/task-forms";
import { taskEntityHref } from "@/components/task-status";
import {
  TODAY_EMPTY,
  todayDoNowHeading,
  todayDoNowVerbForKey,
} from "@/domain/today";
import type { DueItem } from "@/server/repos/tasks";

export function DueItemCollection({
  empty = TODAY_EMPTY,
  rows,
}: {
  empty?: string;
  rows: DueItem[];
}) {
  if (rows.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>{empty}</p>
        <Link className="btn" href="/add">
          Add
        </Link>
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
              <th scope="col">Reason</th>
              <th scope="col">Due</th>
              <th scope="col">Next step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = taskEntityHref(row.entityType, row.entityId);
              const verb = todayDoNowVerbForKey(row.sourceKey);
              return (
                <tr key={row.sourceKey}>
                  <td>{verb}</td>
                  <td>
                    {href ? (
                      <Link className="table-link" href={href}>
                        {row.entityLabel}
                      </Link>
                    ) : (
                      row.entityLabel
                    )}
                  </td>
                  <td>{row.title}</td>
                  <td className="tnum">{row.dueOn ?? "—"}</td>
                  <td>
                    {row.origin === "derived" ? (
                      <ConvertDueItemButton
                        label={verb}
                        sourceKey={row.sourceKey}
                        title={row.title}
                      />
                    ) : row.taskId ? (
                      <TaskCompleteButton taskId={row.taskId} />
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
          const verb = todayDoNowVerbForKey(row.sourceKey);
          const heading = todayDoNowHeading(
            row.sourceKey,
            verb,
            row.entityLabel,
          );
          return (
            <li className="task-list-card" key={row.sourceKey}>
              <span className="task-list-card__heading">
                <strong>{heading}</strong>
              </span>
              <span>{row.title}</span>
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
                  label={verb}
                  sourceKey={row.sourceKey}
                  title={row.title}
                />
              ) : row.taskId ? (
                <TaskCompleteButton taskId={row.taskId} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
