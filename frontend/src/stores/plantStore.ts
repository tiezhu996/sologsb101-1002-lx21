/**
 * 电站与方阵结构状态（Zustand）
 * 维护电站列表、方阵列表、当前选中电站与概览派生值，页面只读本 store。
 */
import { create } from 'zustand';
import {
  ROW_REVISION,
  initDatabase,
  listArrays,
  listDisposals,
  listInverters,
  listPlants,
  listSamples,
  listStrings,
  putArray,
  putPlant,
  removeArray,
  removePlant,
  type ArrayRow,
  type PlantRow,
} from '../utils/db';
import type { ArrayDraft, Array as PvArray } from '../types/array';
import type { PlantDraft, PlantSummary } from '../types/plant';
import { nowIso, uuid } from '../utils/format';
import { emitChange, subscribeChange } from '../utils/events';

interface PlantStoreState {
  plants: PlantRow[];
  arrays: ArrayRow[];
  summaries: PlantSummary[];
  activePlantId: string | null;
  loading: boolean;
  error: string;
  /** 初始化：打开数据库、按需播种并订阅变更 */
  bootstrap: () => Promise<void>;
  loadPlants: () => Promise<void>;
  setActivePlant: (plantId: string | null) => void;
  createPlant: (draft: PlantDraft) => Promise<PlantRow>;
  updatePlant: (plantId: string, draft: PlantDraft) => Promise<void>;
  deletePlant: (plantId: string) => Promise<void>;
  createArray: (draft: ArrayDraft) => Promise<ArrayRow>;
  updateArray: (arrayId: string, draft: ArrayDraft) => Promise<void>;
  deleteArray: (arrayId: string) => Promise<void>;
  arraysOfPlant: (plantId: string) => ArrayRow[];
  activePlant: () => PlantRow | null;
}

/** 读取电站视图所需的全部表并组装概览（含告警组串数） */
async function loadSummaries(): Promise<{
  plants: PlantRow[];
  arrays: ArrayRow[];
  summaries: PlantSummary[];
}> {
  const [plants, arrays, inverters, strings, samples, disposals] = await Promise.all([
    listPlants(),
    listArrays(),
    listInverters(),
    listStrings(),
    listSamples(),
    listDisposals(),
  ]);
  const summaries: PlantSummary[] = plants.map((plant) => {
    const plantArrays = arrays.filter((item) => item.plantId === plant.id);
    const arrayIds = new Set(plantArrays.map((item) => item.id));
    const plantInverters = inverters.filter((item) => arrayIds.has(item.arrayId));
    const inverterIds = new Set(plantInverters.map((item) => item.id));
    const plantStrings = strings.filter((item) => inverterIds.has(item.inverterId));
    const stringIds = new Set(plantStrings.map((item) => item.id));
    const alarmIds = new Set(
      disposals
        .filter((item) => stringIds.has(item.stringId) && item.state !== 'retested')
        .map((item) => item.stringId),
    );
    const maxRateOfString = new Map<string, number>();
    for (const sample of samples) {
      if (!stringIds.has(sample.stringId)) continue;
      maxRateOfString.set(
        sample.stringId,
        Math.max(maxRateOfString.get(sample.stringId) ?? 0, sample.discreteRate),
      );
    }
    for (const [stringId, rate] of maxRateOfString) {
      if (rate >= 10) alarmIds.add(stringId);
    }
    return {
      plant,
      arrayCount: plantArrays.length,
      inverterCount: plantInverters.length,
      stringCount: plantStrings.length,
      alarmStringCount: alarmIds.size,
    };
  });
  return { plants, arrays, summaries };
}

let unsubscribe: (() => void) | null = null;

export const usePlantStore = create<PlantStoreState>((set, get) => ({
  plants: [],
  arrays: [],
  summaries: [],
  activePlantId: null,
  loading: false,
  error: '',

  async bootstrap() {
    set({ loading: true, error: '' });
    try {
      await initDatabase();
      await get().loadPlants();
      if (!unsubscribe) {
        unsubscribe = subscribeChange(() => {
          void get().loadPlants();
        });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '本地数据库初始化失败' });
    } finally {
      set({ loading: false });
    }
  },

  async loadPlants() {
    try {
      const { plants, arrays, summaries } = await loadSummaries();
      set((state) => ({
        plants,
        arrays,
        summaries,
        error: '',
        activePlantId:
          state.activePlantId && plants.some((item) => item.id === state.activePlantId)
            ? state.activePlantId
            : (plants[0]?.id ?? null),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '电站数据读取失败' });
    }
  },

  setActivePlant(plantId) {
    set({ activePlantId: plantId });
  },

  async createPlant(draft) {
    const row: PlantRow = {
      id: uuid(),
      name: draft.name.trim(),
      capacityMWp: draft.capacityMWp,
      gridDate: draft.gridDate,
      latitude: draft.latitude,
      createdAt: nowIso(),
      revision: ROW_REVISION,
    };
    await putPlant(row);
    set({ activePlantId: row.id });
    emitChange();
    return row;
  },

  async updatePlant(plantId, draft) {
    const existing = get().plants.find((item) => item.id === plantId);
    if (!existing) return;
    await putPlant({
      ...existing,
      name: draft.name.trim(),
      capacityMWp: draft.capacityMWp,
      gridDate: draft.gridDate,
      latitude: draft.latitude,
    });
    emitChange();
  },

  async deletePlant(plantId) {
    await removePlant(plantId);
    if (get().activePlantId === plantId) set({ activePlantId: null });
    emitChange();
  },

  async createArray(draft) {
    const row: ArrayRow = {
      id: uuid(),
      plantId: draft.plantId,
      code: draft.code.trim(),
      tiltDeg: draft.tiltDeg,
      azimuthDeg: draft.azimuthDeg,
      capacityKw: draft.capacityKw,
      createdAt: nowIso(),
      revision: ROW_REVISION,
    };
    await putArray(row);
    emitChange();
    return row;
  },

  async updateArray(arrayId, draft) {
    const existing = get().arrays.find((item) => item.id === arrayId);
    if (!existing) return;
    await putArray({
      ...existing,
      plantId: draft.plantId,
      code: draft.code.trim(),
      tiltDeg: draft.tiltDeg,
      azimuthDeg: draft.azimuthDeg,
      capacityKw: draft.capacityKw,
    });
    emitChange();
  },

  async deleteArray(arrayId) {
    await removeArray(arrayId);
    emitChange();
  },

  arraysOfPlant(plantId) {
    return get().arrays.filter((item) => item.plantId === plantId);
  },

  activePlant() {
    const { plants, activePlantId } = get();
    return plants.find((item) => item.id === activePlantId) ?? null;
  },
}));

/** 便捷选择器：当前电站下的方阵 */
export function selectArraysOfActivePlant(state: PlantStoreState): PvArray[] {
  if (!state.activePlantId) return [];
  return state.arrays.filter((item) => item.plantId === state.activePlantId);
}
