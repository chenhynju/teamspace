/**
 * 敏感字段脱敏：递归遍历对象，命中敏感键名的值替换为 '***'。
 * 用于审计日志 before/after 落库，避免凭据/令牌泄露。
 */
const SENSITIVE_PATTERN =
  /(password|passwd|passwordhash|token|accesstoken|refreshtoken|secret|clientsecret|authorization|cookie|apikey|api_key)/i;

export const MASKED = '***';

export function maskSensitive<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => maskSensitive(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !(value instanceof BigInt)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (SENSITIVE_PATTERN.test(k)) {
        out[k] = MASKED;
      } else {
        out[k] = maskSensitive(v);
      }
    }
    return out as T;
  }
  return value;
}

/** BigInt 在 JSON 序列化前转为字符串/安全表示 */
export function normalizeForJson(value: any): any {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeForJson(v)]));
  }
  return value;
}
