/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据结构版本号 + 升级迁移逻辑
 * - 各实体表的增删改查（级联删除）
 * - 首次打开时自动播种互相引用的演示数据，保证每个页面打开都有内容
 * - 纯前端应用：不依赖任何后端或数据库服务
 */
import Dexie, { type Table } from 'dexie';
import type { Plant } from '../types/plant';
import type { Array as PvArray } from '../types/array';
import type { Inverter } from '../types/inverter';
import type { PvString } from '../types/string';
import type { Sample } from '../types/sample';
import type { Disposal } from '../types/disposal';
import { DEFAULT_THRESHOLDS, type ThresholdRow } from '../types/settings';
import { ROW_REVISION, type Revisioned } from '../types/persistence';
import { normalizeCurrent, discreteRate } from './discrete';
import { nowIso, round, shiftDate, todayDate, uuid } from './format';

/** 数据库名（浏览器 IndexedDB 库名） */
export const DB_NAME = 'gbpvstring';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

export { ROW_REVISION };
export type { Revisioned };

export type PlantRow = Plant & Revisioned;
export type ArrayRow = PvArray & Revisioned;
export type InverterRow = Inverter & Revisioned;
export type StringRow = PvString & Revisioned;
export type SampleRow = Sample & Revisioned;
export type DisposalRow = Disposal & Revisioned;

class PvStringDatabase extends Dexie {
  plants!: Table<PlantRow, string>;
  arrays!: Table<ArrayRow, string>;
  inverters!: Table<InverterRow, string>;
  strings!: Table<StringRow, string>;
  samples!: Table<SampleRow, string>;
  disposals!: Table<DisposalRow, string>;
  settings!: Table<ThresholdRow, string>;

  constructor() {
    super(DB_NAME);

    // v1：初版结构，仅建立基础索引（保留历史数据）
    this.version(1).stores({
      plants: 'id, name, gridDate, latitude',
      arrays: 'id, plantId, code',
      inverters: 'id, arrayId, model',
      strings: 'id, inverterId, combinerBox, code',
      samples: 'id, stringId, sampledAt',
      disposals: 'id, stringId, state, type',
    });

    // v2：新增 revision 行修订号；组串补充 moduleModel 索引，处置单补充 owner 索引；
    //     采样表补充组合索引便于按组串+时间取窗口
    this.version(DB_SCHEMA_VERSION)
      .stores({
        plants: 'id, name, gridDate, latitude, capacityMWp',
        arrays: 'id, plantId, code, capacityKw',
        inverters: 'id, arrayId, model, ratedKw',
        strings: 'id, inverterId, combinerBox, code, moduleModel',
        samples: 'id, stringId, sampledAt, [stringId+sampledAt]',
        disposals: 'id, stringId, state, type, owner, dueDate',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        // 行迁移：补齐 revision 与新增字段的兜底值
        const tables: Array<Table<Record<string, unknown>, string>> = [
          tx.table('plants'),
          tx.table('arrays'),
          tx.table('inverters'),
          tx.table('strings'),
          tx.table('samples'),
          tx.table('disposals'),
        ];
        for (const table of tables) {
          await table.toCollection().modify((row: Record<string, unknown>) => {
            row.revision = ROW_REVISION;
            if (typeof row.createdAt !== 'string') row.createdAt = nowIso();
          });
        }
        // 迁移：旧版组串字段 combinerNo → combinerBox
        await tx.table('strings').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.combinerBox !== 'string' && typeof row.combinerNo === 'string') {
            row.combinerBox = row.combinerNo;
          }
        });
        // 迁移：阈值配置缺失时写入默认值
        const settings = tx.table('settings');
        const existing = (await settings.get('threshold')) as ThresholdRow | undefined;
        if (!existing) {
          await settings.put({ ...DEFAULT_THRESHOLDS, id: 'threshold', updatedAt: nowIso() });
        }
      });
  }
}

export const db = new PvStringDatabase();

/* ============================ 演示数据播种 ============================ */

