import type { Revisioned } from './persistence';

/**
 * 逆变器限功率时段
 * 限电会把同一台逆变器下所有组串的电流按同一比例压低，若按原始读数直接算离散率 /
 * 电流偏差，正常组串也会被推上失配榜。因此对落在限电时段内的采集点，先按实际限值
 * 折算还原（电流 ÷ 限值比例）再进入归一化与同箱基准统计，而不是整段剔除。
 */
export interface CurtailPeriod {
  id: string;
  /** 所属电站 */
  plantId: string;
  /** 受限逆变器 */
  inverterId: string;
  /** 起始时间 yyyy-MM-dd HH:mm（可跨日） */
  startAt: string;
  /** 结束时间 yyyy-MM-dd HH:mm；空串表示未填结束时间，顺延至当前批次末尾 */
  endAt: string;
  /** 限值比例（%）：实际允许出力 / 额定出力，如 60 表示限发至 60% */
  limitPercent: number;
  createdAt: string;
}

/** 新建/编辑限电时段的表单草稿 */
export interface CurtailDraft {
  plantId: string;
  inverterId: string;
  startAt: string;
  endAt: string;
  limitPercent: number;
}

/** 落库行（带行修订号） */
export type CurtailPeriodRow = CurtailPeriod & Revisioned;

/** 限电比例合法区间：(0, 100] */
export const MIN_LIMIT_PERCENT = 0;
export const MAX_LIMIT_PERCENT = 100;

/**
 * 校验限电时段表单，返回错误文案数组。
 * - 限值比例必须在 (0, 100]
 * - 起始时间必填
 * - 填写结束时间时不得早于起始时间（支持跨日）
 */
export function validateCurtailDraft(draft: CurtailDraft): string[] {
  const errors: string[] = [];
  if (!draft.plantId) errors.push('请选择电站');
  if (!draft.inverterId) errors.push('请选择逆变器');
  if (!draft.startAt) errors.push('请填写起始时间');
  if (!(draft.limitPercent > MIN_LIMIT_PERCENT && draft.limitPercent <= MAX_LIMIT_PERCENT)) {
    errors.push('限值比例必须大于 0% 且不超过 100%');
  }
  if (draft.endAt && draft.startAt && draft.endAt.localeCompare(draft.startAt) < 0) {
    errors.push('结束时间不能早于起始时间（限电时段可跨日）');
  }
  return errors;
}

/** 限值比例 → 折算系数（电流还原时除以该系数） */
export function limitRatio(limitPercent: number): number {
  if (!(limitPercent > MIN_LIMIT_PERCENT)) return 1;
  return Math.min(MAX_LIMIT_PERCENT, limitPercent) / 100;
}

/** 结束时间占位文案：未填结束时间时按当前批次末尾处理 */
export const OPEN_ENDED_END_LABEL = '至当前批次末尾';
