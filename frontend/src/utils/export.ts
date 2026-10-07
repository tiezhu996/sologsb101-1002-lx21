/** JSON 备份文件的下载与读取（纯浏览器实现） */
import { round } from './format';

/** 触发浏览器下载一个 JSON 文件 */
export function downloadJson(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（用于组串排查结果留档） */
export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const text = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell);
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\n');
  // 加 BOM，保证 Excel 正确识别 UTF-8 中文
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 读取用户选择的 JSON 文件 */
export async function readJsonFile<T>(file: File): Promise<T> {
  const text = await file.text();
  return JSON.parse(text) as T;
}

/** 生成带时间戳的备份文件名 */
export function backupFilename(prefix: string): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}-${stamp}.json`;
}

/** 按保留位数整理导出数值，避免浮点噪声 */
export function tidyNumber(value: number, digits = 2): number {
  return round(value, digits);
}
