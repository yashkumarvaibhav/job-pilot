import Link from "next/link";
import { AlarmClock } from "lucide-react";

import { ConvertDueItemButton, TaskCompleteButton } from "@/components/task-forms";
import { taskEntityHref } from "@/components/task-status";
import { isOverdueOn } from "@/domain/assessment";
import {
  TODAY_EMPTY,
  todayDoNowHeading,
  todayDoNowVerbForKey,
} from "@/domain/today";
import type { DueItem } from "@/server/repos/tasks";

function OverdueChip() {
  return (
    <span className="chip contact-status-chip" data-tone="danger">
      <AlarmClock aria-hidden="true" />
      Overdue
    </span>
  );
}

export function DueItemCollection({
  asOfOn,
  empty = TODAY_EMPTY,
  rows,
}: {
  asOfOn?: string;
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
              const overdue = asOfOn != null && isOverdueOn(row.dueOn, asOfOn);
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
                  <td className="tnum">
                    <span className="due-when">
                      {row.dueOn ?? "—"}
                      {overdue ? <OverdueChip /> : null}
                    </span>
                  </td>
                  <td>
                    {row.origin === "derived" ? (
                      <ConvertDueItemButton
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
          const overdue = asOfOn != null && isOverdueOn(row.dueOn, asOfOn);
          return (
            <li className="task-list-card" key={row.sourceKey}>
              <span className="task-list-card__heading">
                <strong>{heading}</strong>
                {overdue ? <OverdueChip /> : null}
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
