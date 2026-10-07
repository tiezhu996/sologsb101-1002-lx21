/**
 * 限功率时段匹配与电流折算（纯函数）
 *
 * 口径：对落在限电时段内的采集点按「实际限值折算」还原电流，而不是整段剔除。
 * 若整段剔除，限电时段内离散率将失去样本无法计算，排查榜会漏掉应处置组串。
 *
 * 时段规则：
 * - 跨日：startAt / endAt 均为 yyyy-MM-dd HH:mm 全量时间字符串，直接比较，天然支持跨日；
 * - 重叠：同一逆变器多条时段重叠时取最严限值（limitPercent 最小者）；
 * - 未填结束时间：endAt 为空串时顺延至「当前批次末尾」（参与计算的最大采集时间）。
 */
import type { CurtailPeriod } from '../types/curtail';
import { limitRatio } from '../types/curtail';

/**
 * 当前批次末尾：参与统计的全部采集点中的最大采集时间。
 * 未填结束时间的限电时段以此作为闭区间终点，保证同批次数据口径一致。
 */
export function batchEndAt(sampledAts: string[]): string {
  return sampledAts.reduce((max, value) => (value > max ? value : max), '');
}

/** 取某条限电时段在当前批次下的有效结束时间 */
export function effectiveEndAt(period: Pick<CurtailPeriod, 'endAt'>, batchEnd: string): string {
  return period.endAt || batchEnd;
}

/** 判断采集时间是否落在时段内（闭区间，空结束时间按批次末尾处理） */
export function isWithinCurtail(
  sampledAt: string,
  period: Pick<CurtailPeriod, 'startAt' | 'endAt'>,
  batchEnd: string,
): boolean {
  if (sampledAt < period.startAt) return false;
  return sampledAt <= effectiveEndAt(period, batchEnd);
}

/**
 * 取某逆变器在某采集时刻的限电折算系数。
 * 多条时段重叠时取最严限值（比例最小 → 系数最小 → 还原倍数最大）。
 * 非限电时刻返回 1（不折算）。
 */
export function curtailRatioAt(
  inverterId: string,
  sampledAt: string,
  periods: CurtailPeriod[],
  batchEnd: string,
): number {
  let ratio = 1;
  for (const period of periods) {
    if (period.inverterId !== inverterId) continue;
    if (!isWithinCurtail(sampledAt, period, batchEnd)) continue;
    ratio = Math.min(ratio, limitRatio(period.limitPercent));
  }
  return ratio;
}

/**
 * 按实际限值折算还原电流：受限读数 ÷ 限值比例。
 * 例：限发 60% 时实测 5.4 A，还原后 5.4 / 0.6 = 9 A。
 */
export function restoreCurtailedCurrent(currentA: number, ratio: number): number {
  if (ratio > 0 && ratio < 1) return currentA / ratio;
  return currentA;
}

/** 一条采集点在给定限电时段下的折算结果 */
export interface CurtailAdjust {
  /** 折算系数（1 表示未受限） */
  ratio: number;
  /** 折算还原后的电流（A） */
  restoredCurrentA: number;
  /** 是否命中限电时段 */
  curtailed: boolean;
}

/** 计算单条采集点的限电折算结果 */
export function adjustSampleForCurtail(
  inverterId: string,
  sampledAt: string,
  currentA: number,
  periods: CurtailPeriod[],
  batchEnd: string,
): CurtailAdjust {
  const ratio = curtailRatioAt(inverterId, sampledAt, periods, batchEnd);
  const curtailed = ratio < 1;
  return {
    ratio,
    restoredCurrentA: restoreCurtailedCurrent(currentA, ratio),
    curtailed,
  };
}
