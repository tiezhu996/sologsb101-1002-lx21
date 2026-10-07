/**
 * 三级设备台账状态（Zustand）
 * 维护逆变器 / 汇流箱 / 组串三级台账、树形展开态与批量新增组串逻辑。
 */
import { create } from 'zustand';
import {
  ROW_REVISION,
  listInverters,
  listPlants,
  listArrays,
  listSamples,
  listStrings,
  newStringRow,
  putInverter,
  putString,
  putStrings,
  removeInverter,
  removeString,
  type InverterRow,
  type PlantRow,
  type ArrayRow as DbArrayRow,
  type StringRow,
} from '../utils/db';
import type { BatchStringDraft, StringDraft } from '../types/string';
import type { InverterDraft, InverterLedgerRow } from '../types/inverter';
import { formatStringCode } from '../types/string';
import { nowIso, uuid } from '../utils/format';
import { emitChange, subscribeChange } from '../utils/events';

interface DeviceStoreState {
  plants: PlantRow[];
  arrays: DbArrayRow[];
  inverters: InverterRow[];
  strings: StringRow[];
  /** 树形展开的逆变器 id 集合 */
  expandedInverterIds: string[];
  /** 每个组串的最高离散率，来自采集表 */
  stringAlarmRates: Record<string, number>;
  loading: boolean;
  error: string;
  loadDevices: () => Promise<void>;
  subscribe: () => void;
  toggleExpand: (inverterId: string) => void;
  setExpanded: (inverterIds: string[]) => void;
  expandAll: () => void;
  collapseAll: () => void;
  createInverter: (draft: InverterDraft) => Promise<InverterRow>;
  updateInverter: (inverterId: string, draft: InverterDraft) => Promise<void>;
  deleteInverter: (inverterId: string) => Promise<void>;
  createString: (draft: StringDraft) => Promise<StringRow>;
  updateString: (stringId: string, draft: StringDraft) => Promise<void>;
  deleteString: (stringId: string) => Promise<void>;
  batchCreateStrings: (draft: BatchStringDraft) => Promise<number>;
  stringsOfInverter: (inverterId: string) => StringRow[];
  boxCodesOfInverter: (inverterId: string) => string[];
  ledgerRows: () => InverterLedgerRow[];
  ledgerRowOf: (inverterId: string) => InverterLedgerRow | null;
}

let unsubscribed: (() => void) | null = null;

