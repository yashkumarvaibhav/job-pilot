import { describe, expect, it } from "vitest";
import { getTableConfig, sqliteTable, text } from "drizzle-orm/sqlite-core";

import {
  sameWorkspaceForeignKey,
  workspaceEntityKey,
  workspaceOwnedEntityColumns,
} from "./schema";

describe("same-workspace schema helpers", () => {
  it("builds a composite tenant key and matching composite foreign key", () => {
    const parent = sqliteTable(
      "fixture_parent",
      { ...workspaceOwnedEntityColumns() },
      (table) => [workspaceEntityKey("fixture_parent", table)],
    );
    const child = sqliteTable(
      "fixture_child",
      {
        ...workspaceOwnedEntityColumns(),
        parentId: text("parent_id").notNull(),
      },
      (table) => [
        workspaceEntityKey("fixture_child", table),
        sameWorkspaceForeignKey("fixture_child_parent_fk", table, parent),
      ],
    );

    const parentConfig = getTableConfig(parent);
    const tenantIndex = parentConfig.indexes.find(
      (candidate) =>
        candidate.config.name === "fixture_parent_workspace_id_id_unique",
    );
    expect(tenantIndex?.config.unique).toBe(true);
    expect(
      tenantIndex?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    ).toEqual(["workspace_id", "id"]);

    const reference = getTableConfig(child)
      .foreignKeys.find(
        (candidate) => candidate.getName() === "fixture_child_parent_fk",
      )
      ?.reference();
    expect(reference?.columns.map((column) => column.name)).toEqual([
      "workspace_id",
      "parent_id",
    ]);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      "workspace_id",
      "id",
    ]);
  });
});
