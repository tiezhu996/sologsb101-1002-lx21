/**
 * 逆变器限功率时段状态（Zustand）
 * 维护各电站的限功率时段台账（全厂统一 + 单台逆变器），供统计折算与电站页管理共用。
 * 统计口径见 types/curtailment.ts 与 utils/curtailment.ts：
 * 按实际限值折算、重叠取最严、缺结束时间算到当前批次末尾、跨日直接按完整时间比较。
 */
import { create } from 'zustand';
import {
  listCurtailments,
  putCurtailment,
  removeCurtailment,
  type CurtailmentRow,
} from '../utils/db';
import type { CurtailmentDraft } from '../types/curtailment';
import { nowIso, uuid } from '../utils/format';
import { emitChange, subscribeChange } from '../utils/events';

interface CurtailStoreState {
  curtailments: CurtailmentRow[];
  loading: boolean;
  error: string;
  loadCurtailments: () => Promise<void>;
  subscribe: () => void;
  createCurtailment: (draft: CurtailmentDraft) => Promise<CurtailmentRow>;
  updateCurtailment: (id: string, draft: CurtailmentDraft) => Promise<void>;
  deleteCurtailment: (id: string) => Promise<void>;
  /** 指定电站的时段（含全厂统一与各逆变器时段），按开始时间倒序 */
  byPlant: (plantId: string) => CurtailmentRow[];
}

function normalizeDraft(draft: CurtailmentDraft): Omit<CurtailmentRow, 'id' | 'createdAt'> {
  return {
    plantId: draft.plantId,
    inverterId: draft.inverterId,
    startAt: draft.startAt.trim(),
    endAt: draft.endAt.trim(),
    limitRatio: draft.limitRatio,
    limitKw: draft.limitKw,
    note: draft.note.trim(),
    updatedAt: nowIso(),
  };
}

let unsubscribed: (() => void) | null = null;

export const useCurtailStore = create<CurtailStoreState>((set, get) => ({
  curtailments: [],
  loading: false,
  error: '',

  async loadCurtailments() {
    set({ loading: true });
    try {
      const curtailments = await listCurtailments();
      set({ curtailments, loading: false, error: '' });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '限功率时段读取失败',
      });
    }
  },

  subscribe() {
    if (unsubscribed) return;
    unsubscribed = subscribeChange(() => {
      void get().loadCurtailments();
    });
  },

  async createCurtailment(draft) {
    const stamp = nowIso();
    const row: CurtailmentRow = {
      id: uuid(),
      ...normalizeDraft(draft),
      createdAt: stamp,
    };
    await putCurtailment(row);
    emitChange();
    return row;
  },

  async updateCurtailment(id, draft) {
    const existing = get().curtailments.find((item) => item.id === id);
    if (!existing) return;
    await putCurtailment({
      ...existing,
      ...normalizeDraft(draft),
    });
    emitChange();
  },

  async deleteCurtailment(id) {
    await removeCurtailment(id);
    emitChange();
  },

  byPlant(plantId) {
    return get()
      .curtailments.filter((item) => item.plantId === plantId)
      .sort((a, b) => b.startAt.localeCompare(a.startAt));
  },
}));
