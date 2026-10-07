/**
 * /settings 阈值与版本
 * 配置离散率与电流偏差阈值，查看结构版本并导出 / 导入 JSON；
 * 消费全部模型与 <StatBadge>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  InputNumber,
  Popconfirm,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { usePlantStore } from '../stores/plantStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useSampleStore } from '../stores/sampleStore';
import { useDisposalStore } from '../stores/disposalStore';
import {
  DEFAULT_THRESHOLDS,
  validateThresholds,
  type ThresholdConfig,
} from '../types/settings';
import {
  DB_NAME,
  DB_SCHEMA_VERSION,
  ROW_REVISION,
  countAll,
  exportSnapshot,
  importSnapshot,
  putThresholds,
  resetDatabase,
  schemaInfo,
  type DatabaseSnapshot,
} from '../utils/db';
import { backupFilename, downloadJson, readJsonFile } from '../utils/export';
import { nowIso } from '../utils/format';
import StatBadge from '../components/common/StatBadge';
import { useIdbTable } from '../hooks/useIdbTable';

export default function SettingsView() {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<ThresholdConfig>();
  const [saving, setSaving] = useState(false);

  const thresholds = useSampleStore((state) => state.thresholds);
  const setThresholds = useSampleStore((state) => state.setThresholds);
  const stats = useSampleStore((state) => state.stats);
  const samples = useSampleStore((state) => state.samples);
  const loadSamples = useSampleStore((state) => state.loadSamples);
  const loadPlants = usePlantStore((state) => state.loadPlants);
  const loadDevices = useDeviceStore((state) => state.loadDevices);
  const loadDisposals = useDisposalStore((state) => state.loadDisposals);
  const disposals = useDisposalStore((state) => state.disposals);
  const strings = useDeviceStore((state) => state.strings);
  const inverters = useDeviceStore((state) => state.inverters);
  const plants = usePlantStore((state) => state.plants);
  const arrays = usePlantStore((state) => state.arrays);

  const { data: counts, reload: reloadCounts } = useIdbTable(countAll, []);

  useEffect(() => {
    form.setFieldsValue(thresholds);
  }, [form, thresholds]);

  const overview = useMemo(() => {
    const mismatch = stats.filter((stat) => stat.level === 'mismatch').length;
    const watch = stats.filter((stat) => stat.level === 'watch').length;
    const retested = disposals.filter((item) => item.state === 'retested').length;
    return {
      mismatch,
      watch,
      retested,
      tables: counts ?? {},
    };
  }, [stats, disposals, counts]);

  const save = async (): Promise<void> => {
    const values = await form.validateFields();
    const errors = validateThresholds(values);
    if (errors.length > 0) {
      message.error(errors.join('；'));
      return;
    }
    setSaving(true);
    try {
      await putThresholds({ ...values, id: 'threshold', updatedAt: nowIso() });
      setThresholds(values);
      message.success('阈值已保存，离散率判定与可视化已按新阈值刷新');
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = async (): Promise<void> => {
    form.setFieldsValue(DEFAULT_THRESHOLDS);
    await putThresholds({ ...DEFAULT_THRESHOLDS, id: 'threshold', updatedAt: nowIso() });
    setThresholds(DEFAULT_THRESHOLDS);
    message.success('已恢复默认阈值');
  };

  const handleExport = async (): Promise<void> => {
    const snapshot = await exportSnapshot();
    downloadJson(backupFilename(`gbpvstring-backup-${DB_SCHEMA_VERSION}`), snapshot);
    message.success(`已导出 ${snapshot.plants.length} 个电站等全部数据的 JSON 备份`);
  };

  const handleImport = async (file: File): Promise<void> => {
    try {
      const snapshot = await readJsonFile<DatabaseSnapshot>(file);
      if (!snapshot || !Array.isArray(snapshot.plants)) {
        message.error('文件格式不正确：缺少 plants 数组');
        return;
      }
      modal.confirm({
        title: '导入将覆盖当前全部数据',
        content: `备份导出时间：${snapshot.exportedAt ?? '未知'}，包含 ${snapshot.plants.length} 个电站、${
          snapshot.strings?.length ?? 0
        } 个组串、${snapshot.samples?.length ?? 0} 条采集记录。确认导入？`,
        okText: '确认导入',
        cancelText: '取消',
        onOk: async () => {
          await importSnapshot(snapshot);
          await Promise.all([loadPlants(), loadDevices(), loadSamples(), loadDisposals()]);
          await reloadCounts();
          if (snapshot.thresholds) setThresholds(snapshot.thresholds);
          form.setFieldsValue(snapshot.thresholds ?? DEFAULT_THRESHOLDS);
          message.success('导入完成');
        },
      });
    } catch (error) {
      message.error(`导入失败：${error instanceof Error ? error.message : '文件解析异常'}`);
    }
  };

  const handleReset = async (): Promise<void> => {
    await resetDatabase();
    await Promise.all([loadPlants(), loadDevices(), loadSamples(), loadDisposals()]);
    await reloadCounts();
    form.setFieldsValue(DEFAULT_THRESHOLDS);
    setThresholds(DEFAULT_THRESHOLDS);
    message.success('已清空并重新播种演示数据');
  };

  const info = schemaInfo();

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <Typography.Title level={4} className="gb-page-title">
            阈值与版本
          </Typography.Title>
          <Typography.Text type="secondary">
            配置离散率与电流偏差判定阈值，查看 IndexedDB 结构版本并做整库 JSON 导出 / 导入。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<CloudDownloadOutlined />} onClick={() => void handleExport()}>
            导出 JSON
          </Button>
          <Upload
            accept="application/json"
            showUploadList={false}
            beforeUpload={(file) => {
              void handleImport(file as File);
              return false;
            }}
          >
            <Button icon={<CloudUploadOutlined />}>导入 JSON</Button>
          </Upload>
          <Popconfirm
            title="重置为演示数据？"
            description="当前全部本地数据将被清空并重新播种。"
            okText="重置"
            cancelText="取消"
            onConfirm={() => void handleReset()}
          >
            <Button danger icon={<ReloadOutlined />}>
              重置演示数据
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <div className="gb-stat-grid">
        <StatBadge title="电站 / 方阵" value={`${plants.length} / ${arrays.length}`} color="#0f7b6c" />
        <StatBadge title="逆变器 / 组串" value={`${inverters.length} / ${strings.length}`} color="#1668dc" />
        <StatBadge title="采集记录" value={samples.length} suffix="条" color="#08979c" />
        <StatBadge
          title="失配 / 关注"
          value={`${overview.mismatch} / ${overview.watch}`}
          suffix="串"
          color="#a8071a"
          hint={`按当前阈值（失配 ≥ ${thresholds.discreteAlarmRate}%）统计`}
        />
      </div>

      <Row gutter={14}>
        <Col xs={24} xl={13}>
          <Card size="small" title="判定阈值" styles={{ body: { padding: 14 } }}>
            <Form form={form} layout="vertical" initialValues={thresholds}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item
                    name="discreteWatchRate"
                    label="离散率关注阈值（%）"
                    rules={[{ required: true, message: '请输入关注阈值' }]}
                    extra="离散率 ≥ 该值判为关注"
                  >
                    <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="discreteAlarmRate"
                    label="离散率失配阈值（%）"
                    rules={[{ required: true, message: '请输入失配阈值' }]}
                    extra="必须大于关注阈值"
                  >
                    <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="currentBiasPercent"
                    label="电流偏差可疑阈值（%）"
                    rules={[{ required: true, message: '请输入偏差阈值' }]}
                    extra="相对同汇流箱均值的偏离"
                  >
                    <InputNumber min={0.5} max={100} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="minSampleCount"
                    label="最少采集点数"
                    rules={[{ required: true, message: '请输入最少点数' }]}
                    extra="低于该点数标注「点数不足」"
                  >
                    <InputNumber min={1} max={50} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="standardIrradiance"
                    label="标准辐照度（W/m²）"
                    rules={[{ required: true, message: '请输入标准辐照度' }]}
                    extra="电流归一化基准"
                  >
                    <InputNumber min={100} max={1400} step={50} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Space>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
                  保存阈值
                </Button>
                <Button onClick={() => void restoreDefaults()}>恢复默认</Button>
                <Button
                  onClick={() => {
                    form.setFieldsValue(thresholds);
                    message.info('已回退为当前生效阈值');
                  }}
                >
                  放弃修改
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} xl={11}>
          <Card size="small" title="结构版本与存储" styles={{ body: { padding: 14 } }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="IndexedDB 库名">
                <Tag icon={<DatabaseOutlined />} color="blue">
                  {DB_NAME}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="数据结构版本">v{DB_SCHEMA_VERSION}</Descriptions.Item>
              <Descriptions.Item label="数据行修订号">{ROW_REVISION}</Descriptions.Item>
              <Descriptions.Item label="当前基准日">{info.today}</Descriptions.Item>
              <Descriptions.Item label="已复测处置单">{overview.retested} 单</Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: '14px 0' }} />

            <Table
              size="small"
              pagination={false}
              rowKey="table"
              dataSource={Object.entries(overview.tables).map(([table, count]) => ({ table, count }))}
              columns={[
                {
                  title: '数据表',
                  dataIndex: 'table',
                  render: (value: string) => <span className="gb-mono">{value}</span>,
                },
                { title: '记录数', dataIndex: 'count', width: 110 },
              ]}
            />

            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              说明：所有数据仅保存在当前浏览器 IndexedDB，不落服务端；导出 JSON 可用于换机迁移或评审留档。
              数据结构升级在 <span className="gb-mono">utils/db.ts</span> 的 Dexie version 与 upgrade 中登记。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
