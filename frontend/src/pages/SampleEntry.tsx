/**
 * /samples 采集与离散率
 * 录入组串电流电压，实时计算离散率并标红越限；消费 Sample、String 与 <DiscreteBadge>。
 */
import { useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Form,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSampleStore } from '../stores/sampleStore';
import { useDeviceStore } from '../stores/deviceStore';
import type { SampleDraft, SampleRow as SampleViewRow, StringDiscreteStat } from '../types/sample';
import { normalizeCurrent } from '../utils/discrete';
import { formatCurrent, formatIrradiance, formatPercent, formatVoltage, share } from '../utils/unit';
import DiscreteBadge from '../components/common/DiscreteBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import FilterBar, { useFilterValues, useKeywordFilter } from '../components/common/FilterBar';

interface SampleFormValues {
  stringId: string;
  sampledAt: dayjs.Dayjs;
  currentA: number;
  voltageV: number;
  irradianceWm2: number;
}

interface BatchRow {
  key: string;
  stringId: string;
  label: string;
  currentA: number;
  voltageV: number;
}

export default function SampleEntry() {
  const { message } = AntdApp.useApp();
  const samples = useSampleStore((state) => state.samples);
  const stats = useSampleStore((state) => state.stats);
  const thresholds = useSampleStore((state) => state.thresholds);
  const sampleRows = useSampleStore((state) => state.sampleRows);
  const addSample = useSampleStore((state) => state.addSample);
  const addBatchSamples = useSampleStore((state) => state.addBatchSamples);
  const updateSample = useSampleStore((state) => state.updateSample);
  const deleteSample = useSampleStore((state) => state.deleteSample);
  const toggleMark = useSampleStore((state) => state.toggleMark);
  const markedStringIds = useSampleStore((state) => state.markedStringIds);

  const strings = useDeviceStore((state) => state.strings);
  const inverters = useDeviceStore((state) => state.inverters);
  const arrays = useDeviceStore((state) => state.arrays);
  const plants = useDeviceStore((state) => state.plants);

  const keyword = useKeywordFilter();
  const filters = useFilterValues(['plant', 'inverter', 'level']);
  const [form] = Form.useForm<SampleFormValues>();
  const [modal, setModal] = useState<{ open: boolean; editing: SampleViewRow | null }>({
    open: false,
    editing: null,
  });
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBox, setBatchBox] = useState<string>('');
  const [batchInverter, setBatchInverter] = useState<string>('');
  const [batchTime, setBatchTime] = useState<dayjs.Dayjs>(dayjs());
  const [batchIrradiance, setBatchIrradiance] = useState<number>(900);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [onlySuspicious, setOnlySuspicious] = useState(false);

  const rows = sampleRows();
  const plantFilter = filters.plant ?? [];
  const inverterFilter = filters.inverter ?? [];
  const levelFilter = filters.level ?? [];

  const statOfString = useMemo(() => {
    const map = new Map<string, StringDiscreteStat>();
    for (const stat of stats) map.set(stat.stringId, stat);
    return map;
  }, [stats]);

  const filtered = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (plantFilter.length > 0 && !plantFilter.includes(row.plantId)) return false;
      if (inverterFilter.length > 0 && !inverterFilter.includes(row.inverterId)) return false;
      const level = statOfString.get(row.stringId)?.level ?? 'normal';
      if (levelFilter.length > 0 && !levelFilter.includes(level)) return false;
      if (onlySuspicious && level === 'normal') return false;
      if (lower) {
        const haystack = [row.stringCode, row.combinerBox, row.inverterModel, row.arrayCode, row.plantName]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(lower)) return false;
      }
      return true;
    });
  }, [rows, keyword, plantFilter, inverterFilter, levelFilter, onlySuspicious, statOfString]);

  const totals = useMemo(() => {
    const mismatch = stats.filter((stat) => stat.level === 'mismatch').length;
    const watch = stats.filter((stat) => stat.level === 'watch').length;
    const avgRate =
      stats.length === 0
        ? 0
        : Number((stats.reduce((sum, stat) => sum + stat.discreteRate, 0) / stats.length).toFixed(2));
    return {
      samples: samples.length,
      strings: stats.length,
      mismatch,
      watch,
      avgRate,
      mismatchShare: share(mismatch, stats.length),
    };
  }, [stats, samples.length]);

  /** 汇流箱候选（用于批量录入） */
  const boxOptions = useMemo(() => {
    const scope = batchInverter ? strings.filter((item) => item.inverterId === batchInverter) : strings;
    return [...new Set(scope.map((item) => item.combinerBox))].sort();
  }, [strings, batchInverter]);

  const openModal = (editing: SampleViewRow | null): void => {
    setModal({ open: true, editing });
    if (editing) {
      form.setFieldsValue({
        stringId: editing.stringId,
        sampledAt: dayjs(editing.sampledAt),
        currentA: editing.currentA,
        voltageV: editing.voltageV,
        irradianceWm2: editing.irradianceWm2,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        stringId: strings[0]?.id,
        sampledAt: dayjs(),
        currentA: 9,
        voltageV: 1080,
        irradianceWm2: 900,
      });
    }
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const draft: SampleDraft = {
      stringId: values.stringId,
      sampledAt: values.sampledAt.format('YYYY-MM-DD HH:mm'),
      currentA: values.currentA,
      voltageV: values.voltageV,
      irradianceWm2: values.irradianceWm2,
    };
    if (modal.editing) {
      await updateSample(modal.editing.id, draft);
      message.success('采集记录已更新，离散率已重算');
    } else {
      await addSample(draft);
      const rate = statOfString.get(draft.stringId)?.discreteRate ?? 0;
      message.success(
        rate >= thresholds.discreteAlarmRate
          ? `已录入：该汇流箱离散率 ${rate}%，已达失配阈值，建议建处置单`
          : '采集记录已录入',
      );
    }
    setModal({ open: false, editing: null });
  };

  /** 依据汇流箱生成批量录入行 */
  const buildBatchRows = (): void => {
    if (!batchBox) {
      message.warning('请先选择汇流箱');
      return;
    }
    const scope = strings
      .filter((item) => item.combinerBox === batchBox && (!batchInverter || item.inverterId === batchInverter))
      .sort((a, b) => a.code.localeCompare(b.code));
    if (scope.length === 0) {
      message.warning('该汇流箱下没有组串');
      return;
    }
    setBatchRows(
      scope.map((item) => ({
        key: item.id,
        stringId: item.id,
        label: `${item.combinerBox} / ${item.code}`,
        currentA: 9,
        voltageV: Number((item.seriesCount * 41.6).toFixed(1)),
      })),
    );
  };

  const submitBatch = async (): Promise<void> => {
    if (batchRows.length === 0) {
      message.warning('请先生成待录入清单');
      return;
    }
    const drafts: SampleDraft[] = batchRows.map((row) => ({
      stringId: row.stringId,
      sampledAt: batchTime.format('YYYY-MM-DD HH:mm'),
      currentA: row.currentA,
      voltageV: row.voltageV,
      irradianceWm2: batchIrradiance,
    }));
    const created = await addBatchSamples(drafts);
    message.success(`已批量录入 ${created} 条采集记录并重算离散率`);
    setBatchRows([]);
    setBatchOpen(false);
  };

  /** 离散率榜（Top 8） */
  const rankList = useMemo(
    () => [...stats].sort((a, b) => b.discreteRate - a.discreteRate).slice(0, 8),
    [stats],
  );

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <Typography.Title level={4} className="gb-page-title">
            采集与离散率
          </Typography.Title>
          <Typography.Text type="secondary">
            按汇流箱录入组串电流电压，系统即时计算离散率并按阈值标红；辐照度不同自动做归一化修正。
          </Typography.Text>
        </div>
        <Space wrap>
          <Space size={6}>
            <Typography.Text type="secondary">只看可疑</Typography.Text>
            <Switch checked={onlySuspicious} onChange={setOnlySuspicious} size="small" />
          </Space>
          <Button icon={<ThunderboltOutlined />} onClick={() => setBatchOpen(true)}>
            按汇流箱批量录入
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>
            单点录入
          </Button>
        </Space>
      </div>

      <div className="gb-stat-grid">
        <StatBadge title="采集记录" value={totals.samples} suffix="条" color="#1668dc" />
        <StatBadge title="已采集组串" value={totals.strings} suffix="串" color="#0f7b6c" />
        <StatBadge
          title="平均离散率"
          value={totals.avgRate}
          suffix="%"
          color={totals.avgRate >= thresholds.discreteWatchRate ? '#d46b08' : '#237804'}
          hint={`关注 ≥ ${thresholds.discreteWatchRate}%，失配 ≥ ${thresholds.discreteAlarmRate}%`}
        />
        <StatBadge
          title="失配组串"
          value={totals.mismatch}
          suffix={`/ ${totals.strings}`}
          percent={totals.mismatchShare}
          color="#a8071a"
          hint={`关注档 ${totals.watch} 串`}
        />
      </div>

      <FilterBar
        keywordPlaceholder="按组串 / 汇流箱 / 逆变器搜索"
        selects={[
          {
            key: 'plant',
            label: '电站',
            options: plants.map((item) => ({ label: item.name, value: item.id })),
            width: 200,
          },
          {
            key: 'inverter',
            label: '逆变器',
            options: inverters.map((item) => {
              const array = arrays.find((row) => row.id === item.arrayId);
              return { label: `${array?.code ?? '-'} / ${item.model}`, value: item.id };
            }),
            width: 200,
          },
          {
            key: 'level',
            label: '离散档位',
            options: [
              { label: '正常', value: 'normal' },
              { label: '关注', value: 'watch' },
              { label: '失配', value: 'mismatch' },
            ],
            width: 180,
          },
        ]}
        resultCount={filtered.length}
        countUnit="条采集"
      />

      <Row gutter={14} style={{ marginTop: 14 }}>
        <Col xs={24} xl={16}>
          <Card size="small" title="采集记录" styles={{ body: { padding: 12 } }}>
            {filtered.length === 0 ? (
              <EmptyPanel
                title="暂无采集记录"
                description="可单点录入，也可按汇流箱批量录入整箱组串数据。"
                createLabel="单点录入"
                onCreate={() => openModal(null)}
                extra={
                  <Button icon={<ThunderboltOutlined />} onClick={() => setBatchOpen(true)}>
                    批量录入
                  </Button>
                }
              />
            ) : (
              <Table
                rowKey="id"
                size="small"
                dataSource={filtered}
                pagination={{ pageSize: 10, size: 'small' }}
                scroll={{ x: 1180 }}
                columns={[
                  { title: '采集时间', dataIndex: 'sampledAt', width: 140 },
                  {
                    title: '电站 / 方阵',
                    width: 190,
                    ellipsis: true,
                    render: (_, row) => `${row.plantName} / ${row.arrayCode}`,
                  },
                  { title: '组串', width: 140, render: (_, row) => `${row.combinerBox} · ${row.stringCode}` },
                  {
                    title: '电流',
                    dataIndex: 'currentA',
                    width: 100,
                    render: (value: number) => formatCurrent(value),
                  },
                  {
                    title: '辐照度',
                    dataIndex: 'irradianceWm2',
                    width: 110,
                    render: (value: number) => formatIrradiance(value),
                  },
                  {
                    title: '归一化电流',
                    dataIndex: 'normalizedCurrentA',
                    width: 120,
                    render: (value: number) => formatCurrent(value),
                  },
                  {
                    title: '电压',
                    dataIndex: 'voltageV',
                    width: 100,
                    render: (value: number) => formatVoltage(value),
                  },
                  {
                    title: '离散率',
                    width: 160,
                    render: (_, row) => {
                      const stat = statOfString.get(row.stringId);
                      return (
                        <DiscreteBadge
                          rate={stat?.discreteRate ?? row.discreteRate}
                          thresholds={thresholds}
                          biasPercent={stat?.currentBiasPercent}
                          sampleCount={stat?.sampleCount}
                          size="small"
                        />
                      );
                    },
                  },
                  {
                    title: '标记',
                    width: 90,
                    render: (_, row) => (
                      <Button
                        size="small"
                        type={markedStringIds.includes(row.stringId) ? 'primary' : 'default'}
                        onClick={() => toggleMark(row.stringId)}
                      >
                        {markedStringIds.includes(row.stringId) ? '已标记' : '标记'}
                      </Button>
                    ),
                  },
                  {
                    title: '操作',
                    width: 130,
                    fixed: 'right',
                    render: (_, row) => (
                      <Space size={2}>
                        <Button
                          size="small"
                          type="link"
                          icon={<EditOutlined />}
                          onClick={() => openModal(row)}
                        />
                        <Popconfirm
                          title="删除该条采集记录？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={async () => {
                            await deleteSample(row.id);
                            message.success('采集记录已删除');
                          }}
                        >
                          <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card size="small" title="离散率榜（Top 8）" styles={{ body: { padding: 12 } }}>
            {rankList.length === 0 ? (
              <EmptyPanel title="暂无离散率数据" description="录入采集记录后自动计算。" />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {rankList.map((stat, index) => (
                  <div
                    key={stat.stringId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      borderBottom: '1px dashed rgba(0,0,0,0.08)',
                      paddingBottom: 6,
                    }}
                  >
                    <Space size={8}>
                      <Tag color={index === 0 ? 'red' : index < 3 ? 'orange' : 'default'}>#{index + 1}</Tag>
                      <span>
                        {stat.combinerBox} · {stat.stringCode}
                      </span>
                    </Space>
                    <Space size={6}>
                      <span className="gb-hint">{formatCurrent(stat.avgCurrentA)}</span>
                      <DiscreteBadge rate={stat.discreteRate} thresholds={thresholds} size="small" />
                    </Space>
                  </div>
                ))}
              </Space>
            )}
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              归一化基准辐照度 {thresholds.standardIrradiance} W/m²；电流偏差 ≥{' '}
              {thresholds.currentBiasPercent}% 判可疑；最少采集点数 {thresholds.minSampleCount}。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>

      {/* 单点录入/编辑 */}
      <Drawer
        title={modal.editing ? '编辑采集记录' : '单点录入采集'}
        width={420}
        open={modal.open}
        onClose={() => setModal({ open: false, editing: null })}
        extra={
          <Space>
            <Button onClick={() => setModal({ open: false, editing: null })}>取消</Button>
            <Button type="primary" onClick={() => void submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="stringId" label="组串" rules={[{ required: true, message: '请选择组串' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={strings.map((item) => {
                const inverter = inverters.find((row) => row.id === item.inverterId);
                return {
                  label: `${item.combinerBox} / ${item.code}（${inverter?.model ?? '-'}）`,
                  value: item.id,
                };
              })}
            />
          </Form.Item>
          <Form.Item name="sampledAt" label="采集时间" rules={[{ required: true, message: '请选择采集时间' }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currentA" label="电流（A）" rules={[{ required: true, message: '请输入电流' }]}>
            <InputNumber min={0} max={20} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="voltageV" label="电压（V）" rules={[{ required: true, message: '请输入电压' }]}>
            <InputNumber min={0} max={2000} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="irradianceWm2" label="辐照度（W/m²）" rules={[{ required: true, message: '请输入辐照度' }]}>
            <InputNumber min={0} max={1400} step={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const current = Number(form.getFieldValue('currentA') ?? 0);
              const irradiance = Number(form.getFieldValue('irradianceWm2') ?? 0);
              return (
                <Typography.Paragraph type="secondary">
                  归一化电流预览：{formatCurrent(normalizeCurrent(current, irradiance, thresholds))}
                </Typography.Paragraph>
              );
            }}
          </Form.Item>
        </Form>
      </Drawer>

      {/* 批量录入 */}
      <Drawer
        title="按汇流箱批量录入"
        width={720}
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setBatchOpen(false)}>取消</Button>
            <Button type="primary" disabled={batchRows.length === 0} onClick={() => void submitBatch()}>
              提交 {batchRows.length} 条
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            placeholder="选择逆变器"
            style={{ width: 220 }}
            allowClear
            value={batchInverter || undefined}
            onChange={(value) => {
              setBatchInverter(value ?? '');
              setBatchBox('');
              setBatchRows([]);
            }}
            options={inverters.map((item) => ({ label: item.model, value: item.id }))}
          />
          <Select
            placeholder="选择汇流箱"
            style={{ width: 160 }}
            value={batchBox || undefined}
            onChange={(value) => setBatchBox(value)}
            options={boxOptions.map((code) => ({ label: code, value: code }))}
          />
          <DatePicker
            showTime
            format="YYYY-MM-DD HH:mm"
            value={batchTime}
            onChange={(value) => setBatchTime(value ?? dayjs())}
          />
          <InputNumber
            min={0}
            max={1400}
            step={10}
            value={batchIrradiance}
            onChange={(value) => setBatchIrradiance(Number(value ?? 0))}
            addonAfter="W/m²"
          />
          <Button onClick={buildBatchRows}>生成清单</Button>
        </Space>

        {batchRows.length === 0 ? (
          <EmptyPanel
            title="尚未生成录入清单"
            description="选择汇流箱后点击「生成清单」，可逐串微调电流与电压。"
          />
        ) : (
          <Table<BatchRow>
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={batchRows}
            columns={[
              { title: '组串', dataIndex: 'label', width: 180 },
              {
                title: '电流（A）',
                width: 150,
                render: (_, row) => (
                  <InputNumber
                    min={0}
                    max={20}
                    step={0.01}
                    value={row.currentA}
                    onChange={(value) =>
                      setBatchRows((prev) =>
                        prev.map((item) =>
                          item.key === row.key ? { ...item, currentA: Number(value ?? 0) } : item,
                        ),
                      )
                    }
                    style={{ width: '100%' }}
                  />
                ),
              },
              {
                title: '电压（V）',
                width: 150,
                render: (_, row) => (
                  <InputNumber
                    min={0}
                    max={2000}
                    step={0.1}
                    value={row.voltageV}
                    onChange={(value) =>
                      setBatchRows((prev) =>
                        prev.map((item) =>
                          item.key === row.key ? { ...item, voltageV: Number(value ?? 0) } : item,
                        ),
                      )
                    }
                    style={{ width: '100%' }}
                  />
                ),
              },
              {
                title: '归一化电流',
                width: 120,
                render: (_, row) => formatCurrent(normalizeCurrent(row.currentA, batchIrradiance, thresholds)),
              },
            ]}
          />
        )}

        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          提示：批量录入后系统按汇流箱分组重算离散率，离散率 = 组串归一化电流标准差 / 均值 × 100%。当前可疑偏差阈值{' '}
          {formatPercent(thresholds.currentBiasPercent, 0)}。
        </Typography.Paragraph>
      </Drawer>
    </div>
  );
}
