/** 通用工具：本地 ID 生成与时间格式化（纯前端，不依赖后端） */

/** 生成短 ID：时间戳 36 进制 + 随机串，保证本机唯一 */
export function uuid(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${stamp}-${rand}`;
}

/** 当前时间 ISO 字符串 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** yyyy-MM-dd */
export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** yyyy-MM-dd HH:mm（本地时区） */
export function formatDateTime(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 在给定日期上偏移天数，返回 yyyy-MM-dd */
export function shiftDate(days: number, from: Date = new Date()): string {
  const date = new Date(from.getTime());
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 数值安全解析（NaN 兜底 0） */
export function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 数值保留指定小数位 */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