/** 确定性伪随机，保证每次播种出的演示数据一致 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

interface SeedPlan {
  name: string;
  capacityMWp: number;
  gridDate: string;
  latitude: number;
  arrays: Array<{
    code: string;
    tiltDeg: number;
    azimuthDeg: number;
    capacityKw: number;
    inverters: Array<{
      model: string;
      ratedKw: number;
      mpptCount: number;
      commissionDate: string;
      boxes: Array<{ box: string; startSeq: number; count: number; moduleModel: string; seriesCount: number }>;
    }>;
  }>;
}

const SEED_PLANS: SeedPlan[] = [
  {
    name: '沙湖滩一期光伏电站',
    capacityMWp: 32.5,
    gridDate: '2021-06-28',
    latitude: 38.47,
    arrays: [
      {
        code: 'A1',
        tiltDeg: 32,
        azimuthDeg: 180,
        capacityKw: 4200,
        inverters: [
          {
            model: 'SG3125HV-MV',
            ratedKw: 3125,
            mpptCount: 4,
            commissionDate: '2021-07-15',
            boxes: [
              { box: 'BX-01', startSeq: 1, count: 4, moduleModel: 'LR5-72HBD-545M', seriesCount: 26 },
              { box: 'BX-02', startSeq: 9, count: 4, moduleModel: 'LR5-72HBD-545M', seriesCount: 26 },
            ],
          },
          {
            model: 'SG250HX',
            ratedKw: 250,
            mpptCount: 12,
            commissionDate: '2022-03-10',
            boxes: [{ box: 'BX-11', startSeq: 17, count: 4, moduleModel: 'LR5-72HBD-545M', seriesCount: 24 }],
          },
        ],
      },
      {
        code: 'A2',
        tiltDeg: 28,
        azimuthDeg: 186,
        capacityKw: 3600,
        inverters: [
          {
            model: 'SG3125HV-MV',
            ratedKw: 3125,
            mpptCount: 4,
            commissionDate: '2021-08-02',
            boxes: [
              { box: 'BX-03', startSeq: 1, count: 3, moduleModel: 'JKM560M-72HL4', seriesCount: 25 },
              { box: 'BX-04', startSeq: 9, count: 3, moduleModel: 'JKM560M-72HL4', seriesCount: 25 },
            ],
          },
        ],
      },
    ],
  },
  {
    name: '云岭山坡光伏电站',
    capacityMWp: 18.2,
    gridDate: '2023-04-12',
    latitude: 26.18,
    arrays: [
      {
        code: 'B1',
        tiltDeg: 22,
        azimuthDeg: 175,
        capacityKw: 2600,
        inverters: [
          {
            model: 'SUN2000-185KTL',
            ratedKw: 185,
            mpptCount: 9,
            commissionDate: '2023-05-06',
            boxes: [{ box: 'BX-01', startSeq: 1, count: 4, moduleModel: 'CHSM72M-HC-550', seriesCount: 24 }],
          },
          {
            model: 'SUN2000-100KTL',
            ratedKw: 100,
            mpptCount: 10,
            commissionDate: '2023-05-20',
            boxes: [{ box: 'BX-06', startSeq: 9, count: 3, moduleModel: 'CHSM72M-HC-550', seriesCount: 22 }],
          },
        ],
      },
      {
        code: 'B2',
        tiltDeg: 18,
        azimuthDeg: 190,
        capacityKw: 1800,
        inverters: [
          {
            model: 'SUN2000-185KTL',
            ratedKw: 185,
            mpptCount: 9,
            commissionDate: '2023-06-11',
            boxes: [{ box: 'BX-02', startSeq: 1, count: 4, moduleModel: 'CHSM72M-HC-550', seriesCount: 24 }],
          },
        ],
      },
    ],
  },
];

/**
 * 首次打开时播种：2 个电站 × 各 2 个方阵 × 各 1~2 台逆变器 × 若干汇流箱/组串 × 每串多点采集 + 处置单。
 * 数据父子互相引用（plantId / arrayId / inverterId / stringId），全部页面打开即有内容。
 */
