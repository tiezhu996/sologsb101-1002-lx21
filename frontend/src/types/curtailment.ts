/**
 * 逆变器限功率时段（电站页登记）
 * 限功率会把同一台逆变器下所有组串电流一起压低，若不折算，正常组串也会被推上失配榜。
 * 统计口径：限功率时段内的原始读数先按实际限值比例折算回升，再走辐照度归一化与同箱基准，
 * 不整段剔除——否则受限时段离散率无法计算，排查榜会漏掉应处置组串。
 *
 * 时间口径（全部覆盖，见 utils/curtailment.ts）：
 * - 跨日：开始/结束时间用完整时间戳（yyyy-MM-dd HH:mm）比较，天然支持跨日时段；
 * - 重叠：同一逆变器同一时刻命中多条时段时，取最严限值（limitRatio 最小）；
 * - 缺结束时间（endAt 为空）：该时段视为持续到「当前批次末尾」，
 *   即该电站现有全部采集读数中的最晚采集时间。
 */

/** 限功率时段（落库实体） */
export interface Curtailment {
  id: string;
  /** 所属电站 */
  plantId: string;
  /**
   * 适用逆变器。
   * - 非空：仅作用于该台逆变器下的组串；
   * - 空串：全厂统一限值，作用于该电站全部逆变器。
   */
  inverterId: string;
  /** 开始时间 yyyy-MM-dd HH:mm */
  startAt: string;
  /** 结束时间 yyyy-MM-dd HH:mm；空串表示未填写，统计时按批次末尾收口 */
  endAt: string;
  /**
   * 限值比例（0~1）：出力上限 / 额定（调度）基准。
   * 例：限到 65% 记 0.65，读数折算 = 原始电流 / 0.65。
   */
  limitRatio: number;
  /** 限值功率（kW），仅作登记留档；选了具体逆变器时可按额定功率自动换算限值比例 */
  limitKw: number | null;
  /** 备注（如调度令编号） */
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 新建/编辑限功率时段的表单草稿 */
export interface CurtailmentDraft {
  plantId: string;
  /** '' 表示全厂统一 */
  inverterId: string;
  startAt: string;
  /** '' 表示未填结束时间 */
  endAt: string;
  limitRatio: number;
  limitKw: number | null;
  note: string;
}

/** 限功率限值比例取值边界（折算回升的有效范围） */
export const MIN_CURTAIL_RATIO = 0.05;
export const MAX_CURTAIL_RATIO = 1;

/** 全站统一限值在表单中的逆变器取值 */
export const PLANT_WIDE_INVERTER_ID = '';

/** 未填写结束时间时的收口提示文案 */
export const OPEN_ENDED_END_LABEL = '批次末尾';

/** 限值比例百分比展示：0.65 → "65%" */
export function formatLimitRatio(ratio: number): string {
  return `${Number((ratio * 100).toFixed(1))}%`;
}

/**
 * 表单校验，返回错误文案数组。
 * 注意：不填结束时间是合法口径（算到批次末尾），只给提示不给错误。
 */
export function validateCurtailment(draft: CurtailmentDraft): string[] {
  const errors: string[] = [];
  if (!draft.startAt.trim()) errors.push('请填写限功率开始时间');
  if (
    draft.limitRatio < MIN_CURTAIL_RATIO ||
    draft.limitRatio > MAX_CURTAIL_RATIO
  ) {
    errors.push(`限值比例需在 ${formatLimitRatio(MIN_CURTAIL_RATIO)} ~ 100% 之间`);
  }
  if (draft.limitKw !== null && draft.limitKw <= 0) {
    errors.push('限值功率需大于 0，或留空不登记');
  }
  if (draft.endAt && draft.startAt && draft.endAt.localeCompare(draft.startAt) < 0) {
    errors.push('结束时间不能早于开始时间（跨日时段请直接填写次日完整时间）');
  }
  return errors;
}
