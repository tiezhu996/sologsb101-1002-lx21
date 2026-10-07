/** 组串 */
export interface PvString {
  id: string;
  /** 所属逆变器 */
  inverterId: string;
  /** 汇流箱编号，如 BX-01 */
  combinerBox: string;
  /** 组串编号，如 01-03 */
  code: string;
  /** 组件型号 */
  moduleModel: string;
  /** 串联组件数 */
  seriesCount: number;
  createdAt: string;
}

/** 新建/编辑组串的表单草稿 */
export interface StringDraft {
  inverterId: string;
  combinerBox: string;
  code: string;
  moduleModel: string;
  seriesCount: number;
}

/** 批量新增组串的入参：按逆变器 + 汇流箱 + 起始序号生成 */
export interface BatchStringDraft {
  inverterId: string;
  combinerBox: string;
  moduleModel: string;
  seriesCount: number;
  /** 起始序号 */
  startSeq: number;
  /** 生成条数 */
  count: number;
}

/** 组串在台账/排查台中携带的上下文 */
export interface StringContext extends PvString {
  inverterModel: string;
  arrayId: string;
  arrayCode: string;
  plantId: string;
  plantName: string;
}

/** 依据索引生成组串编号：01-03 形式 */
export function formatStringCode(startSeq: number, offset: number): string {
  const seq = startSeq + offset;
  const box = String(Math.ceil(seq / 8)).padStart(2, '0');
  const inner = String(((seq - 1) % 8) + 1).padStart(2, '0');
  return `${box}-${inner}`;
}

/** 理论开路电压估算：串联数 × 单块 49.5V */
export const MODULE_VOC = 49.5;

export function expectedVoc(seriesCount: number): number {
  return Number((seriesCount * MODULE_VOC).toFixed(1));
}

/** 依据实测电压与理论电压的偏差判定接线异常 */
export function voltageDeviationPercent(measuredV: number, seriesCount: number): number {
  const base = expectedVoc(seriesCount);
  if (base <= 0) return 0;
  return Number((((measuredV - base) / base) * 100).toFixed(2));
}