async function seedDatabase(): Promise<void> {
  const random = makeRandom(20240823);
  const stamp = nowIso();

  const plants: PlantRow[] = [];
  const arrays: ArrayRow[] = [];
  const inverters: InverterRow[] = [];
  const strings: StringRow[] = [];
  const samples: SampleRow[] = [];
  const disposals: DisposalRow[] = [];

  SEED_PLANS.forEach((plan, plantIndex) => {
    const plantId = `plant-${plantIndex + 1}`;
    plants.push({
      id: plantId,
      name: plan.name,
      capacityMWp: plan.capacityMWp,
      gridDate: plan.gridDate,
      latitude: plan.latitude,
      createdAt: stamp,
      revision: ROW_REVISION,
    });

    plan.arrays.forEach((arrayPlan, arrayIndex) => {
      const arrayId = `array-${plantIndex + 1}-${arrayIndex + 1}`;
      arrays.push({
        id: arrayId,
        plantId,
        code: arrayPlan.code,
        tiltDeg: arrayPlan.tiltDeg,
        azimuthDeg: arrayPlan.azimuthDeg,
        capacityKw: arrayPlan.capacityKw,
        createdAt: stamp,
        revision: ROW_REVISION,
      });

      arrayPlan.inverters.forEach((inverterPlan, inverterIndex) => {
        const inverterId = `inv-${plantIndex + 1}-${arrayIndex + 1}-${inverterIndex + 1}`;
        inverters.push({
          id: inverterId,
          arrayId,
          model: inverterPlan.model,
          ratedKw: inverterPlan.ratedKw,
          mpptCount: inverterPlan.mpptCount,
          commissionDate: inverterPlan.commissionDate,
          createdAt: stamp,
          revision: ROW_REVISION,
        });

        inverterPlan.boxes.forEach((boxPlan) => {
          for (let offset = 0; offset < boxPlan.count; offset += 1) {
            const seq = boxPlan.startSeq + offset;
            const stringId = `str-${inverterId}-${seq}`;
            strings.push({
              id: stringId,
              inverterId,
              combinerBox: boxPlan.box,
              code: `${boxPlan.box.replace('BX-', '')}-${String(offset + 1).padStart(2, '0')}`,
              moduleModel: boxPlan.moduleModel,
              seriesCount: boxPlan.seriesCount,
              createdAt: stamp,
              revision: ROW_REVISION,
            });

            // 每串 4 个采集点：辐照度 780~980 W/m²，制造少量失配组串
            const isMismatch = random() > 0.78;
            const isWatch = !isMismatch && random() > 0.6;
            const baseCurrent = round(8.2 + random() * 1.4, 2);
            for (let point = 0; point < 4; point += 1) {
              const irradiance = Math.round(780 + random() * 200);
              const drift = isMismatch ? 0.62 + point * 0.03 : isWatch ? 0.86 + point * 0.01 : 0.97 + random() * 0.06;
              const currentA = round(baseCurrent * drift, 2);
              const sampledAt = `${shiftDate(-1)} ${String(9 + point).padStart(2, '0')}:${point % 2 === 0 ? '15' : '45'}`;
              samples.push({
                id: `smp-${stringId}-${point + 1}`,
                stringId,
                sampledAt,
                currentA,
                voltageV: round(boxPlan.seriesCount * 41.6 + random() * 22, 1),
                irradianceWm2: irradiance,
                discreteRate: 0,
                createdAt: stamp,
                revision: ROW_REVISION,
              });
            }
          }
        });
      });
    });
  });

  // 采集离散率落库：按逆变器+汇流箱分组计算，写入每条采集记录
  const byBucket = new Map<string, SampleRow[]>();
  for (const sample of samples) {
    const owner = strings.find((item) => item.id === sample.stringId);
    if (!owner) continue;
    const key = `${owner.inverterId}::${owner.combinerBox}`;
    const list = byBucket.get(key);
    if (list) list.push(sample);
    else byBucket.set(key, [sample]);
  }
  for (const list of byBucket.values()) {
    const byString = new Map<string, SampleRow[]>();
    for (const sample of list) {
      const rows = byString.get(sample.stringId);
      if (rows) rows.push(sample);
      else byString.set(sample.stringId, [sample]);
    }
    for (const rows of byString.values()) {
      const rate = discreteRate(
        rows.map((row) => normalizeCurrent(row.currentA, row.irradianceWm2)),
      );
      for (const row of rows) row.discreteRate = rate;
    }
  }

  // 处置单：为离散率最高的前 5 个组串建单，状态各不相同
  const perString = new Map<string, number>();
  for (const row of samples) {
    perString.set(row.stringId, Math.max(perString.get(row.stringId) ?? 0, row.discreteRate));
  }
  const ranked = [...perString.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const types: Array<Disposal['type']> = ['clean', 'replace', 'retest', 'clean', 'replace'];
  const states: Array<Disposal['state']> = ['pending', 'assigned', 'retested', 'assigned', 'pending'];
  const owners = ['李文波', '张启明', '王慧敏'];
  ranked.forEach(([stringId, rate], index) => {
    const state = states[index % states.length];
    disposals.push({
      id: `disp-${index + 1}`,
      stringId,
      type: types[index % types.length],
      state,
      owner: owners[index % owners.length],
      dueDate: shiftDate(index % 2 === 0 ? 3 : -2),
      retestCurrentA: state === 'retested' ? round(9.1 + index * 0.18, 2) : null,
      initialDiscreteRate: rate,
      createdAt: stamp,
      updatedAt: stamp,
      revision: ROW_REVISION,
    });
  });

  await db.transaction(
    'rw',
    [db.plants, db.arrays, db.inverters, db.strings, db.samples, db.disposals, db.settings],
    async () => {
      await db.plants.bulkPut(plants);
      await db.arrays.bulkPut(arrays);
      await db.inverters.bulkPut(inverters);
      await db.strings.bulkPut(strings);
      await db.samples.bulkPut(samples);
      await db.disposals.bulkPut(disposals);
      await db.settings.put({ ...DEFAULT_THRESHOLDS, id: 'threshold', updatedAt: stamp });
    },
  );
}

/* ============================== 初始化 ============================== */

/** 打开数据库；首屏若电站表为空则播种演示数据（幂等，仅空库执行） */
export async function initDatabase(): Promise<void> {
  await db.open();
  const count = await db.plants.count();
  if (count === 0) {
    await seedDatabase();
  }
  const settings = await db.settings.get('threshold');
  if (!settings) {
    await db.settings.put({ ...DEFAULT_THRESHOLDS, id: 'threshold', updatedAt: nowIso() });
  }
}

/* ============================== 电站 ============================== */

export async function listPlants(): Promise<PlantRow[]> {
  const rows = await db.plants.toArray();
  return rows.sort((a, b) => b.capacityMWp - a.capacityMWp);
}

export async function getPlant(id: string): Promise<PlantRow | undefined> {
  return db.plants.get(id);
}

export async function putPlant(row: PlantRow): Promise<void> {
  await db.plants.put(row);
}

/** 删除电站：级联清理方阵 → 逆变器 → 组串 → 采集 → 处置单 */
export async function removePlant(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.plants, db.arrays, db.inverters, db.strings, db.samples, db.disposals],
    async () => {
      const arrays = await db.arrays.where('plantId').equals(id).toArray();
      const arrayIds = arrays.map((item) => item.id);
      const inverterRows = arrayIds.length
        ? await db.inverters.where('arrayId').anyOf(arrayIds).toArray()
        : [];
      const inverterIds = inverterRows.map((item) => item.id);
      const stringRows = inverterIds.length
        ? await db.strings.where('inverterId').anyOf(inverterIds).toArray()
        : [];
      const stringIds = stringRows.map((item) => item.id);
      if (stringIds.length) {
        await db.samples.where('stringId').anyOf(stringIds).delete();
        await db.disposals.where('stringId').anyOf(stringIds).delete();
      }
      if (inverterIds.length) await db.strings.where('inverterId').anyOf(inverterIds).delete();
      if (arrayIds.length) await db.inverters.where('arrayId').anyOf(arrayIds).delete();
      await db.arrays.where('plantId').equals(id).delete();
      await db.plants.delete(id);
    },
  );
}

