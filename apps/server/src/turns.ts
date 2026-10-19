/**
 * One agent turn at a time per project.
 *
 * Two codex processes editing the same working tree would interleave their
 * writes, and the two commits that followed would each claim the other's
 * changes — "one turn = one commit" only holds when a project's turns are
 * serialised. Arrivals during a running turn wait in order and are told how
 * many turns are ahead of them.
 */

const tails = new Map<string, Promise<void>>();
const depth = new Map<string, number>();

export async function runExclusive<T>(
  projectId: string,
  onWait: (ahead: number) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const ahead = depth.get(projectId) ?? 0;
  depth.set(projectId, ahead + 1);
  if (ahead > 0) onWait(ahead);

  const prev = tails.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = prev.then(() => mine);
  tails.set(projectId, tail);

  await prev;
  try {
    return await fn();
  } finally {
    const remaining = (depth.get(projectId) ?? 1) - 1;
    if (remaining > 0) depth.set(projectId, remaining);
    else {
      depth.delete(projectId);
      if (tails.get(projectId) === tail) tails.delete(projectId);
    }
    release();
  }
}
