export function selectEligible(tasks, allowedScope) {
  const safePath = p => typeof p === 'string' && p.length > 0 &&
    !p.startsWith('/') && !p.includes('\\') && !/[^\u0020-\uFFFF]/.test(p) &&
    p.split('/').every(x => x !== '' && x !== '.' && x !== '..');
  if (!Array.isArray(tasks) || !safePath(allowedScope)) throw new TypeError('Invalid task selection input');
  const byId = new Map();
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) ||
        typeof task.id !== 'string' || task.id.length === 0 ||
        typeof task.status !== 'string' || !Number.isFinite(task.priority) ||
        !safePath(task.scope) || !Array.isArray(task.dependencies) ||
        !task.dependencies.every(x => typeof x === 'string' && x.length > 0)) {
      throw new TypeError('Malformed task');
    }
    if (byId.has(task.id)) throw new Error('Duplicate task id');
    byId.set(task.id, task);
  }
  return tasks.filter(task => task.status === 'queued' &&
    (task.scope === allowedScope || task.scope.startsWith(allowedScope + '/')) &&
    task.dependencies.every(id => byId.get(id)?.status === 'reviewed'))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
