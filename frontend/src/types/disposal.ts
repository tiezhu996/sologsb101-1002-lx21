import type { Revisioned } from './persistence';

/** 处置类型：清洗 / 更换 / 复测 */
export type DisposalType = 'clean' | 'replace' | 'retest';

/** 处置单状态：待处理 / 已派工 / 已复测 */
export type DisposalState = 'pending' | 'assigned' | 'retested';

export const DISPOSAL_TYPE_LABEL: Record<DisposalType, string> = {
  clean: '清洗',
  replace: '更换',
  retest: '复测',
};

export const DISPOSAL_STATE_LABEL: Record<DisposalState, string> = {
  pending: '待处理',
  assigned: '已派工',
  retested: '已复测',
};

/** 状态流转允许的下一步（用于按钮可用性与校验） */
export const DISPOSAL_STATE_FLOW: Record<DisposalState, DisposalState[]> = {
  pending: ['assigned'],
  assigned: ['retested'],
  retested: [],
};

/** 处置单 */
export interface Disposal {
  id: string;
  /** 关联组串 */
  stringId: string;
  /** 处置类型 */
  type: DisposalType;
  /** 状态 */
  state: DisposalState;
  /** 责任人 */
  owner: string;
  /** 要求完成日期 yyyy-MM-dd */
  dueDate: string;
  /** 复测电流（A），已复测时必填 */
  retestCurrentA: number | null;
  /** 派工时登记的初始离散率（%） */
  initialDiscreteRate: number;
  createdAt: string;
  updatedAt: string;
}

/** 新建处置单草稿 */
export interface DisposalDraft {
  stringId: string;
  type: DisposalType;
  owner: string;
  dueDate: string;
  initialDiscreteRate: number;
}

/** 处置单行数据（带组串上下文与消缺判定） */
export interface DisposalRow extends Disposal, Revisioned {
  stringCode: string;
  combinerBox: string;
  inverterId: string;
  arrayId: string;
  plantId: string;
  plantName: string;
  /** 复测后是否消缺（复测电流 ≥ 同汇流箱均值 95%） */
  cleared: boolean | null;
  /** 是否逾期（未复测且 dueDate 早于今天） */
  overdue: boolean;
}

/** 复测消缺判定阈值：复测电流达到基准电流的 95% 即消缺 */
export const CLEAR_RATIO = 0.95;

export function isCleared(retestCurrentA: number | null, baselineCurrentA: number): boolean | null {
  if (retestCurrentA === null || retestCurrentA <= 0) return null;
  if (baselineCurrentA <= 0) return null;
  return retestCurrentA >= baselineCurrentA * CLEAR_RATIO;
}

/** 是否逾期 */
export function isOverdue(disposal: Disposal, today: Date = new Date()): boolean {
  if (disposal.state === 'retested') return false;
  const due = new Date(`${disposal.dueDate}T23:59:59`);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < today.getTime();
}

/** 处置完成率（%） */
export function completionRate(disposals: Disposal[]): number {
  if (disposals.length === 0) return 0;
  const done = disposals.filter((item) => item.state === 'retested').length;
  return Number(((done / disposals.length) * 100).toFixed(1));
}
