import type { Revisioned } from './persistence';

/** 方阵 */
export interface Array {
  id: string;
  /** 所属电站 */
  plantId: string;
  /** 方阵编号，如 A1、B2 */
  code: string;
  /** 倾角（度） */
  tiltDeg: number;
  /** 朝向方位角（度，正南 180） */
  azimuthDeg: number;
  /** 方阵容量（kW） */
  capacityKw: number;
  createdAt: string;
}

/** 新建/编辑方阵的表单草稿 */
export interface ArrayDraft {
  plantId: string;
  code: string;
  tiltDeg: number;
  azimuthDeg: number;
  capacityKw: number;
}

/** 按电站展开方阵时的行数据（含下级逆变器数量统计） */
export interface ArrayRow extends Array, Revisioned {
  plantName: string;
  inverterCount: number;
  stringCount: number;
}

/** 最优朝向偏差：正南 180°，偏差越小越好 */
export function azimuthDeviation(azimuthDeg: number): number {
  return Math.abs(((azimuthDeg - 180 + 540) % 360) - 180);
}

/** 倾角区间标注（用于列表内联提示） */
export function tiltLabel(tiltDeg: number): '平铺' | '常规' | '陡倾' {
  if (tiltDeg < 10) return '平铺';
  if (tiltDeg <= 35) return '常规';
  return '陡倾';
}

/** 方阵容量换算为 MWp 口径，便于与电站装机对比 */
export function arrayCapacityMWp(array: Array): number {
  return array.capacityKw / 1000;
}
