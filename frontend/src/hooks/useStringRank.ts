/**
 * 组串排序 hook
 * 依据离散率与电流偏差排序，返回 Top 榜、可疑集合与汇流箱/逆变器对比分组。
 * 被失配排查工作台、采集页消费。
 */
import { useMemo } from 'react';
import { useSampleStore } from '../stores/sampleStore';
import type { StringDiscreteStat } from '../types/sample';
import { levelOf } from '../utils/discrete';

export interface StringRankOptions {
  /** 排序口径：离散率 / 电流偏差 / 综合评分 */
  sortBy?: 'discrete' | 'bias' | 'score';
  /** 只保留可疑（关注 + 失配） */
  onlySuspicious?: boolean;
  /** Top 榜长度 */
  topN?: number;
  /** 指定电站（空串不过滤） */
  plantId?: string;
  /** 指定逆变器（空串不过滤） */
  inverterId?: string;
}

export interface StringRankResult {
  /** 排序后的完整榜单 */
  ranked: StringDiscreteStat[];
  /** Top N 榜单 */
  top: StringDiscreteStat[];
  /** 失配组串集合 */
  mismatchIds: Set<string>;
  /** 可疑（关注 + 失配）组串集合 */
  suspiciousIds: Set<string>;
  /** 人工标记的组串集合 */
  markedIds: Set<string>;
  /** 被标记但不在可疑集合中的数量，用于提示复核 */
  markedButNormal: number;
  /** 组串总数 */
  total: number;
  /** 失配数量 */
  mismatchCount: number;
  /** 平均离散率 */
  averageDiscreteRate: number;
  /** 按汇流箱平均离散率降序的对比分组 */
  boxGroups: Array<{ key: string; label: string; averageRate: number; count: number }>;
  /** 按逆变器平均离散率降序的对比分组 */
  inverterGroups: Array<{ key: string; label: string; averageRate: number; count: number }>;
  /** 综合评分：离散率权重 0.7 + 偏差绝对值权重 0.3 */
  scoreOf: (stat: StringDiscreteStat) => number;
}

/** 综合评分（越高越可疑） */
export function rankScore(stat: StringDiscreteStat): number {
  return Number((stat.discreteRate * 0.7 + Math.abs(stat.currentBiasPercent) * 0.3).toFixed(2));
}

function groupAverage(
  stats: StringDiscreteStat[],
  keyOf: (stat: StringDiscreteStat) => string,
  labelOf: (stat: StringDiscreteStat) => string,
): Array<{ key: string; label: string; averageRate: number; count: number }> {
  const buckets = new Map<string, { label: string; rates: number[] }>();
  for (const stat of stats) {
    const key = keyOf(stat);
    const bucket = buckets.get(key);
    if (bucket) bucket.rates.push(stat.discreteRate);
    else buckets.set(key, { label: labelOf(stat), rates: [stat.discreteRate] });
  }
  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.rates.length,
      averageRate: Number(
        (value.rates.reduce((sum, rate) => sum + rate, 0) / value.rates.length).toFixed(2),
      ),
    }))
    .sort((a, b) => b.averageRate - a.averageRate);
}

export function useStringRank(options: StringRankOptions = {}): StringRankResult {
  const { sortBy = 'score', onlySuspicious = false, topN = 10, plantId = '', inverterId = '' } = options;
  const stats = useSampleStore((state) => state.stats);
  const thresholds = useSampleStore((state) => state.thresholds);
  const markedStringIds = useSampleStore((state) => state.markedStringIds);

  return useMemo(() => {
    let scope = stats;
    if (plantId) scope = scope.filter((item) => item.plantId === plantId);
    if (inverterId) scope = scope.filter((item) => item.inverterId === inverterId);

    const mismatchIds = new Set(
      scope.filter((item) => item.level === 'mismatch').map((item) => item.stringId),
    );
    const suspiciousIds = new Set(
      scope
        .filter((item) => item.level === 'mismatch' || item.level === 'watch')
        .map((item) => item.stringId),
    );

    const filtered = onlySuspicious
      ? scope.filter((item) => suspiciousIds.has(item.stringId))
      : scope;

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'discrete') return b.discreteRate - a.discreteRate;
      if (sortBy === 'bias') return Math.abs(b.currentBiasPercent) - Math.abs(a.currentBiasPercent);
      return rankScore(b) - rankScore(a);
    });

    const markedIds = new Set(markedStringIds);
    const markedButNormal = scope.filter(
      (item) => markedIds.has(item.stringId) && levelOf(item.discreteRate, thresholds) === 'normal',
    ).length;

    const averageDiscreteRate =
      scope.length === 0
        ? 0
        : Number((scope.reduce((sum, item) => sum + item.discreteRate, 0) / scope.length).toFixed(2));

    return {
      ranked: sorted,
      top: sorted.slice(0, topN),
      mismatchIds,
      suspiciousIds,
      markedIds,
      markedButNormal,
      total: scope.length,
      mismatchCount: mismatchIds.size,
      averageDiscreteRate,
      boxGroups: groupAverage(
        scope,
        (item) => `${item.inverterId}::${item.combinerBox}`,
        (item) => `${item.combinerBox}`,
      ),
      inverterGroups: groupAverage(
        scope,
        (item) => item.inverterId,
        (item) => item.inverterId || '未归属逆变器',
      ),
      scoreOf: rankScore,
    };
  }, [stats, thresholds, markedStringIds, sortBy, onlySuspicious, topN, plantId, inverterId]);
}

/**
 * 取同汇流箱 / 同逆变器的对比组，用于排查台追溯。
 */
export function useCompareGroup(targetStringId: string): {
  sameBox: StringDiscreteStat[];
  sameInverter: StringDiscreteStat[];
  target: StringDiscreteStat | null;
} {
  const stats = useSampleStore((state) => state.stats);
  return useMemo(() => {
    const target = stats.find((item) => item.stringId === targetStringId) ?? null;
    if (!target) return { sameBox: [], sameInverter: [], target: null };
    const sameInverter = stats
      .filter((item) => item.inverterId === target.inverterId)
      .sort((a, b) => b.discreteRate - a.discreteRate);
    const sameBox = sameInverter
      .filter((item) => item.combinerBox === target.combinerBox)
      .sort((a, b) => b.discreteRate - a.discreteRate);
    return { sameBox, sameInverter, target };
  }, [stats, targetStringId]);
}
