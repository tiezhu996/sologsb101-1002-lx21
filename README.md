# 光伏电站组串失配排查台（sologsb101-1002 / gbpvstring）

## 一、Docker 一键启动（推荐）

```bash
cd sologsb101-1002
cp .env.example .env
docker compose up -d --build
```

启动后访问：**http://localhost:22802**

停止与清理：

```bash
docker compose down          # 停止并删除容器
docker compose up -d --build # 代码改动后重建
```

## 二、项目简介

面向光伏电站运维人员，按 **逆变器 → 汇流箱 → 组串** 三级定位失配与低效组串，并用 **清洗 / 更换 / 复测** 三类处置单闭环。

核心动作：

- 录入电站与方阵结构（装机容量、并网日期、纬度、倾角、方位角）
- 维护逆变器 / 汇流箱 / 组串三级设备台账，支持批量新增组串
- 采集组串电流、电压、辐照度，按汇流箱分组实时计算**离散率**（标准差 / 均值），辐照度不同自动做归一化修正
- 在失配排查工作台按离散率与电流偏差排序、人工标记可疑组串、追溯同汇流箱与同逆变器对比
- 下发处置单并回填复测电流，复测达基准 95% 自动判定消缺
- 配置判定阈值、查看 IndexedDB 结构版本并做整库 JSON 导出 / 导入

本项目为**纯前端单页应用**：无后端、无数据库服务、无外部接口，全部数据保存在浏览器 IndexedDB。

## 三、技术栈

| 分类 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | React | 18.3 |
| 语言 | TypeScript | 5.7 |
| UI 组件库 | Ant Design | 5.22 |
| 构建工具 | Vite | 5.4 |
| 状态管理 | Zustand | 4.5 |
| 路由 | React Router | 6.28 |
| 本地持久化 | Dexie（IndexedDB） | 4.0 |
| 容器 | 多阶段构建 node:20-alpine → nginx:alpine | — |

## 四、路由一览

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/plants` | 电站与方阵 | 录入电站与方阵结构，按容量与纬度带筛选 |
| `/inverters` | 三级设备台账 | 逆变器 / 汇流箱 / 组串树形台账，批量新增组串 |
| `/samples` | 采集与离散率 | 录入组串电流电压，实时计算离散率并标红越限 |
| `/diagnose` | 失配排查工作台 | 离散率倒序、标记可疑、同汇流箱 / 同逆变器追溯 |
| `/disposals` | 处置单 | 清洗 / 更换 / 复测三类单子派工与复测回填 |
| `/settings` | 阈值与版本 | 阈值配置、结构版本、整库 JSON 导出 / 导入 |

## 五、目录结构

```
sologsb101-1002/
├── README.md
├── docker-compose.yml           # 顶层 name: gbpvstring，无 version 字段
├── .env / .env.example          # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── .gitignore
└── frontend/
    ├── Dockerfile               # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf               # try_files 前端路由回退 + gzip
    ├── .dockerignore
    ├── package.json / tsconfig.json / tsconfig.node.json
    ├── vite.config.ts / index.html
    ├── public/favicon.svg
    └── src/
        ├── main.tsx             # 入口：ConfigProvider + RouterProvider
        ├── App.tsx              # 应用外壳（侧边导航 + 当前电站上下文）
        ├── styles/main.css
        ├── types/               # plant.ts array.ts inverter.ts string.ts sample.ts disposal.ts settings.ts persistence.ts
        ├── stores/              # plantStore.ts deviceStore.ts sampleStore.ts disposalStore.ts
        ├── components/common/   # DiscreteBadge.tsx FilterBar.tsx StatBadge.tsx EmptyPanel.tsx
        ├── hooks/               # useStringRank.ts useIdbTable.ts
        ├── pages/               # PlantList.tsx DeviceLedger.tsx SampleEntry.tsx DiagnoseBoard.tsx DisposalList.tsx SettingsView.tsx
        ├── router/index.tsx     # 路由表（懒加载页面 + App 布局）
        ├── router/routes.ts     # 叶子模块：仅路径常量，切断 App ⇄ router 循环依赖
        └── utils/               # discrete.ts unit.ts db.ts export.ts events.ts format.ts
```

## 六、数据存储说明

- **存储介质**：浏览器 IndexedDB，库名 **`gbpvstring`**，通过 Dexie 4.x 封装。
- **数据结构版本**：`utils/db.ts` 中 `DB_SCHEMA_VERSION = 2`，并登记了 v1 → v2 的 `upgrade` 迁移（补齐行修订号 `revision`、迁移旧字段 `combinerNo → combinerBox`、写入默认阈值）。
- **数据表**：

  | 表名 | 实体 | 主要索引 |
  | --- | --- | --- |
  | `plants` | 电站 | id / name / gridDate / latitude / capacityMWp |
  | `arrays` | 方阵 | id / plantId / code / capacityKw |
  | `inverters` | 逆变器 | id / arrayId / model / ratedKw |
  | `strings` | 组串 | id / inverterId / combinerBox / code / moduleModel |
  | `samples` | 采集读数 | id / stringId / sampledAt / [stringId+sampledAt] |
  | `disposals` | 处置单 | id / stringId / state / type / owner / dueDate |
  | `settings` | 阈值配置 | id（固定 `threshold`） |

- **首屏自动播种**：`initDatabase()` 在 `plants` 表为空时写入演示数据（幂等）——2 个电站 × 各 2 个方阵 × 各 1~2 台逆变器 × 若干汇流箱与组串 × 每串 4 个采集点 + 5 张处置单，父子记录通过 `plantId / arrayId / inverterId / stringId` 互相引用。
- **跨页状态**：全部放在 Zustand store（`plantStore / deviceStore / sampleStore / disposalStore`），页面只读 store；Dexie 写入后由 `utils/events.ts` 广播，各 store 自动重新拉取。
- **数据不出浏览器**：容器无状态，不挂载卷、不使用数据库服务。

## 七、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:22802
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit && vite build
npm run preview    # 预览构建产物
```

## 八、容器化细节

- `Dockerfile` 两阶段构建：`node:20-alpine` 安装依赖并执行 `npm run build`（内含 TypeScript 类型检查），随后拷贝 `dist` 到 `nginx:alpine`。
- 运行阶段在 `COPY --from=builder /app/dist /usr/share/nginx/html` 之后执行 `RUN chmod -R a+rX /usr/share/nginx/html`，规避历史遗留的 favicon 权限 0600 导致 nginx 403 的问题。
- `nginx.conf` 使用 `try_files $uri $uri/ /index.html;` 支持前端路由直接刷新，并开启 gzip。
- `docker-compose.yml` 不写 `version:`，顶层 `name: gbpvstring` 兜底（避免中文目录名导致项目名为空），服务名 `frontend`，容器名 `${COMPOSE_PROJECT_NAME:-gbpvstring}-frontend`，端口 `${FRONTEND_PORT:-22802}:80`，`restart: unless-stopped`。
