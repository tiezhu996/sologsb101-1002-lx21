/** 失配判定与电流归一化的阈值配置（/settings 页可编辑） */
export interface ThresholdConfig {
  /** 离散率关注阈值（%） */
  discreteWatchRate: number;
  /** 离散率失配阈值（%） */
  discreteAlarmRate: number;
  /** 电流偏差可疑阈值（%） */
  currentBiasPercent: number;
  /** 参与离散率计算的最少采集点数 */
  minSampleCount: number;
  /** 标准辐照度（W/m²），用于电流归一化 */
  standardIrradiance: number;
}

/** 默认阈值 */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  discreteWatchRate: 5,
  discreteAlarmRate: 10,
  currentBiasPercent: 8,
  minSampleCount: 3,
  standardIrradiance: 1000,
};

/** 阈值在 IndexedDB 中的存储行 */
export interface ThresholdRow extends ThresholdConfig {
  id: 'threshold';
  updatedAt: string;
}

/** 校验阈值是否自洽，返回错误文案数组 */
export function validateThresholds(config: ThresholdConfig): string[] {
  const errors: string[] = [];
  if (config.discreteWatchRate < 0) errors.push('离散率关注阈值不能为负');
  if (config.discreteAlarmRate <= config.discreteWatchRate) {
    errors.push('失配阈值必须大于关注阈值');
  }
  if (config.currentBiasPercent <= 0) errors.push('电流偏差阈值必须大于 0');
  if (config.minSampleCount < 1) errors.push('最少采集点数至少为 1');
  if (config.standardIrradiance <= 0) errors.push('标准辐照度必须大于 0');
  return errors;
}

/** 阈值摘要文案，用于 StatBadge 提示 */
export function thresholdSummary(config: ThresholdConfig): string {
  return `关注 ${config.discreteWatchRate}% / 失配 ${config.discreteAlarmRate}% / 偏差 ${config.currentBiasPercent}%`;
}
