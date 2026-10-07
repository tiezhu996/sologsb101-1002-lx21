/**
 * 离散率计算与判定
 * 离散率 = 标准差 / 均值 × 100%，衡量同一汇流箱内组串电流的一致性。
 * 纯函数，供采集页、排查工作台与处置单页共用。
 */
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '../types/settings';
import type { DiscreteLevel, Sample, StringDiscreteStat } from '../types/sample';
import { round } from './format';

/** 均值 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 样本标准差（n-1），样本数 < 2 时返回 0 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 离散率（%）= 标准差 / 均值 × 100 */
export function discreteRate(values: number[]): number {
  const avg = mean(values);
  if (avg <= 0) return 0;
  return round((stdDev(values) / avg) * 100, 2);
}

/** 电流归一化修正：把实测电流折算到标准辐照度下，消除云影/时段影响 */
export function normalizeCurrent(
  currentA: number,
  irradianceWm2: number,
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): number {
  if (irradianceWm2 <= 0) return round(currentA, 3);
  const ratio = config.standardIrradiance / irradianceWm2;
  // 辐照度极低时归一化会放大噪声，限制修正倍数上限为 2
  return round(currentA * Math.min(ratio, 2), 3);
}

/** 离散率档位判定 */
export function levelOf(rate: number, config: ThresholdConfig = DEFAULT_THRESHOLDS): DiscreteLevel {
  if (rate >= config.discreteAlarmRate) return 'mismatch';
  if (rate >= config.discreteWatchRate) return 'watch';
  return 'normal';
}

/** 电流偏差百分比：相对基准值（同汇流箱均值）的偏离 */
export function currentBiasPercent(value: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return round(((value - baseline) / baseline) * 100, 2);
}

/** 按时间序列计算某组串的离散率（逐点滚动均值法，取最后一个窗口作为当前离散率） */
export function rollingDiscreteRate(samples: Sample[], windowSize = 5): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
  const window = sorted.slice(-Math.max(2, windowSize));
  return discreteRate(window.map((item) => normalizeCurrent(item.currentA, item.irradianceWm2)));
}

/** 分组键：同一逆变器 + 同一汇流箱视为一个可比对集合 */
export function groupKeyOf(row: { inverterId: string; combinerBox: string }): string {
  return `${row.inverterId}::${row.combinerBox}`;
}

/**
 * 采集点 → 折算电流的取数器。
 * 传入时按「限功率实际限值折算后的电流」进入归一化；不传则直接使用原始读数。
 * 参数为 stringId + 该条采集记录，返回该点用于统计的电流（A）。
 */
export type SampleCurrentAdjuster = (stringId: string, sample: Sample) => number;

/** 标记某组串窗口内是否命中限电时段（用于榜单标注） */
export type SampleCurtailMarker = (stringId: string, sample: Sample) => boolean;

/**
 * 由采集记录聚合出组串离散率榜。
 * 同一汇流箱内的组串电流互为基准：离散率按窗口内逐点电流计算，电流偏差相对同箱均值；
 * 限功率时段的采集点先经 adjuster 按实际限值折算还原，避免正常组串被压低后误推上失配榜。
 */
