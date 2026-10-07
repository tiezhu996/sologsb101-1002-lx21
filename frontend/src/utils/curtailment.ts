/**
 * 限功率折算（纯函数，供离散率统计 / 排查榜 / 处置单初始值共用）
 *
 * 统计链路：原始读数 →（限功率折算）→ 辐照度归一化 → 同箱基准离散率。
 *
 * 关键决策：采用「按实际限值折算」而非「整段剔除」。
 *   折算电流 = 原始电流 / 限值比例
 * 限功率时段内同一逆变器的组串被等比例压低，折算把电流还原到未限功率的水平，
 * 组串之间的相对差异得以保留，受限时段仍可计算离散率；
 * 若整段剔除，受限时段内的离散率无法计算，排查榜会漏掉本应处置的组串。
 *
 * 时间口径：
 * - 跨日：startAt / endAt 是 `yyyy-MM-dd HH:mm` 完整字符串，直接按字符串（与时间序一致）比较；
 * - 重叠：同一逆变器同一时刻命中多条时段，取最严限值（limitRatio 最小）；
 * - 缺结束时间：endAt 为空串的时段，结束点收口到「当前批次末尾」
 *   （参与统计的全部采集读数里的最晚采集时间）；若该批没有读数则不生效。
 */
import type { Curtailment } from '../types/curtailment';
import { MIN_CURTAIL_RATIO } from '../types/curtailment';
import { round } from './format';

/** 一条折算依据（记录命中哪条时段、用了多大限值，便于榜单 / 处置单反查） */
export interface CurtailFactor {
  /** 命中的限功率时段 id（'' 表示未受限，不折算） */
  curtailmentId: string;
  /** 生效限值比例（1 表示未限功率） */
  ratio: number;
  /** 折算后电流（A） */
  adjustedCurrentA: number;
}

/** 未限功率的折算因子（恒等） */
export function uncurtailedFactor(currentA: number): CurtailFactor {
  return { curtailmentId: '', ratio: 1, adjustedCurrentA: currentA };
}

/**
 * 计算某台逆变器在某个时刻生效的限值比例。
 * 全厂统一时段（inverterId === ''）与该逆变器专属时段同时命中时取最严（最小）值。
 * 时段按电站隔离：只取 plantId 与读数所属电站一致的记录。
 *
 * @param endBound 批次末尾时间（yyyy-MM-dd HH:mm），用于收口未填结束时间的时段
 */
export function effectiveRatioAt(
  curtailments: Curtailment[],
  plantId: string,
  inverterId: string,
  sampledAt: string,
  endBound: string,
): { ratio: number; curtailmentId: string } {
  let ratio = 1;
  let hitId = '';
  for (const item of curtailments) {
    if (item.plantId !== plantId) continue;
    if (item.inverterId !== '' && item.inverterId !== inverterId) continue;
    // 开始时间之后（含边界）
    if (sampledAt.localeCompare(item.startAt) < 0) continue;
    // 结束时间：填了用结束时间；没填算到当前批次末尾（含边界）
    const end = item.endAt.trim() === '' ? endBound : item.endAt;
    if (sampledAt.localeCompare(end) > 0) continue;
    // 重叠取最严限值
    if (item.limitRatio < ratio) {
      ratio = item.limitRatio;
      hitId = item.id;
    }
  }
  if (ratio < MIN_CURTAIL_RATIO) ratio = MIN_CURTAIL_RATIO;
  return { ratio, curtailmentId: hitId };
}

/**
 * 单条原始读数按限值折算。
 * 折算 = 原始电流 / 限值比例（限值比例越小，压得越狠，还原得越多）。
 */
export function adjustForCurtailment(
  currentA: number,
  curtailments: Curtailment[],
  plantId: string,
  inverterId: string,
  sampledAt: string,
  endBound: string,
): CurtailFactor {
  const { ratio, curtailmentId } = effectiveRatioAt(
    curtailments,
    plantId,
    inverterId,
    sampledAt,
    endBound,
  );
  if (ratio >= 1) return uncurtailedFactor(currentA);
  return {
    curtailmentId,
    ratio,
    adjustedCurrentA: round(currentA / ratio, 3),
  };
}

/**
 * 当前批次末尾：参与统计的采集读数中的最晚采集时间。
 * 缺结束时间的限功率时段统一收口到这里。
 */
export function batchEndOf(sampledAts: string[]): string {
  let end = '';
  for (const value of sampledAts) {
    if (value > end) end = value;
  }
  return end;
}

/**
 * 为每条采集读数挂上其所属电站 / 逆变器（调用方提供 stringId → 归属映射），
 * 一次性算出全部读数的折算结果，避免逐条重复扫描时段表。
 *
 * @returns key 为 sampleId（无 id 时用 `stringId@sampledAt`），value 为折算因子
 */
export function buildFactorIndex(
  curtailments: Curtailment[],
  rows: Array<{ id?: string; stringId: string; sampledAt: string; currentA: number }>,
  resolveOwnership: (stringId: string) => { plantId: string; inverterId: string } | undefined,
): Map<string, CurtailFactor> {
  const endBound = batchEndOf(rows.map((row) => row.sampledAt));
  const index = new Map<string, CurtailFactor>();
  for (const row of rows) {
    const owner = resolveOwnership(row.stringId);
    const factor = adjustForCurtailment(
      row.currentA,
      curtailments,
      owner?.plantId ?? '',
      owner?.inverterId ?? '',
      row.sampledAt,
      endBound,
    );
    index.set(row.id ?? `${row.stringId}@${row.sampledAt}`, factor);
  }
  return index;
}

/**
 * 按逆变器汇总限功率影响（电站页提示与排查榜标注用）。
 * 返回每台逆变器被折算的读数条数与覆盖到的时段集合。
 */
export function curtailImpactByInverter(
  curtailments: Curtailment[],
  rows: Array<{ stringId: string; sampledAt: string }>,
  resolveOwnership: (stringId: string) => { plantId: string; inverterId: string } | undefined,
): Map<string, { adjustedCount: number; curtailmentIds: Set<string>; plantWide: boolean }> {
  const endBound = batchEndOf(rows.map((row) => row.sampledAt));
  const impact = new Map<
    string,
    { adjustedCount: number; curtailmentIds: Set<string>; plantWide: boolean }
  >();
  for (const row of rows) {
    const owner = resolveOwnership(row.stringId);
    if (!owner) continue;
    for (const item of curtailments) {
      if (item.plantId !== owner.plantId) continue;
      const applies = item.inverterId === '' || item.inverterId === owner.inverterId;
      if (!applies) continue;
      if (row.sampledAt.localeCompare(item.startAt) < 0) continue;
      const end = item.endAt.trim() === '' ? endBound : item.endAt;
      if (row.sampledAt.localeCompare(end) > 0) continue;
      const bucket = impact.get(owner.inverterId) ?? {
        adjustedCount: 0,
        curtailmentIds: new Set<string>(),
        plantWide: false,
      };
      bucket.adjustedCount += 1;
      bucket.curtailmentIds.add(item.id);
      if (item.inverterId === '') bucket.plantWide = true;
      impact.set(owner.inverterId, bucket);
      // 一条读数可能命中多条（重叠），这里只做覆盖统计，最严取值在 effectiveRatioAt
    }
  }
  return impact;
}
