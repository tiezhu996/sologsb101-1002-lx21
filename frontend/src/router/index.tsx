/**
 * 路由表（路径与项目提示词逐字一致）
 * /plants、/inverters、/samples、/diagnose、/disposals、/settings
 * 页面按路由懒加载，构建时自动分包。
 *
 * 路径常量定义在叶子模块 ./routes 中：本文件 import App，App 也 import 路径常量，
 * 常量留在本文件会形成 App ⇄ router 循环依赖并在首屏抛 TDZ 错误（整站白屏）。
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { Skeleton } from 'antd';
import App from '../App';
import { ROUTES } from './routes';

const PlantList = lazy(() => import('../pages/PlantList'));
const DeviceLedger = lazy(() => import('../pages/DeviceLedger'));
const SampleEntry = lazy(() => import('../pages/SampleEntry'));
const DiagnoseBoard = lazy(() => import('../pages/DiagnoseBoard'));
const DisposalList = lazy(() => import('../pages/DisposalList'));
const SettingsView = lazy(() => import('../pages/SettingsView'));

/** 兼容出口：路径常量请优先直接从 './routes' 引入（叶子模块，不产生环） */
export { ROUTES } from './routes';
export type { RouteKey } from './routes';

function RouteFallback() {
  return (
    <Skeleton
      active
      paragraph={{ rows: 6 }}
      style={{ background: '#fff', padding: 16, borderRadius: 10 }}
    />
  );
}

function withSuspense(node: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to={ROUTES.plants} replace /> },
      { path: 'plants', element: withSuspense(<PlantList />) },
      { path: 'inverters', element: withSuspense(<DeviceLedger />) },
      { path: 'samples', element: withSuspense(<SampleEntry />) },
      { path: 'diagnose', element: withSuspense(<DiagnoseBoard />) },
      { path: 'disposals', element: withSuspense(<DisposalList />) },
      { path: 'settings', element: withSuspense(<SettingsView />) },
      { path: '*', element: <Navigate to={ROUTES.plants} replace /> },
    ],
  },
];

export default appRoutes;