export const useDeviceStore = create<DeviceStoreState>((set, get) => ({
  plants: [],
  arrays: [],
  inverters: [],
  strings: [],
  expandedInverterIds: [],
  stringAlarmRates: {},
  loading: false,
  error: '',

  async loadDevices() {
    set({ loading: true });
    try {
      const [plants, arrays, inverters, strings, samples] = await Promise.all([
        listPlants(),
        listArrays(),
        listInverters(),
        listStrings(),
        listSamples(),
      ]);
      const rates: Record<string, number> = {};
      for (const sample of samples) {
        rates[sample.stringId] = Math.max(rates[sample.stringId] ?? 0, sample.discreteRate);
      }
      set((state) => ({
        plants,
        arrays,
        inverters,
        strings,
        stringAlarmRates: rates,
        loading: false,
        error: '',
        expandedInverterIds:
          state.expandedInverterIds.length > 0
            ? state.expandedInverterIds
            : inverters.slice(0, 2).map((item) => item.id),
      }));
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '设备台账读取失败' });
    }
  },

  subscribe() {
    if (unsubscribed) return;
    unsubscribed = subscribeChange(() => {
      void get().loadDevices();
    });
  },

  toggleExpand(inverterId) {
    set((state) => ({
      expandedInverterIds: state.expandedInverterIds.includes(inverterId)
        ? state.expandedInverterIds.filter((id) => id !== inverterId)
        : [...state.expandedInverterIds, inverterId],
    }));
  },

  setExpanded(inverterIds) {
    set({ expandedInverterIds: inverterIds });
  },

  expandAll() {
    set({ expandedInverterIds: get().inverters.map((item) => item.id) });
  },

  collapseAll() {
    set({ expandedInverterIds: [] });
  },

  async createInverter(draft) {
    const row: InverterRow = {
      id: uuid(),
      arrayId: draft.arrayId,
      model: draft.model.trim(),
      ratedKw: draft.ratedKw,
      mpptCount: draft.mpptCount,
      commissionDate: draft.commissionDate,
      createdAt: nowIso(),
      revision: ROW_REVISION,
    };
    await putInverter(row);
    set((state) => ({ expandedInverterIds: [...state.expandedInverterIds, row.id] }));
    emitChange();
    return row;
  },

  async updateInverter(inverterId, draft) {
    const existing = get().inverters.find((item) => item.id === inverterId);
    if (!existing) return;
    await putInverter({
      ...existing,
      arrayId: draft.arrayId,
      model: draft.model.trim(),
      ratedKw: draft.ratedKw,
      mpptCount: draft.mpptCount,
      commissionDate: draft.commissionDate,
    });
    emitChange();
  },

  async deleteInverter(inverterId) {
    await removeInverter(inverterId);
    emitChange();
  },

  async createString(draft) {
    const row = newStringRow({
      inverterId: draft.inverterId,
      combinerBox: draft.combinerBox.trim(),
      code: draft.code.trim(),
      moduleModel: draft.moduleModel.trim(),
      seriesCount: draft.seriesCount,
    });
    await putString(row);
    emitChange();
    return row;
  },

  async updateString(stringId, draft) {
    const existing = get().strings.find((item) => item.id === stringId);
    if (!existing) return;
    await putString({
      ...existing,
      inverterId: draft.inverterId,
      combinerBox: draft.combinerBox.trim(),
      code: draft.code.trim(),
      moduleModel: draft.moduleModel.trim(),
      seriesCount: draft.seriesCount,
    });
    emitChange();
  },

  async deleteString(stringId) {
    await removeString(stringId);
    emitChange();
  },

  async batchCreateStrings(draft) {
    const existing = get().strings.filter((item) => item.inverterId === draft.inverterId);
    const rows: StringRow[] = [];
    for (let offset = 0; offset < draft.count; offset += 1) {
      const code = formatStringCode(draft.startSeq, offset);
      if (existing.some((item) => item.code === code && item.combinerBox === draft.combinerBox.trim())) {
        continue;
      }
      rows.push(
        newStringRow({
          inverterId: draft.inverterId,
          combinerBox: draft.combinerBox.trim(),
          code,
          moduleModel: draft.moduleModel.trim(),
          seriesCount: draft.seriesCount,
        }),
      );
    }
    if (rows.length > 0) {
      await putStrings(rows);
      emitChange();
    }
    return rows.length;
  },

  stringsOfInverter(inverterId) {
    return get()
      .strings.filter((item) => item.inverterId === inverterId)
      .sort((a, b) => a.code.localeCompare(b.code));
  },

  boxCodesOfInverter(inverterId) {
    const codes = new Set(
      get()
        .strings.filter((item) => item.inverterId === inverterId)
        .map((item) => item.combinerBox),
    );
    return [...codes].sort();
  },

  ledgerRows() {
    const { inverters, arrays, plants, strings, stringAlarmRates } = get();
    return inverters.map((inverter) => {
      const array = arrays.find((item) => item.id === inverter.arrayId);
      const plant = array ? plants.find((item) => item.id === array.plantId) : undefined;
      const owned = strings.filter((item) => item.inverterId === inverter.id);
      const boxCodes = [...new Set(owned.map((item) => item.combinerBox))].sort();
      const alarmStringCount = owned.filter(
        (item) => (stringAlarmRates[item.id] ?? 0) >= 10,
      ).length;
      return {
        ...inverter,
        arrayCode: array?.code ?? '未归属方阵',
        plantId: plant?.id ?? '',
        plantName: plant?.name ?? '未归属电站',
        boxCodes,
        stringCount: owned.length,
        alarmStringCount,
      };
    });
  },

  ledgerRowOf(inverterId) {
    return get().ledgerRows().find((item) => item.id === inverterId) ?? null;
  },
}));