/* ============================== 方阵 ============================== */

export async function listArrays(): Promise<ArrayRow[]> {
  const rows = await db.arrays.toArray();
  return rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'));
}

export async function listArraysByPlant(plantId: string): Promise<ArrayRow[]> {
  const rows = await db.arrays.where('plantId').equals(plantId).toArray();
  return rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'));
}

export async function putArray(row: ArrayRow): Promise<void> {
  await db.arrays.put(row);
}

export async function removeArray(id: string): Promise<void> {
  await db.transaction('rw', [db.arrays, db.inverters, db.strings, db.samples, db.disposals], async () => {
    const inverterRows = await db.inverters.where('arrayId').equals(id).toArray();
    const inverterIds = inverterRows.map((item) => item.id);
    const stringRows = inverterIds.length
      ? await db.strings.where('inverterId').anyOf(inverterIds).toArray()
      : [];
    const stringIds = stringRows.map((item) => item.id);
    if (stringIds.length) {
      await db.samples.where('stringId').anyOf(stringIds).delete();
      await db.disposals.where('stringId').anyOf(stringIds).delete();
    }
    if (inverterIds.length) await db.strings.where('inverterId').anyOf(inverterIds).delete();
    await db.inverters.where('arrayId').equals(id).delete();
    await db.arrays.delete(id);
  });
}

