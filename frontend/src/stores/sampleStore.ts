/**
 * 采集与离散率状态（Zustand）
 * 维护采集记录、按组串聚合的离散率派生榜、人工标记的可疑组串集合。
 */
import { create } from 'zustand';
import {
  ROW_REVISION,
  getThresholds,
  listInverters,
  listPlants,
  listArrays,
  listSamples,
  listStrings,
  putSample,
  putSamples,
  removeSample,
  type InverterRow,
  type PlantRow,
  type ArrayRow as DbArrayRow,
  type SampleRow,
  type StringRow,
} from '../utils/db';
import type { SampleDraft, SampleRow as SampleViewRow, StringDiscreteStat } from '../types/sample';
import type { ThresholdConfig } from '../types/settings';
import { DEFAULT_THRESHOLDS } from '../types/settings';
import { buildStringStats, discreteRate, normalizeCurrent } from '../utils/discrete';
import { nowIso, uuid } from '../utils/format';
import { emitChange, subscribeChange } from '../utils/events';

interface SampleStoreState {
  samples: SampleRow[];
  strings: StringRow[];
  inverters: InverterRow[];
  arrays: DbArrayRow[];
  plants: PlantRow[];
  stats: StringDiscreteStat[];
  thresholds: ThresholdConfig;
  /** 人工标记的可疑组串（跨页共享，排查台与采集页同步） */
  markedStringIds: string[];
  loading: boolean;
  error: string;
  loadSamples: () => Promise<void>;
  subscribe: () => void;
  setThresholds: (config: ThresholdConfig) => void;
  addSample: (draft: SampleDraft) => Promise<SampleRow>;
  addBatchSamples: (drafts: SampleDraft[]) => Promise<number>;
  updateSample: (sampleId: string, draft: SampleDraft) => Promise<void>;
  deleteSample: (sampleId: string) => Promise<void>;
  deleteSamplesOfString: (stringId: string) => Promise<void>;
  toggleMark: (stringId: string) => void;
  markMany: (stringIds: string[]) => void;
  clearMarks: () => void;
  sampleRows: () => SampleViewRow[];
  samplesOfString: (stringId: string) => SampleRow[];
  statsOfString: (stringId: string) => StringDiscreteStat | null;
  suspiciousStats: () => StringDiscreteStat[];
  /** 重新计算并落库某组串的离散率（录入后调用） */
  recalcDiscreteRate: (stringId: string) => Promise<number>;
}

function hydrateStats(
  samples: SampleRow[],
  strings: StringRow[],
  inverters: InverterRow[],
  arrays: DbArrayRow[],
  plants: PlantRow[],
  thresholds: ThresholdConfig,
): StringDiscreteStat[] {
  const base = buildStringStats(samples, thresholds);
  return base.map((stat) => {
    const owner = strings.find((item) => item.id === stat.stringId);
    const inverter = owner ? inverters.find((item) => item.id === owner.inverterId) : undefined;
    const array = inverter ? arrays.find((item) => item.id === inverter.arrayId) : undefined;
    const plant = array ? plants.find((item) => item.id === array.plantId) : undefined;
    return {
      ...stat,
      stringCode: owner?.code ?? '已删除组串',
      combinerBox: owner?.combinerBox ?? '-',
      inverterId: inverter?.id ?? '',
      arrayId: array?.id ?? '',
      plantId: plant?.id ?? '',
    };
  });
}

let unsubscribed: (() => void) | null = null;