export function buildStringStats(
  samples: Sample[],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
  adjuster?: SampleCurrentAdjuster,
  curtailMarker?: SampleCurtailMarker,
): StringDiscreteStat[] {
  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.stringId);
    if (list) list.push(sample);
    else grouped.set(sample.stringId, [sample]);
  }

  interface Draft {
    stringId: string;
    values: number[];
    normalizedOnly: number[];
    raws: number[];
    lastSampledAt: string;
    count: number;
    curtailApplied: boolean;
  }

  const drafts: Draft[] = [];
  for (const [stringId, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
    const window = sorted.slice(-8);
    let curtailApplied = false;
    const values = window.map((item) => {
      const source = adjuster ? adjuster(stringId, item) : item.currentA;
      if (curtailMarker?.(stringId, item)) curtailApplied = true;
      return normalizeCurrent(source, item.irradianceWm2, config);
    });
    drafts.push({
      stringId,
      values,
      normalizedOnly: window.map((item) => normalizeCurrent(item.currentA, item.irradianceWm2, config)),
      raws: window.map((item) => item.currentA),
      lastSampledAt: sorted[sorted.length - 1]?.sampledAt ?? '',
      count: list.length,
      curtailApplied,
    });
  }

  const stats: StringDiscreteStat[] = drafts.map((draft) => ({
    stringId: draft.stringId,
    stringCode: '',
    combinerBox: '',
    inverterId: '',
    arrayId: '',
    plantId: '',
    sampleCount: draft.count,
    avgCurrentA: round(mean(draft.raws), 2),
    avgNormalizedCurrentA: round(mean(draft.normalizedOnly), 3),
    avgAdjustedCurrentA: round(mean(draft.values), 3),
    discreteRate: discreteRate(draft.values),
    currentBiasPercent: 0,
    curtailApplied: draft.curtailApplied,
    level: 'normal',
    lastSampledAt: draft.lastSampledAt,
  }));

  // 逐集合（逆变器 + 汇流箱）计算相对偏差与最终档位；
  // 设备上下文由调用方（sampleStore.hydrateStats）回填后再做同箱基准判定。
  const pendingBuckets = new Map<string, StringDiscreteStat[]>();
  for (const stat of stats) {
    const key = stat.inverterId ? groupKeyOf(stat) : '__pending';
    const list = pendingBuckets.get(key);
    if (list) list.push(stat);
    else pendingBuckets.set(key, [stat]);
  }

  const applyLevel = (bucket: StringDiscreteStat[]): void => {
    // 同箱基准：同一逆变器 + 同一汇流箱组串折算后均值；单串集合退回自身
    const baseline = mean(bucket.map((item) => item.avgAdjustedCurrentA));
    for (const stat of bucket) {
      const base = baseline > 0 ? baseline : stat.avgAdjustedCurrentA;
      stat.currentBiasPercent = currentBiasPercent(stat.avgAdjustedCurrentA, base);
      const tooFew = stat.sampleCount < config.minSampleCount;
      const badByRate = levelOf(stat.discreteRate, config);
      const badByBias =
        Math.abs(stat.currentBiasPercent) >= config.currentBiasPercent ? 'mismatch' : 'normal';
      const level: DiscreteLevel =
        badByRate === 'mismatch' || badByBias === 'mismatch'
          ? 'mismatch'
          : badByRate === 'watch'
            ? 'watch'
            : tooFew
              ? 'watch'
              : 'normal';
      stat.level = level;
    }
  };

  // 上下文尚未回填（纯函数单测场景）时先给一版，hydrate 后会按同箱口径重算
  for (const bucket of pendingBuckets.values()) applyLevel(bucket);

  return stats;
}

/**
 * 设备上下文回填后按同箱基准重算偏差与档位（sampleStore hydrate 时调用）。
 * 离散率本身不随分组变化，这里只重算同箱均值基准下的电流偏差与最终档位。
 */
export function rebaseStringStats(
  stats: StringDiscreteStat[],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): StringDiscreteStat[] {
  const buckets = new Map<string, StringDiscreteStat[]>();
  for (const stat of stats) {
    const key = stat.inverterId ? groupKeyOf(stat) : stat.stringId;
    const list = buckets.get(key);
    if (list) list.push(stat);
    else buckets.set(key, [stat]);
  }
  for (const bucket of buckets.values()) {
    const baseline = mean(bucket.map((item) => item.avgAdjustedCurrentA));
    for (const stat of bucket) {
      const base = baseline > 0 ? baseline : stat.avgAdjustedCurrentA;
      stat.currentBiasPercent = currentBiasPercent(stat.avgAdjustedCurrentA, base);
      const tooFew = stat.sampleCount < config.minSampleCount;
      const badByRate = levelOf(stat.discreteRate, config);
      const badByBias =
        Math.abs(stat.currentBiasPercent) >= config.currentBiasPercent ? 'mismatch' : 'normal';
      stat.level =
        badByRate === 'mismatch' || badByBias === 'mismatch'
          ? 'mismatch'
          : badByRate === 'watch'
            ? 'watch'
            : tooFew
              ? 'watch'
              : 'normal';
    }
  }
  return stats;
}

/** 在当前集合内重新计算偏差（供 UI 对指定汇流箱分组时调用） */
export function rebaseBias(
  stats: StringDiscreteStat[],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): StringDiscreteStat[] {
  if (stats.length === 0) return [];
  const baseline = mean(stats.map((item) => item.avgAdjustedCurrentA));
  return stats.map((stat) => {
    const bias = currentBiasPercent(stat.avgAdjustedCurrentA, baseline);
    const byBias = Math.abs(bias) >= config.currentBiasPercent;
    const level: DiscreteLevel = byBias
      ? 'mismatch'
      : stat.level === 'mismatch'
        ? 'mismatch'
        : levelOf(stat.discreteRate, config);
    return { ...stat, currentBiasPercent: bias, level };
  });
}

/** 离散率 → 颜色（供表格内联样式复用） */
export const DISCRETE_COLOR: Record<DiscreteLevel, string> = {
  normal: '#237804',
  watch: '#d46b08',
  mismatch: '#a8071a',
};

/** 离散率 → 浅底色 */
export const DISCRETE_BG: Record<DiscreteLevel, string> = {
  normal: '#f6ffed',
  watch: '#fff7e6',
  mismatch: '#fff1f0',
};