/* ============================= 逆变器 ============================= */

export async function listInverters(): Promise<InverterRow[]> {
  return db.inverters.toArray();
}

export async function listInvertersByArray(arrayId: string): Promise<InverterRow[]> {
  return db.inverters.where('arrayId').equals(arrayId).toArray();
}

export async function putInverter(row: InverterRow): Promise<void> {
  await db.inverters.put(row);
}

export async function removeInverter(id: string): Promise<void> {
  await db.transaction('rw', [db.inverters, db.strings, db.samples, db.disposals], async () => {
    const stringRows = await db.strings.where('inverterId').equals(id).toArray();
    const stringIds = stringRows.map((item) => item.id);
    if (stringIds.length) {
      await db.samples.where('stringId').anyOf(stringIds).delete();
      await db.disposals.where('stringId').anyOf(stringIds).delete();
    }
    await db.strings.where('inverterId').equals(id).delete();
    await db.inverters.delete(id);
  });
}

/* ============================== 组串 ============================== */

export async function listStrings(): Promise<StringRow[]> {
  return db.strings.toArray();
}

export async function listStringsByInverter(inverterId: string): Promise<StringRow[]> {
  const rows = await db.strings.where('inverterId').equals(inverterId).toArray();
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export async function putString(row: StringRow): Promise<void> {
  await db.strings.put(row);
}

export async function putStrings(rows: StringRow[]): Promise<void> {
  await db.strings.bulkPut(rows);
}

export async function removeString(id: string): Promise<void> {
  await db.transaction('rw', [db.strings, db.samples, db.disposals], async () => {
    await db.samples.where('stringId').equals(id).delete();
    await db.disposals.where('stringId').equals(id).delete();
    await db.strings.delete(id);
  });
}

/* ============================== 采集 ============================== */

export async function listSamples(): Promise<SampleRow[]> {
  const rows = await db.samples.toArray();
  return rows.sort((a, b) => b.sampledAt.localeCompare(a.sampledAt));
}

export async function listSamplesByString(stringId: string): Promise<SampleRow[]> {
  const rows = await db.samples.where('stringId').equals(stringId).toArray();
  return rows.sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
}

export async function putSample(row: SampleRow): Promise<void> {
  await db.samples.put(row);
}

export async function putSamples(rows: SampleRow[]): Promise<void> {
  await db.samples.bulkPut(rows);
}

export async function removeSample(id: string): Promise<void> {
  await db.samples.delete(id);
}

/* ============================= 处置单 ============================= */

export async function listDisposals(): Promise<DisposalRow[]> {
  const rows = await db.disposals.toArray();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function putDisposal(row: DisposalRow): Promise<void> {
  await db.disposals.put(row);
}

export async function removeDisposal(id: string): Promise<void> {
  await db.disposals.delete(id);
}

/* ============================ 阈值配置 ============================ */

export async function getThresholds(): Promise<ThresholdRow> {
  const row = await db.settings.get('threshold');
  return row ?? { ...DEFAULT_THRESHOLDS, id: 'threshold', updatedAt: nowIso() };
}

export async function putThresholds(row: ThresholdRow): Promise<void> {
  await db.settings.put(row);
}

/* ========================== 整库导入导出 ========================== */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  plants: Plant[];
  arrays: PvArray[];
  inverters: Inverter[];
  strings: PvString[];
  samples: Sample[];
  disposals: Disposal[];
  thresholds: ThresholdRow;
}

function stripRevision<T extends Revisioned>(row: T): Omit<T, 'revision'> {
  const { revision: _revision, ...rest } = row;
  return rest;
}

export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [plants, arrays, inverters, strings, samples, disposals, thresholds] = await Promise.all([
    listPlants(),
    listArrays(),
    listInverters(),
    listStrings(),
    listSamples(),
    listDisposals(),
    getThresholds(),
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    plants: plants.map(stripRevision),
    arrays: arrays.map(stripRevision),
    inverters: inverters.map(stripRevision),
    strings: strings.map(stripRevision),
    samples: samples.map(stripRevision),
    disposals: disposals.map(stripRevision),
    thresholds,
  };
}

export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  const rev = <T,>(row: T): T & Revisioned => ({ ...row, revision: ROW_REVISION });
  await db.transaction(
    'rw',
    [db.plants, db.arrays, db.inverters, db.strings, db.samples, db.disposals, db.settings],
    async () => {
      await Promise.all([
        db.plants.clear(),
        db.arrays.clear(),
        db.inverters.clear(),
        db.strings.clear(),
        db.samples.clear(),
        db.disposals.clear(),
      ]);
      await db.plants.bulkPut((snapshot.plants ?? []).map(rev));
      await db.arrays.bulkPut((snapshot.arrays ?? []).map(rev));
      await db.inverters.bulkPut((snapshot.inverters ?? []).map(rev));
      await db.strings.bulkPut((snapshot.strings ?? []).map(rev));
      await db.samples.bulkPut((snapshot.samples ?? []).map(rev));
      await db.disposals.bulkPut((snapshot.disposals ?? []).map(rev));
      if (snapshot.thresholds) await db.settings.put(snapshot.thresholds);
    },
  );
}

