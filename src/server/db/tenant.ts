export type TenantContext = Readonly<{
  userId: string;
  workspaceId: string;
}>;

export type TenantEntityKey = Readonly<{
  workspaceId: string;
  id: string;
}>;

export function createTenantContext(
  userId: string,
  workspaceId: string,
): TenantContext {
  if (userId.length === 0 || workspaceId.length === 0) {
    throw new Error("Tenant context requires both user and workspace ids.");
  }

  return Object.freeze({ userId, workspaceId });
}

export function tenantEntityKey(
  tenant: TenantContext,
  id: string,
): TenantEntityKey {
  return Object.freeze({ workspaceId: tenant.workspaceId, id });
}

export function isSameWorkspace(
  tenant: TenantContext,
  key: TenantEntityKey,
): boolean {
  return tenant.workspaceId === key.workspaceId;
}
