import type { Revisioned } from './persistence';

/** 组串采集读数 */
export interface Sample {
  id: string;
  /** 所属组串 */
  stringId: string;
  /** 采集时间 yyyy-MM-dd HH:mm */
  sampledAt: string;
  /** 电流（A） */
  currentA: number;
  /** 电压（V） */
  voltageV: number;
  /** 辐照度（W/m²） */
  irradianceWm2: number;
  /** 离散率（%），由 utils/discrete.ts 计算后落库 */
  discreteRate: number;
  createdAt: string;
}

/** 录入采集读数的表单草稿（离散率由系统计算） */
export interface SampleDraft {
  stringId: string;
  sampledAt: string;
  currentA: number;
  voltageV: number;
  irradianceWm2: number;
}

/** 离散率档位 */
export type DiscreteLevel = 'normal' | 'watch' | 'mismatch';

export const DISCRETE_LEVEL_LABEL: Record<DiscreteLevel, string> = {
  normal: '正常',
  watch: '关注',
  mismatch: '失配',
};

/** 采集行数据（带组串与设备上下文） */
export interface SampleRow extends Sample, Revisioned {
  stringCode: string;
  combinerBox: string;
  inverterId: string;
  inverterModel: string;
  arrayId: string;
  arrayCode: string;
  plantId: string;
  plantName: string;
  /** 辐照度归一化后的电流（折算到 1000 W/m²） */
  normalizedCurrentA: number;
}

/** 按组串聚合的统计结果，用于离散率榜 */
export interface StringDiscreteStat {
  stringId: string;
  stringCode: string;
  combinerBox: string;
  inverterId: string;
  arrayId: string;
  plantId: string;
  sampleCount: number;
  avgCurrentA: number;
  avgNormalizedCurrentA: number;
  discreteRate: number;
  /** 相对同汇流箱均值的偏差百分比 */
  currentBiasPercent: number;
  level: DiscreteLevel;
  lastSampledAt: string;
}

/** 采集时间排序辅助 */
export function compareBySampledAt(a: Sample, b: Sample): number {
  return a.sampledAt.localeCompare(b.sampledAt);
}
