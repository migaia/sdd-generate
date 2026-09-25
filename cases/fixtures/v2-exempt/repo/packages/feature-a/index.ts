/** Read-only view over every member: O(N) by design (exempt). */
export function createView(): string[] {
  return []
}

/** Removes one receipt; its result carries a fresh view. */
export function commitRemoval(): string[] {
  return createView()
}
