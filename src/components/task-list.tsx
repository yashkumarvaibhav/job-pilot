import Link from "next/link";

import { TaskCompleteButton } from "@/components/task-forms";
import {
  TaskPriorityChip,
  TaskSourceChip,
  TaskStatusChip,
  taskEntityHref,
} from "@/components/task-status";
import type { TaskListItem } from "@/server/repos/tasks";

export function TaskCollection({
  empty,
  rows,
  showComplete,
}: {
  empty: string;
  rows: TaskListItem[];
  showComplete: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>{empty}</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-scroll task-table-wrap">
        <table className="tbl task-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Linked entity</th>
              <th scope="col">Due</th>
              <th scope="col">Priority</th>
              <th scope="col">Status</th>
              <th scope="col">Source</th>
              {showComplete ? <th scope="col">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = taskEntityHref(row.entityType, row.entityId);
              return (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>
                    {href && row.entityLabel ? (
                      <Link className="table-link" href={href}>
                        {row.entityLabel}
                      </Link>
                    ) : (
                      (row.entityLabel ?? "—")
                    )}
                  </td>
                  <td className="tnum">{row.dueOn ?? "—"}</td>
                  <td>
                    <TaskPriorityChip priority={row.priority} />
                  </td>
                  <td>
                    <TaskStatusChip status={row.status} />
                  </td>
                  <td>
                    <TaskSourceChip source={row.source} />
                  </td>
                  {showComplete ? (
                    <td>
                      <TaskCompleteButton taskId={row.id} />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul aria-label="Tasks" className="task-card-list">
        {rows.map((row) => {
          const href = taskEntityHref(row.entityType, row.entityId);
          return (
            <li className="task-list-card" key={row.id}>
              <span className="task-list-card__heading">
                <strong>{row.title}</strong>
                <TaskStatusChip status={row.status} />
              </span>
              <span>
                {href && row.entityLabel ? (
                  <Link className="inline-link" href={href}>
                    {row.entityLabel}
                  </Link>
                ) : (
                  (row.entityLabel ?? "Standalone")
                )}
              </span>
              <span className="tnum">
                {row.dueOn ? `Due ${row.dueOn}` : "No due date"}
              </span>
              <span className="task-list-card__meta">
                <TaskPriorityChip priority={row.priority} />
                <TaskSourceChip source={row.source} />
              </span>
              {showComplete ? <TaskCompleteButton taskId={row.id} /> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
