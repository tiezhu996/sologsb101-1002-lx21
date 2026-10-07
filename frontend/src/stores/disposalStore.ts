/**
 * 处置单状态（Zustand）
 * 维护清洗 / 更换 / 复测三类处置单的状态流转、复测回填与消缺判定。
 */
import { create } from 'zustand';
import {
  ROW_REVISION,
  listDisposals,
  listInverters,
  listPlants,
  listArrays,
  listStrings,
  putDisposal,
  removeDisposal,
  type DisposalRow as DbDisposalRow,
  type InverterRow,
  type PlantRow,
  type ArrayRow as DbArrayRow,
  type StringRow,
} from '../utils/db';
import {
  DISPOSAL_STATE_FLOW,
  completionRate,
  isCleared,
  isOverdue,
  type Disposal,
  type DisposalDraft,
  type DisposalState,
  type DisposalRow as DisposalViewRow,
} from '../types/disposal';
import { mean } from '../utils/discrete';
import { nowIso, uuid } from '../utils/format';
import { emitChange, subscribeChange } from '../utils/events';

interface DisposalStoreState {
  disposals: DbDisposalRow[];
  strings: StringRow[];
  inverters: InverterRow[];
  arrays: DbArrayRow[];
  plants: PlantRow[];
  /** 复测判定基准：每个汇流箱的组串平均电流（A） */
  baselines: Record<string, number>;
  /** 列表页的处置类型筛选（跨页保留） */
  activeTypes: string[];
  loading: boolean;
  error: string;
  loadDisposals: () => Promise<void>;
  subscribe: () => void;
  setActiveTypes: (types: string[]) => void;
  createDisposal: (draft: DisposalDraft) => Promise<DbDisposalRow>;
  assignDisposal: (disposalId: string, owner: string, dueDate: string) => Promise<void>;
  submitRetest: (disposalId: string, retestCurrentA: number) => Promise<boolean | null>;
  changeState: (disposalId: string, state: DisposalState) => Promise<void>;
  deleteDisposal: (disposalId: string) => Promise<void>;
  nextStates: (state: DisposalState) => DisposalState[];
  rows: () => DisposalViewRow[];
  rowOf: (disposalId: string) => DisposalViewRow | null;
  rate: () => number;
  overdueRows: () => DisposalViewRow[];
}

let unsubscribed: (() => void) | null = null;

export const useDisposalStore = create<DisposalStoreState>((set, get) => ({
  disposals: [],
  strings: [],
  inverters: [],
  arrays: [],
  plants: [],
  baselines: {},
  activeTypes: [],
  loading: false,
  error: '',

  async loadDisposals() {
    set({ loading: true });
    try {
      const [disposals, strings, inverters, arrays, plants] = await Promise.all([
        listDisposals(),
        listStrings(),
        listInverters(),
        listArrays(),
        listPlants(),
      ]);
      // 基准电流：同一汇流箱内全部组串的处置单初始离散率无法反映电流，改用记录在案的基准
      const baselines: Record<string, number> = {};
      const grouped = new Map<string, number[]>();
      for (const string of strings) {
        const key = `${string.inverterId}::${string.combinerBox}`;
        const list = grouped.get(key);
        if (list) list.push(string.seriesCount);
        else grouped.set(key, [string.seriesCount]);
      }
      for (const [key, seriesCounts] of grouped) {
        // 用串联数折算典型工作电流 ≈ 9.4A（26 串基准）
        baselines[key] = Number(((mean(seriesCounts) / 26) * 9.4).toFixed(2));
      }
      set({ disposals, strings, inverters, arrays, plants, baselines, loading: false, error: '' });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '处置单读取失败' });
    }
  },

  subscribe() {
    if (unsubscribed) return;
    unsubscribed = subscribeChange(() => {
      void get().loadDisposals();
    });
  },

  setActiveTypes(types) {
    set({ activeTypes: types });
  },

  async createDisposal(draft) {
    const stamp = nowIso();
    const row: DbDisposalRow = {
      id: uuid(),
      stringId: draft.stringId,
      type: draft.type,
      state: 'pending',
      owner: draft.owner.trim(),
      dueDate: draft.dueDate,
      retestCurrentA: null,
      initialDiscreteRate: draft.initialDiscreteRate,
      createdAt: stamp,
      updatedAt: stamp,
      revision: ROW_REVISION,
    };
    await putDisposal(row);
    emitChange();
    return row;
  },

  async assignDisposal(disposalId, owner, dueDate) {
    const existing = get().disposals.find((item) => item.id === disposalId);
    if (!existing) return;
    await putDisposal({
      ...existing,
      owner: owner.trim(),
      dueDate,
      state: 'assigned',
      updatedAt: nowIso(),
    });
    emitChange();
  },

  async submitRetest(disposalId, retestCurrentA) {
    const existing = get().disposals.find((item) => item.id === disposalId);
    if (!existing) return null;
    const string = get().strings.find((item) => item.id === existing.stringId);
    const baseline = string
      ? (get().baselines[`${string.inverterId}::${string.combinerBox}`] ?? 9.4)
      : 9.4;
    const cleared = isCleared(retestCurrentA, baseline);
    await putDisposal({
      ...existing,
      retestCurrentA,
      state: 'retested',
      updatedAt: nowIso(),
    });
    emitChange();
    return cleared;
  },

  async changeState(disposalId, state) {
    const existing = get().disposals.find((item) => item.id === disposalId);
    if (!existing) return;
    const allowed = DISPOSAL_STATE_FLOW[existing.state];
    if (!allowed.includes(state)) return;
    await putDisposal({ ...existing, state, updatedAt: nowIso() });
    emitChange();
  },

  async deleteDisposal(disposalId) {
    await removeDisposal(disposalId);
    emitChange();
  },

  nextStates(state) {
    return DISPOSAL_STATE_FLOW[state];
  },

  rows() {
    const { disposals, strings, inverters, arrays, plants, baselines } = get();
    return disposals.map((disposal) => {
      const string = strings.find((item) => item.id === disposal.stringId);
      const inverter = string ? inverters.find((item) => item.id === string.inverterId) : undefined;
      const array = inverter ? arrays.find((item) => item.id === inverter.arrayId) : undefined;
      const plant = array ? plants.find((item) => item.id === array.plantId) : undefined;
      const baseline = string ? (baselines[`${string.inverterId}::${string.combinerBox}`] ?? 9.4) : 9.4;
      return {
        ...disposal,
        stringCode: string?.code ?? '已删除组串',
        combinerBox: string?.combinerBox ?? '-',
        inverterId: inverter?.id ?? '',
        arrayId: array?.id ?? '',
        plantId: plant?.id ?? '',
        plantName: plant?.name ?? '未归属电站',
        cleared: isCleared(disposal.retestCurrentA, baseline),
        overdue: isOverdue(disposal),
      };
    });
  },

  rowOf(disposalId) {
    return get().rows().find((item) => item.id === disposalId) ?? null;
  },

  rate() {
    return completionRate(get().disposals);
  },

  overdueRows() {
    return get().rows().filter((item) => item.overdue);
  },
}));

/** 处置单草稿的默认值（供页面表单初始化） */
export function defaultDisposalDraft(stringId: string, owner: string, dueDate: string): DisposalDraft {
  return { stringId, type: 'clean', owner, dueDate, initialDiscreteRate: 0 };
}

/** 类型守卫：判断是否为合法处置类型 */
export function isDisposalType(value: string): value is Disposal['type'] {
  return value === 'clean' || value === 'replace' || value === 'retest';
}
