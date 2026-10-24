// Shared by the isolated test runner and a future explicitly approved scheduler.
// Does not create a timer, install a cron, or contact any service on import.
export async function sweep({ claim, remove, finish, limit = 25, enabled = false }) {
  if (!enabled) return { enabled: false, deleted: 0 };
  let deleted = 0;
  for (let i = 0; i < Math.min(Math.max(limit, 0), 100); i++) {
    const item = await claim();
    if (!item) break;
    if (item.state !== 'deleting' || !item.delete_token || !['taskflow-attachments', 'board-task-attachments'].includes(item.bucket)) throw new Error('invalid deletion claim');
    // Keep the sticky claim if Storage or finalization fails. A retry deletes
    // the same immutable object; only an acknowledged Storage result frees quota.
    await remove(item);
    await finish(item);
    deleted++;
  }
  return { enabled: true, deleted };
}
