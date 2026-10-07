/**
 * 处置单状态（Zustand）
 * 维护清洗 / 更换 / 复测三类处置单的状态流转、复测回填与消缺判定。
 */
import { create } from 'zustand';
import {
  ROW_REVISION,
  listCurtailments,
  listDisposals,
  listInverters,
  listPlants,
  listArrays,
  listSamples,
  listStrings,
  putDisposal,
  removeDisposal,
  type DisposalRow as DbDisposalRow,
  type InverterRow,
  type PlantRow,
  type ArrayRow as DbArrayRow,
  type SampleRow,
  type StringRow,
  type CurtailmentRow,
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
import { DEFAULT_THRESHOLDS } from '../types/settings';
import { mean, normalizeCurrent } from '../utils/discrete';
import { batchEndOf, effectiveRatioAt } from '../utils/curtailment';
import { round as roundNumber, nowIso, uuid } from '../utils/format';
import { emitChange, subscribeChange } from '../utils/events';

/** 旧处置单未登记基准电流时的展示兜底（A） */
const FALLBACK_BASELINE_A = 9.4;

interface DisposalStoreState {
  disposals: DbDisposalRow[];
  strings: StringRow[];
  inverters: InverterRow[];
  arrays: DbArrayRow[];
  plants: PlantRow[];
  samples: SampleRow[];
  curtailments: CurtailmentRow[];
  /** 复测判定基准：每个汇流箱的组串平均归一化电流（限功率折算口径，A） */
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
  /** 取某组串当前同箱基准电流（折算归一化口径，A） */
  baselineOfString: (stringId: string) => number;
}

let unsubscribed: (() => void) | null = null;

export const useDisposalStore = create<DisposalStoreState>((set, get) => ({
  disposals: [],
  strings: [],
  inverters: [],
  arrays: [],
  plants: [],
  samples: [],
  curtailments: [],
  baselines: {},
  activeTypes: [],
  loading: false,
  error: '',

  async loadDisposals() {
    set({ loading: true });
    try {
      const [disposals, strings, inverters, arrays, plants, samples, curtailments] =
        await Promise.all([
          listDisposals(),
          listStrings(),
          listInverters(),
          listArrays(),
          listPlants(),
          listSamples(),
          listCurtailments(),
        ]);
      // 基准电流：同一汇流箱内各组串电流的归一化均值，
      // 原始读数先按限功率时段实际限值折算（不整段剔除），再按辐照度归一化
      const endBound = batchEndOf(samples.map((item) => item.sampledAt));
      const plantOfInverter = new Map<string, string>();
      for (const inverter of inverters) {
        const array = arrays.find((item) => item.id === inverter.arrayId);
        plantOfInverter.set(inverter.id, array?.plantId ?? '');
      }
      const grouped = new Map<string, number[]>();
      for (const sample of samples) {
        const owner = strings.find((item) => item.id === sample.stringId);
        if (!owner) continue;
        const key = `${owner.inverterId}::${owner.combinerBox}`;
        const { ratio } = effectiveRatioAt(
          curtailments,
          plantOfInverter.get(owner.inverterId) ?? '',
          owner.inverterId,
          sample.sampledAt,
          endBound,
        );
        const adjusted = ratio >= 1 ? sample.currentA : roundNumber(sample.currentA / ratio, 3);
        const value = normalizeCurrent(adjusted, sample.irradianceWm2, DEFAULT_THRESHOLDS);
        const list = grouped.get(key);
        if (list) list.push(value);
        else grouped.set(key, [value]);
      }
      const baselines: Record<string, number> = {};
      for (const [key, values] of grouped) {
        baselines[key] = roundNumber(mean(values), 3);
      }
      set({
        disposals,
        strings,
        inverters,
        arrays,
        plants,
        samples,
        curtailments,
        baselines,
        loading: false,
        error: '',
      });
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
    // 处置单初始值：派单时的折算口径同箱基准电流（排查榜 / 本页未显式传入时由 store 补齐）
    const initialBaseline =
      draft.initialBaselineCurrentA && draft.initialBaselineCurrentA > 0
        ? draft.initialBaselineCurrentA
        : get().baselineOfString(draft.stringId);
    const row: DbDisposalRow = {
      id: uuid(),
      stringId: draft.stringId,
      type: draft.type,
      state: 'pending',
      owner: draft.owner.trim(),
      dueDate: draft.dueDate,
      retestCurrentA: null,
      initialDiscreteRate: draft.initialDiscreteRate,
      initialBaselineCurrentA: initialBaseline,
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
    const baseline = get().baselineOfString(existing.stringId);
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
    const { disposals, strings, inverters, arrays, plants } = get();
    return disposals.map((disposal) => {
      const string = strings.find((item) => item.id === disposal.stringId);
      const inverter = string ? inverters.find((item) => item.id === string.inverterId) : undefined;
      const array = inverter ? arrays.find((item) => item.id === inverter.arrayId) : undefined;
      const plant = array ? plants.find((item) => item.id === array.plantId) : undefined;
      // 优先用当前同箱基准（折算口径）；没有读数时回退派单初始基准，再兜底 9.4A
      const liveBaseline = string
        ? (get().baselines[`${string.inverterId}::${string.combinerBox}`] ?? 0)
        : 0;
      const baseline =
        liveBaseline > 0
          ? liveBaseline
          : disposal.initialBaselineCurrentA > 0
            ? disposal.initialBaselineCurrentA
            : FALLBACK_BASELINE_A;
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

  baselineOfString(stringId) {
    const string = get().strings.find((item) => item.id === stringId);
    if (!string) return FALLBACK_BASELINE_A;
    const live = get().baselines[`${string.inverterId}::${string.combinerBox}`] ?? 0;
    if (live > 0) return live;
    const disposal = get()
      .disposals.filter((item) => item.stringId === stringId)
      .map((item) => item.initialBaselineCurrentA)
      .find((value) => value > 0);
    return disposal ?? FALLBACK_BASELINE_A;
  },
}));

/** 处置单草稿的默认值（供页面表单初始化） */
export function defaultDisposalDraft(stringId: string, owner: string, dueDate: string): DisposalDraft {
  return {
    stringId,
    type: 'clean',
    owner,
    dueDate,
    initialDiscreteRate: 0,
    initialBaselineCurrentA: 0,
  };
}

/** 类型守卫：判断是否为合法处置类型 */
export function isDisposalType(value: string): value is Disposal['type'] {
  return value === 'clean' || value === 'replace' || value === 'retest';
}
