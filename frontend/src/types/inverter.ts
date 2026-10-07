import type { Revisioned } from './persistence';

/** 逆变器 */
export interface Inverter {
  id: string;
  /** 所属方阵 */
  arrayId: string;
  /** 型号 */
  model: string;
  /** 额定功率（kW） */
  ratedKw: number;
  /** MPPT 路数 */
  mpptCount: number;
  /** 投运日期 yyyy-MM-dd */
  commissionDate: string;
  createdAt: string;
}

/** 新建/编辑逆变器的表单草稿 */
export interface InverterDraft {
  arrayId: string;
  model: string;
  ratedKw: number;
  mpptCount: number;
  commissionDate: string;
}

/** 三级台账树的行数据：逆变器 → 汇流箱 → 组串 */
export interface InverterLedgerRow extends Inverter, Revisioned {
  arrayCode: string;
  plantId: string;
  plantName: string;
  /** 该逆变器下挂接的汇流箱编号集合 */
  boxCodes: string[];
  stringCount: number;
  alarmStringCount: number;
}

/** 每路 MPPT 平均承载组串数（超过 4 路时提示接线拥挤） */
export function stringsPerMppt(inverter: Inverter, stringCount: number): number {
  if (inverter.mpptCount <= 0) return stringCount;
  return Number((stringCount / inverter.mpptCount).toFixed(2));
}

/** 并网年限（用于台账内老设备标注） */
export function serviceYears(commissionDate: string, now: Date = new Date()): number {
  const date = new Date(`${commissionDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  return Number(((now.getTime() - date.getTime()) / (365.25 * 24 * 3600 * 1000)).toFixed(1));
}

/** 逆变器运行状态判定：按组串失配占比给出建议 */
export function inverterHealth(alarmStringCount: number, stringCount: number): '正常' | '关注' | '异常' {
  if (stringCount === 0) return '关注';
  const ratio = alarmStringCount / stringCount;
  if (ratio >= 0.3) return '异常';
  if (ratio > 0) return '关注';
  return '正常';
}
