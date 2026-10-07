/**
 * 权限码匹配：支持超通配 '*' 与模块级通配（如 'project:*' 命中 'project:edit'）。
 */
export function hasPermission(granted: string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  return granted.some((g) => {
    if (!g.endsWith(':*')) return false;
    const prefix = g.slice(0, -1); // 保留末尾 ':'，如 'project:'
    return required.startsWith(prefix);
  });
}

export function hasAny(granted: string[], required: string[]): boolean {
  return required.some((r) => hasPermission(granted, r));
}
