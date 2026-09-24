/**
 * Pure tree helpers for attendance bodies.
 *
 * A body tree is fully user-defined: names, type labels, and depth are data.
 * Nothing here treats a typeLabel as a product mode. Depth is unlimited; the
 * soft warning is a picker hint and must not be used to refuse a save.
 */

export const SOFT_BODY_DEPTH = 6;

/** ` › ` so a path reads `Parent › Child` in the picker and on the desk. */
export const BODY_PATH_SEPARATOR = ' › ';

export type BodyNode = {
  id?: number;
  name: string;
  typeLabel: string;
  createdAt: string;
  parentId?: number | null;
  sortOrder?: number;
  archivedAt?: string | null;
};

export type BodyTreeRow = {
  body: BodyNode;
  /** 1 for a root. */
  depth: number;
  pathNames: string[];
  /** Ancestor names plus this body's name. */
  path: string;
};

export function isArchived(body: { archivedAt?: string | null }): boolean {
  return typeof body.archivedAt === 'string' && body.archivedAt.length > 0;
}

export function compareSiblingOrder(
  a: { sortOrder?: number; createdAt: string; id?: number },
  b: { sortOrder?: number; createdAt: string; id?: number },
): number {
  const order =
    (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (order !== 0) return order;
  const created = a.createdAt.localeCompare(b.createdAt);
  if (created !== 0) return created;
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * The next `sortOrder` among bodies that already share `parentId`.
 * `null` is the root list.
 */
export function nextSiblingSortOrder(
  bodies: readonly { parentId?: number | null; sortOrder?: number }[],
  parentId: number | null,
): number {
  let max = -1;
  for (const body of bodies) {
    if ((body.parentId ?? null) !== parentId) continue;
    const order = body.sortOrder ?? -1;
    if (order > max) max = order;
  }
  return max + 1;
}

/**
 * Preorder walk. Siblings are ordered by `sortOrder`, then `createdAt`.
 * A parent id that does not exist on this device is treated as a root so the
 * body stays reachable.
 */
export function flattenBodyTree(bodies: readonly BodyNode[]): BodyTreeRow[] {
  const ids = new Set<number>();
  for (const body of bodies) {
    if (body.id !== undefined) ids.add(body.id);
  }

  const byParent = new Map<number | null, BodyNode[]>();
  for (const body of bodies) {
    const parent = body.parentId ?? null;
    const key = parent !== null && ids.has(parent) ? parent : null;
    const list = byParent.get(key) ?? [];
    list.push(body);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort(compareSiblingOrder);

  const rows: BodyTreeRow[] = [];
  const walk = (parent: number | null, ancestorNames: string[], depth: number) => {
    for (const body of byParent.get(parent) ?? []) {
      const pathNames = [...ancestorNames, body.name];
      rows.push({
        body,
        depth,
        pathNames,
        path: pathNames.join(BODY_PATH_SEPARATOR),
      });
      if (body.id !== undefined) walk(body.id, pathNames, depth + 1);
    }
  };
  walk(null, [], 1);
  return rows;
}

/** `rootId` plus every descendant, preorder, siblings by `sortOrder`. */
export function subtreeBodyIds(rootId: number, bodies: readonly BodyNode[]): number[] {
  const children = new Map<number, BodyNode[]>();
  for (const body of bodies) {
    if (body.id === undefined || body.parentId == null) continue;
    const list = children.get(body.parentId) ?? [];
    list.push(body);
    children.set(body.parentId, list);
  }
  for (const list of children.values()) list.sort(compareSiblingOrder);

  const ids: number[] = [];
  const seen = new Set<number>();
  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
    for (const child of children.get(id) ?? []) {
      if (child.id !== undefined) walk(child.id);
    }
  };
  walk(rootId);
  return ids;
}

export function bodyDepth(bodyId: number, bodies: readonly BodyNode[]): number {
  return flattenBodyTree(bodies).find((row) => row.body.id === bodyId)?.depth ?? 1;
}

/**
 * True when making `parentId` the parent of `bodyId` would close a cycle,
 * including a body parenting itself. `null` (move to root) never cycles.
 * An already-corrupt chain that loops also reports true so the write stops.
 */
export function wouldCycle(
  bodies: readonly BodyNode[],
  bodyId: number,
  parentId: number | null,
): boolean {
  if (parentId === null) return false;
  if (parentId === bodyId) return true;

  const byId = new Map<number, BodyNode>();
  for (const body of bodies) {
    if (body.id !== undefined) byId.set(body.id, body);
  }

  let cursor: number | null = parentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === bodyId || seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/**
 * Desk / dashboard subtitle.
 * A root is `name · typeLabel`. A nested body is its full path plus the
 * type label the admin gave it (`Parent › Child · typeLabel`).
 */
export function formatBodySubtitle(body: BodyNode, bodies: readonly BodyNode[]): string {
  const row = flattenBodyTree(bodies).find((entry) => entry.body.id === body.id);
  if (row && row.depth > 1) return `${row.path} · ${body.typeLabel}`;
  return `${body.name} · ${body.typeLabel}`;
}

/** Hint only. Callers must still save a body deeper than this. */
export function depthWarning(depth: number): string | null {
  if (depth > SOFT_BODY_DEPTH) {
    return `This body is ${depth} levels deep. Deeper trees still work; they are just harder to scan in the picker.`;
  }
  return null;
}
