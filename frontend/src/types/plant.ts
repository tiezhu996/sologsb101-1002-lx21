import type { ThresholdConfig } from './settings';

/** 电站 */
export interface Plant {
  id: string;
  /** 电站名称 */
  name: string;
  /** 装机容量（MWp） */
  capacityMWp: number;
  /** 并网日期（ISO 日期字符串 yyyy-MM-dd） */
  gridDate: string;
  /** 纬度（度，北纬为正） */
  latitude: number;
  createdAt: string;
}

/** 新建/编辑电站的表单草稿 */
export interface PlantDraft {
  name: string;
  capacityMWp: number;
  gridDate: string;
  latitude: number;
}

/** 电站卡片回显：方阵数与告警组串数 */
export interface PlantSummary {
  plant: Plant;
  arrayCount: number;
  inverterCount: number;
  stringCount: number;
  alarmStringCount: number;
}

/** 纬度带（用于 /plants 筛选） */
export type LatitudeBand = 'low' | 'mid' | 'high';

export const LATITUDE_BAND_LABEL: Record<LatitudeBand, string> = {
  low: '低纬带（<25°）',
  mid: '中纬带（25°~35°）',
  high: '高纬带（>35°）',
};

/** 判断电站所属纬度带 */
export function latitudeBandOf(latitude: number): LatitudeBand {
  if (latitude < 25) return 'low';
  if (latitude <= 35) return 'mid';
  return 'high';
}

/** 统计电站容量占比（用于 StatBadge 占比展示） */
export function capacityShare(plant: Plant, all: Plant[]): number {
  const total = all.reduce((sum, item) => sum + item.capacityMWp, 0);
  if (total <= 0) return 0;
  return (plant.capacityMWp / total) * 100;
}

/** 依据阈值推算出该电站的告警判定口径，供电站页提示文案使用 */
export function plantAlarmHint(threshold: ThresholdConfig): string {
  return `离散率 ≥ ${threshold.discreteAlarmRate}% 判失配，电流偏差 ≥ ${threshold.currentBiasPercent}% 判可疑`;
}