export const useSampleStore = create<SampleStoreState>((set, get) => ({
  samples: [],
  strings: [],
  inverters: [],
  arrays: [],
  plants: [],
  stats: [],
  thresholds: DEFAULT_THRESHOLDS,
  markedStringIds: [],
  loading: false,
  error: '',

  async loadSamples() {
    set({ loading: true });
    try {
      const [samples, strings, inverters, arrays, plants, thresholdRow] = await Promise.all([
        listSamples(),
        listStrings(),
        listInverters(),
        listArrays(),
        listPlants(),
        getThresholds(),
      ]);
      const thresholds: ThresholdConfig = { ...thresholdRow };
      set((state) => ({
        samples,
        strings,
        inverters,
        arrays,
        plants,
        thresholds,
        stats: hydrateStats(samples, strings, inverters, arrays, plants, thresholds),
        loading: false,
        error: '',
        markedStringIds: state.markedStringIds.filter((id) =>
          strings.some((item) => item.id === id),
        ),
      }));
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '采集数据读取失败' });
    }
  },

  subscribe() {
    if (unsubscribed) return;
    unsubscribed = subscribeChange(() => {
      void get().loadSamples();
    });
  },

  setThresholds(config) {
    set((state) => ({
      thresholds: config,
      stats: hydrateStats(state.samples, state.strings, state.inverters, state.arrays, state.plants, config),
    }));
  },

  async addSample(draft) {
    const row: SampleRow = {
      id: uuid(),
      stringId: draft.stringId,
      sampledAt: draft.sampledAt,
      currentA: draft.currentA,
      voltageV: draft.voltageV,
      irradianceWm2: draft.irradianceWm2,
      discreteRate: 0,
      createdAt: nowIso(),
      revision: ROW_REVISION,
    };
    await putSample(row);
    // 先落库再依据含新点的完整序列重算离散率并回写
    await get().recalcDiscreteRate(draft.stringId);
    emitChange();
    return row;
  },

  async addBatchSamples(drafts) {
    const rows: SampleRow[] = [];
    for (const draft of drafts) {
      rows.push({
        id: uuid(),
        stringId: draft.stringId,
        sampledAt: draft.sampledAt,
        currentA: draft.currentA,
        voltageV: draft.voltageV,
        irradianceWm2: draft.irradianceWm2,
        discreteRate: 0,
        createdAt: nowIso(),
        revision: ROW_REVISION,
      });
    }
    if (rows.length === 0) return 0;
    await putSamples(rows);
    // 批量落库后统一重算受影响组串的离散率
    const affected = [...new Set(rows.map((row) => row.stringId))];
    for (const stringId of affected) {
      await get().recalcDiscreteRate(stringId);
    }
    emitChange();
    return rows.length;
  },

  async updateSample(sampleId, draft) {
    const existing = get().samples.find((item) => item.id === sampleId);
    if (!existing) return;
    await putSample({
      ...existing,
      stringId: draft.stringId,
      sampledAt: draft.sampledAt,
      currentA: draft.currentA,
      voltageV: draft.voltageV,
      irradianceWm2: draft.irradianceWm2,
    });
    await get().recalcDiscreteRate(draft.stringId);
    emitChange();
  },

  async deleteSample(sampleId) {
    const existing = get().samples.find((item) => item.id === sampleId);
    await removeSample(sampleId);
    if (existing) await get().recalcDiscreteRate(existing.stringId);
    emitChange();
  },

  async deleteSamplesOfString(stringId) {
    const rows = get().samples.filter((item) => item.stringId === stringId);
    for (const row of rows) {
      await removeSample(row.id);
    }
    emitChange();
  },

  toggleMark(stringId) {
    set((state) => ({
      markedStringIds: state.markedStringIds.includes(stringId)
        ? state.markedStringIds.filter((id) => id !== stringId)
        : [...state.markedStringIds, stringId],
    }));
  },

  markMany(stringIds) {
    set((state) => ({ markedStringIds: [...new Set([...state.markedStringIds, ...stringIds])] }));
  },

  clearMarks() {
    set({ markedStringIds: [] });
  },

  sampleRows() {
    const { samples, strings, inverters, arrays, plants, thresholds } = get();
    return samples.map((sample) => {
      const owner = strings.find((item) => item.id === sample.stringId);
      const inverter = owner ? inverters.find((item) => item.id === owner.inverterId) : undefined;
      const array = inverter ? arrays.find((item) => item.id === inverter.arrayId) : undefined;
      const plant = array ? plants.find((item) => item.id === array.plantId) : undefined;
      return {
        ...sample,
        stringCode: owner?.code ?? '已删除组串',
        combinerBox: owner?.combinerBox ?? '-',
        inverterId: inverter?.id ?? '',
        inverterModel: inverter?.model ?? '-',
        arrayId: array?.id ?? '',
        arrayCode: array?.code ?? '-',
        plantId: plant?.id ?? '',
        plantName: plant?.name ?? '未归属电站',
        normalizedCurrentA: normalizeCurrent(sample.currentA, sample.irradianceWm2, thresholds),
      };
    });
  },

  samplesOfString(stringId) {
    return get()
      .samples.filter((item) => item.stringId === stringId)
      .sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
  },

  statsOfString(stringId) {
    return get().stats.find((item) => item.stringId === stringId) ?? null;
  },

  suspiciousStats() {
    return get().stats.filter((item) => item.level === 'mismatch' || item.level === 'watch');
  },

  async recalcDiscreteRate(stringId) {
    const { strings, samples } = get();
    const owner = strings.find((item) => item.id === stringId);
    if (!owner) return 0;
    const peers = strings.filter(
      (item) => item.inverterId === owner.inverterId && item.combinerBox === owner.combinerBox,
    );
    const peerIds = new Set(peers.map((item) => item.id));
    const scope = samples.length > 0 ? samples : await listSamples();
    const targets = scope.filter((item) => peerIds.has(item.stringId));
    const values = targets.slice(-40).map((item) => normalizeCurrent(item.currentA, item.irradianceWm2));
    const rate = discreteRate(values.length > 0 ? values : [0]);
    // 同一汇流箱内组串互为基准：把该汇流箱下全部采集记录的离散率一起回写，保证口径一致
    await Promise.all(targets.map((item) => putSample({ ...item, discreteRate: rate })));
    return rate;
  },
}));