/** 清空并重新播种（/settings 页的重置入口） */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.plants, db.arrays, db.inverters, db.strings, db.samples, db.disposals, db.settings],
    async () => {
      await Promise.all([
        db.plants.clear(),
        db.arrays.clear(),
        db.inverters.clear(),
        db.strings.clear(),
        db.samples.clear(),
        db.disposals.clear(),
        db.settings.clear(),
      ]);
    },
  );
  await seedDatabase();
}

/** 各表行数统计，用于页脚与阈值页概览 */
export async function countAll(): Promise<Record<string, number>> {
  const [plants, arrays, inverters, strings, samples, disposals] = await Promise.all([
    db.plants.count(),
    db.arrays.count(),
    db.inverters.count(),
    db.strings.count(),
    db.samples.count(),
    db.disposals.count(),
  ]);
  return { plants, arrays, inverters, strings, samples, disposals };
}

/** 结构版本信息（/settings 页展示） */
export interface SchemaInfo {
  dbName: string;
  schemaVersion: number;
  rowRevision: number;
  today: string;
}

export function schemaInfo(): SchemaInfo {
  return {
    dbName: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    rowRevision: ROW_REVISION,
    today: todayDate(),
  };
}

/** 供 store 组装演示/统计用：产生一个新组串行的工厂 */
export function newStringRow(input: {
  inverterId: string;
  combinerBox: string;
  code: string;
  moduleModel: string;
  seriesCount: number;
}): StringRow {
  return {
    id: uuid(),
    inverterId: input.inverterId,
    combinerBox: input.combinerBox,
    code: input.code,
    moduleModel: input.moduleModel,
    seriesCount: input.seriesCount,
    createdAt: nowIso(),
    revision: ROW_REVISION,
  };
}
