/** 单位换算与格式化：功率、电流、百分比、辐照度 */

/** kW → MW，保留 2 位 */
export function kwToMw(kw: number): number {
  return Number((kw / 1000).toFixed(2));
}

/** MW → kW */
export function mwToKw(mw: number): number {
  return Number((mw * 1000).toFixed(1));
}

/** 功率格式化：自动选择 kW / MW / GW 口径 */
export function formatPower(kw: number): string {
  const abs = Math.abs(kw);
  if (abs >= 1_000_000) return `${(kw / 1_000_000).toFixed(2)} GW`;
  if (abs >= 1000) return `${(kw / 1000).toFixed(2)} MW`;
  return `${kw.toFixed(1)} kW`;
}

/** 安培 → 毫安 */
export function ampToMilliamp(amp: number): number {
  return Number((amp * 1000).toFixed(1));
}

/** 电流格式化：小于 1A 时用毫安展示 */
export function formatCurrent(amp: number): string {
  if (Math.abs(amp) < 1) return `${ampToMilliamp(amp).toFixed(0)} mA`;
  return `${amp.toFixed(2)} A`;
}

/** 百分比格式化（带正负号可选） */
export function formatPercent(value: number, digits = 2, withSign = false): string {
  const sign = withSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/** 辐照度展示 */
export function formatIrradiance(value: number): string {
  return `${value.toFixed(0)} W/m²`;
}

/** 电压展示 */
export function formatVoltage(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(3)} kV`;
  return `${value.toFixed(1)} V`;
}

/** 占比：分子/分母 × 100，保留 1 位 */
export function share(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

/** 归一化到 [0,1]，用于进度条 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 发电量估算：容量(kW) × 等效小时 → kWh */
export function estimateGeneration(capacityKw: number, equivalentHours: number): number {
  return Number((capacityKw * equivalentHours).toFixed(1));
}
