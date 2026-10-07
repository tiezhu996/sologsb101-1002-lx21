/**
 * 应用外壳：左侧导航 + 顶栏当前电站上下文 + 内容出口。
 * 首屏在此处初始化 IndexedDB 并播种演示数据。
 */
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  App as AntdApp,
  Badge,
  Button,
  Layout,
  Menu,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  AlertOutlined,
  AppstoreOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileProtectOutlined,
  SettingOutlined,
} from '@ant-design/icons';
// 路径常量取自叶子模块 ./router/routes：App 在模块顶层就要用 ROUTES 构造菜单，
// 若从 ./router（会 import App）引入会形成循环依赖 → TDZ「Cannot access before initialization」
import { ROUTES } from './router/routes';
import { usePlantStore } from './stores/plantStore';
import { useSampleStore } from './stores/sampleStore';
import { useDisposalStore } from './stores/disposalStore';
import { useDeviceStore } from './stores/deviceStore';

const { Header, Sider, Content, Footer } = Layout;

const MENU_ITEMS = [
  { key: ROUTES.plants, icon: <AppstoreOutlined />, label: '电站与方阵' },
  { key: ROUTES.inverters, icon: <CloudServerOutlined />, label: '三级设备台账' },
  { key: ROUTES.samples, icon: <ExperimentOutlined />, label: '采集与离散率' },
  { key: ROUTES.diagnose, icon: <AlertOutlined />, label: '失配排查工作台' },
  { key: ROUTES.disposals, icon: <FileProtectOutlined />, label: '处置单' },
  { key: ROUTES.settings, icon: <SettingOutlined />, label: '阈值与版本' },
];

function selectedKeyOf(pathname: string): string {
  const hit = MENU_ITEMS.find((item) => pathname.startsWith(item.key));
  return hit?.key ?? ROUTES.plants;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  const plants = usePlantStore((state) => state.plants);
  const activePlantId = usePlantStore((state) => state.activePlantId);
  const setActivePlant = usePlantStore((state) => state.setActivePlant);
  const bootstrap = usePlantStore((state) => state.bootstrap);
  const plantLoading = usePlantStore((state) => state.loading);
  const plantError = usePlantStore((state) => state.error);

  const loadSamples = useSampleStore((state) => state.loadSamples);
  const subscribeSamples = useSampleStore((state) => state.subscribe);
  const loadDisposals = useDisposalStore((state) => state.loadDisposals);
  const subscribeDisposals = useDisposalStore((state) => state.subscribe);
  const loadDevices = useDeviceStore((state) => state.loadDevices);
  const subscribeDevices = useDeviceStore((state) => state.subscribe);

  const stats = useSampleStore((state) => state.stats);
  const markedStringIds = useSampleStore((state) => state.markedStringIds);
  const disposals = useDisposalStore((state) => state.disposals);
  const inverters = useDeviceStore((state) => state.inverters);
  const strings = useDeviceStore((state) => state.strings);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await bootstrap();
      if (cancelled) return;
      subscribeSamples();
      subscribeDisposals();
      subscribeDevices();
      await Promise.all([loadSamples(), loadDisposals(), loadDevices()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrap, loadSamples, loadDisposals, loadDevices, subscribeSamples, subscribeDisposals, subscribeDevices]);

  useEffect(() => {
    if (plantError) message.error(`本地数据库异常：${plantError}`);
  }, [plantError, message]);

  const activePlant = plants.find((item) => item.id === activePlantId) ?? null;
  const mismatchCount = stats.filter((item) => item.level === 'mismatch').length;
  const pendingDisposals = disposals.filter((item) => item.state !== 'retested').length;

  return (
    <Layout style={{ minHeight: '100vh', background: '#f2f7f6' }}>
      <Sider width={228} breakpoint="lg" collapsedWidth={0} style={{ background: '#0b2a26' }}>
        <div style={{ padding: '18px 16px 12px' }}>
          <Typography.Title level={5} style={{ color: '#d8f2ec', margin: 0 }}>
            光伏电站组串失配排查台
          </Typography.Title>
          <Typography.Text style={{ color: 'rgba(216,242,236,0.62)', fontSize: 12 }}>
            gbpvstring · 逆变器 / 汇流箱 / 组串三级定位
          </Typography.Text>
          <div
            style={{
              height: 3,
              marginTop: 10,
              borderRadius: 3,
              background: 'linear-gradient(90deg,#0f7b6c,#4fc3a1 60%,#1668dc)',
            }}
          />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKeyOf(location.pathname)]}
          style={{ background: 'transparent' }}
          onClick={({ key }) => navigate(key)}
          items={MENU_ITEMS}
        />
        <div style={{ padding: '14px 16px', color: 'rgba(216,242,236,0.62)', fontSize: 12 }}>
          <Space direction="vertical" size={2}>
            <span>
              <DatabaseOutlined /> 电站 {plants.length} · 逆变器 {inverters.length}
            </span>
            <span>组串 {strings.length} · 失配 {mismatchCount}</span>
            <span>人工标记 {markedStringIds.length} · 待办处置 {pendingDisposals}</span>
          </Space>
        </div>
      </Sider>

      <Layout style={{ background: '#f2f7f6' }}>
        <Header
          style={{
            background: '#ffffff',
            borderBottom: '1px solid rgba(15,123,108,0.16)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingInline: 18,
            flexWrap: 'wrap',
            height: 'auto',
            lineHeight: 'normal',
            paddingBlock: 10,
          }}
        >
          <Space size={10} wrap>
            <Typography.Text strong>当前电站：</Typography.Text>
            <Select
              size="small"
              style={{ minWidth: 220 }}
              loading={plantLoading}
              value={activePlantId ?? undefined}
              placeholder="选择电站"
              options={plants.map((item) => ({ label: item.name, value: item.id }))}
              onChange={(value) => setActivePlant(value)}
            />
            {activePlant ? (
              <>
                <Tag color="#0f7b6c">{activePlant.capacityMWp} MWp</Tag>
                <Tag>并网 {activePlant.gridDate}</Tag>
                <Tag color="cyan">纬度 {activePlant.latitude}°</Tag>
              </>
            ) : (
              <Tag>暂无电站</Tag>
            )}
          </Space>
          <Space wrap>
            <Badge count={mismatchCount} showZero color="#a8071a" title="失配组串数">
              <Tag color="#a8071a">失配组串</Tag>
            </Badge>
            <Badge count={pendingDisposals} showZero color="#d46b08" title="待办处置单">
              <Tag color="#d46b08">待办处置</Tag>
            </Badge>
            <Button size="small" type="primary" onClick={() => navigate(ROUTES.diagnose)}>
              进入排查台
            </Button>
          </Space>
        </Header>

        <Content style={{ padding: 18, minHeight: 320 }}>
          <Outlet />
        </Content>

        <Footer style={{ textAlign: 'center', background: 'transparent', color: 'rgba(0,0,0,0.45)' }}>
          数据仅保存在本机浏览器 IndexedDB（库名 gbpvstring）· 纯前端 SPA，无后端与外部接口
        </Footer>
      </Layout>
    </Layout>
  );
}
