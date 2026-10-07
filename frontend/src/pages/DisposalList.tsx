/**
 * /disposals 处置单
 * 清洗 / 更换 / 复测三类单子的派工与复测回填，复测结果自动判定消缺；
 * 消费 Disposal、String 与 <StatBadge>、<EmptyPanel>。
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
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDisposalStore } from '../stores/disposalStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useSampleStore } from '../stores/sampleStore';
import {
  DISPOSAL_STATE_LABEL,
  DISPOSAL_TYPE_LABEL,
  isCleared,
  isOverdue,
  type DisposalDraft,
  type DisposalState,
  type DisposalType,
} from '../types/disposal';
import type { DisposalRow as DisposalViewRow } from '../types/disposal';
import { shiftDate } from '../utils/format';
import { formatCurrent, share } from '../utils/unit';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import DiscreteBadge from '../components/common/DiscreteBadge';

const STATE_COLOR: Record<DisposalState, string> = {
  pending: 'default',
  assigned: 'processing',
  retested: 'success',
};

export default function DisposalList() {
  const { message } = AntdApp.useApp();
  const disposals = useDisposalStore((state) => state.disposals);
  const rate = useDisposalStore((state) => state.rate);
  const baselines = useDisposalStore((state) => state.baselines);
  const createDisposal = useDisposalStore((state) => state.createDisposal);
  const assignDisposal = useDisposalStore((state) => state.assignDisposal);
  const submitRetest = useDisposalStore((state) => state.submitRetest);
  const deleteDisposal = useDisposalStore((state) => state.deleteDisposal);
  const nextStates = useDisposalStore((state) => state.nextStates);

  const strings = useDeviceStore((state) => state.strings);
  const inverters = useDeviceStore((state) => state.inverters);
  const arrays = useDeviceStore((state) => state.arrays);
  const plants = useDeviceStore((state) => state.plants);
  const stats = useSampleStore((state) => state.stats);
  const thresholds = useSampleStore((state) => state.thresholds);

  /** 处置单视图行：拼接组串上下文并判定消缺 / 逾期（派生自 store 明细，保持响应式） */
  const rows: DisposalViewRow[] = useMemo(
    () =>
      disposals.map((disposal) => {
        const string = strings.find((item) => item.id === disposal.stringId);
        const inverter = string ? inverters.find((item) => item.id === string.inverterId) : undefined;
        const array = inverter ? arrays.find((item) => item.id === inverter.arrayId) : undefined;
        const plant = array ? plants.find((item) => item.id === array.plantId) : undefined;
        const baseline = string ? (baselines[`${string.inverterId}::${string.combinerBox}`] ?? 9.4) : 9.4;
        return {
          ...disposal,
          stringCode: string?.code ?? '已删除组串',
          combinerBox: string?.combinerBox ?? '-',
          inverterId: inverter?.id ?? '',
          arrayId: array?.id ?? '',
          plantId: plant?.id ?? '',
          plantName: plant?.name ?? '未归属电站',
          cleared: isCleared(disposal.retestCurrentA, baseline),
          overdue: isOverdue(disposal),
        };
      }),
    [disposals, strings, inverters, arrays, plants, baselines],
  );

  const [form] = Form.useForm<Omit<DisposalDraft, 'dueDate'> & { dueDate: dayjs.Dayjs }>();
  const [retestForm] = Form.useForm<{ retestCurrentA: number }>();
  const [assignForm] = Form.useForm<{ owner: string; dueDate: dayjs.Dayjs }>();
  const [createOpen, setCreateOpen] = useState(false);
  const [retestTarget, setRetestTarget] = useState<DisposalViewRow | null>(null);
  const [assignTarget, setAssignTarget] = useState<DisposalViewRow | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | DisposalType>('all');
  const [stateFilter, setStateFilter] = useState<'all' | DisposalState>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (typeFilter !== 'all' && row.type !== typeFilter) return false;
        if (stateFilter !== 'all' && row.state !== stateFilter) return false;
        if (overdueOnly && !row.overdue) return false;
        return true;
      }),
    [rows, typeFilter, stateFilter, overdueOnly],
  );

  const totals = useMemo(() => {
    const pending = disposals.filter((item) => item.state === 'pending').length;
    const assigned = disposals.filter((item) => item.state === 'assigned').length;
    const retested = disposals.filter((item) => item.state === 'retested').length;
    const cleared = rows.filter((row) => row.cleared === true).length;
    const overdue = rows.filter((row) => row.overdue).length;
    return {
      total: disposals.length,
      pending,
      assigned,
      retested,
      cleared,
      overdue,
      clearRate: share(cleared, retested),
    };
  }, [disposals, rows]);

  const stringOptions = useMemo(
    () =>
      strings.map((item) => {
        const inverter = inverters.find((row) => row.id === item.inverterId);
        const stat = stats.find((row) => row.stringId === item.id);
        return {
          label: `${item.combinerBox} / ${item.code}（${inverter?.model ?? '-'}）离散率 ${
            stat?.discreteRate?.toFixed(2) ?? '0.00'
          }%`,
          value: item.id,
          rate: stat?.discreteRate ?? 0,
        };
      }),
    [strings, inverters, stats],
  );

  const openCreate = (): void => {
    setCreateOpen(true);
    form.resetFields();
    form.setFieldsValue({
      stringId: stringOptions[0]?.value,
      type: 'clean',
      owner: '李文波',
      dueDate: dayjs(shiftDate(3)),
      initialDiscreteRate: stringOptions[0]?.rate ?? 0,
    });
  };

  const submitCreate = async (): Promise<void> => {
    const values = await form.validateFields();
    await createDisposal({
      stringId: values.stringId,
      type: values.type,
      owner: values.owner,
      dueDate: values.dueDate.format('YYYY-MM-DD'),
      initialDiscreteRate: values.initialDiscreteRate,
    });
    message.success('处置单已创建（状态：待处理）');
    setCreateOpen(false);
  };

  const submitAssign = async (): Promise<void> => {
    if (!assignTarget) return;
    const values = await assignForm.validateFields();
    await assignDisposal(assignTarget.id, values.owner, values.dueDate.format('YYYY-MM-DD'));
    message.success('已派工');
    setAssignTarget(null);
    assignForm.resetFields();
  };

  const submitRetestForm = async (): Promise<void> => {
    if (!retestTarget) return;
    const values = await retestForm.validateFields();
    const cleared = await submitRetest(retestTarget.id, values.retestCurrentA);
    const string = strings.find((item) => item.id === retestTarget.stringId);
    const baseline = string ? (baselines[`${string.inverterId}::${string.combinerBox}`] ?? 9.4) : 9.4;
    if (cleared) {
      message.success(`复测通过，已消缺（基准电流 ${baseline.toFixed(2)} A，达 95% 以上）`);
    } else {
      message.warning(`复测未达基准电流 ${baseline.toFixed(2)} A 的 95%，建议二次处置`);
    }
    setRetestTarget(null);
    retestForm.resetFields();
  };

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <Typography.Title level={4} className="gb-page-title">
            处置单
          </Typography.Title>
          <Typography.Text type="secondary">
            清洗 / 更换 / 复测三类单子，从待处理到已派工再到复测回填，复测达基准 95% 自动判定消缺。
          </Typography.Text>
        </div>
        <Space wrap>
          <Segmented
            size="small"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as 'all' | DisposalType)}
            options={[
              { label: '全部类型', value: 'all' },
              { label: '清洗', value: 'clean' },
              { label: '更换', value: 'replace' },
              { label: '复测', value: 'retest' },
            ]}
          />
          <Segmented
            size="small"
            value={stateFilter}
            onChange={(value) => setStateFilter(value as 'all' | DisposalState)}
            options={[
              { label: '全部状态', value: 'all' },
              { label: '待处理', value: 'pending' },
              { label: '已派工', value: 'assigned' },
              { label: '已复测', value: 'retested' },
            ]}
          />
          <Button
            size="small"
            danger={overdueOnly}
            type={overdueOnly ? 'primary' : 'default'}
            icon={<ExclamationCircleOutlined />}
            onClick={() => setOverdueOnly((prev) => !prev)}
          >
            仅看逾期（{totals.overdue}）
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建处置单
          </Button>
        </Space>
      </div>

      <div className="gb-stat-grid">
        <StatBadge title="处置单总数" value={totals.total} suffix="单" color="#0f7b6c" />
        <StatBadge title="待处理 / 已派工" value={`${totals.pending} / ${totals.assigned}`} color="#d46b08" />
        <StatBadge
          title="处置完成率"
          value={rate()}
          suffix="%"
          percent={rate()}
          color="#237804"
          hint="已复测单 / 全部单"
        />
        <StatBadge
          title="复测消缺率"
          value={totals.cleared}
          suffix={`/ ${totals.retested}`}
          percent={totals.clearRate}
          color="#1668dc"
          hint="复测电流达到同汇流箱基准 95%"
        />
      </div>

      <Card size="small" styles={{ body: { padding: 12 } }}>
        {filtered.length === 0 ? (
          <EmptyPanel
            title="没有匹配的处置单"
            description="可新建处置单，或在失配排查工作台批量派单。"
            createLabel="新建处置单"
            onCreate={openCreate}
          />
        ) : (
          <Table<DisposalViewRow>
            rowKey="id"
            size="small"
            dataSource={filtered}
            pagination={{ pageSize: 10, size: 'small' }}
            scroll={{ x: 1180 }}
            columns={[
              {
                title: '类型',
                dataIndex: 'type',
                width: 90,
                render: (value: DisposalType) => (
                  <Tag color={value === 'replace' ? 'volcano' : value === 'retest' ? 'blue' : 'cyan'}>
                    {DISPOSAL_TYPE_LABEL[value]}
                  </Tag>
                ),
              },
              {
                title: '状态',
                dataIndex: 'state',
                width: 110,
                render: (value: DisposalState, row) => (
                  <Space size={4}>
                    <Tag color={STATE_COLOR[value]}>{DISPOSAL_STATE_LABEL[value]}</Tag>
                    {row.overdue ? <Tag color="red">逾期</Tag> : null}
                  </Space>
                ),
              },
              {
                title: '组串',
                width: 200,
                render: (_, row) => (
                  <Space size={6}>
                    <span>
                      {row.plantName} · {row.combinerBox} / {row.stringCode}
                    </span>
                  </Space>
                ),
              },
              {
                title: '派单离散率',
                dataIndex: 'initialDiscreteRate',
                width: 130,
                render: (value: number) => (
                  <DiscreteBadge rate={value} thresholds={thresholds} size="small" />
                ),
              },
              { title: '责任人', dataIndex: 'owner', width: 100 },
              { title: '要求完成', dataIndex: 'dueDate', width: 120 },
              {
                title: '复测电流',
                dataIndex: 'retestCurrentA',
                width: 150,
                render: (value: number | null, row) =>
                  value === null ? (
                    <span className="gb-hint">未复测</span>
                  ) : (
                    <Space size={4}>
                      <span>{formatCurrent(value)}</span>
                      {row.cleared === true ? (
                        <Tag color="success" icon={<CheckCircleOutlined />}>
                          消缺
                        </Tag>
                      ) : (
                        <Tag color="warning">未达基准</Tag>
                      )}
                    </Space>
                  ),
              },
              {
                title: '操作',
                width: 230,
                fixed: 'right',
                render: (_, row) => (
                  <Space size={2}>
                    {nextStates(row.state).includes('assigned') ? (
                      <Button
                        size="small"
                        type="link"
                        icon={<SendOutlined />}
                        onClick={() => {
                          setAssignTarget(row);
                          assignForm.setFieldsValue({ owner: row.owner, dueDate: dayjs(row.dueDate) });
                        }}
                      >
                        派工
                      </Button>
                    ) : null}
                    {nextStates(row.state).includes('retested') ? (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => {
                          setRetestTarget(row);
                          const string = strings.find((item) => item.id === row.stringId);
                          const baseline = string
                            ? (baselines[`${string.inverterId}::${string.combinerBox}`] ?? 9.4)
                            : 9.4;
                          retestForm.setFieldsValue({ retestCurrentA: Number(baseline.toFixed(2)) });
                        }}
                      >
                        复测回填
                      </Button>
                    ) : null}
                    {row.state === 'retested' ? (
                      <Button
                        size="small"
                        type="link"
                        onClick={() =>
                          message.info(
                            row.cleared
                              ? '该单已复测且判定消缺，可归档'
                              : '该单复测未达基准，建议新建更换单二次处置',
                          )
                        }
                      >
                        结论
                      </Button>
                    ) : null}
                    <Popconfirm
                      title="删除该处置单？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={async () => {
                        await deleteDisposal(row.id);
                        message.success('处置单已删除');
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

      <Row gutter={14} style={{ marginTop: 14 }}>
        <Col span={24}>
          <Card size="small" title="按责任人统计（未闭环工作量）" styles={{ body: { padding: 12 } }}>
            {disposals.length === 0 ? (
              <EmptyPanel title="暂无处置单" description="从排查台或本页新建处置单。" />
            ) : (
              <Space wrap size={[10, 10]}>
                {[...new Set(disposals.map((item) => item.owner))].map((owner) => {
                  const owned = disposals.filter((item) => item.owner === owner);
                  const open = owned.filter((item) => item.state !== 'retested').length;
                  return (
                    <Card key={owner} size="small" style={{ minWidth: 190 }}>
                      <StatBadge
                        title={owner}
                        value={open}
                        suffix={`/ ${owned.length} 单`}
                        percent={share(owned.length - open, owned.length)}
                        color={open > 0 ? '#d46b08' : '#237804'}
                        hint="未闭环 / 名下总单，进度条为闭环比例"
                      />
                    </Card>
                  );
                })}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {/* 新建处置单 */}
      <Drawer
        title="新建处置单"
        width={420}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button type="primary" onClick={() => void submitCreate()}>
              创建
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="stringId" label="关联组串" rules={[{ required: true, message: '请选择组串' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={stringOptions}
              onChange={(value) => {
                const hit = stringOptions.find((item) => item.value === value);
                form.setFieldValue('initialDiscreteRate', hit?.rate ?? 0);
              }}
            />
          </Form.Item>
          <Form.Item name="type" label="处置类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select
              options={[
                { label: '清洗', value: 'clean' },
                { label: '更换', value: 'replace' },
                { label: '复测', value: 'retest' },
              ]}
            />
          </Form.Item>
          <Form.Item name="owner" label="责任人" rules={[{ required: true, message: '请输入责任人' }]}>
            <Input placeholder="如：李文波" />
          </Form.Item>
          <Form.Item name="dueDate" label="要求完成日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="initialDiscreteRate" label="派单离散率（%）">
            <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 派工 */}
      <Drawer
        title="派工"
        width={380}
        open={Boolean(assignTarget)}
        onClose={() => setAssignTarget(null)}
        extra={
          <Space>
            <Button onClick={() => setAssignTarget(null)}>取消</Button>
            <Button type="primary" onClick={() => void submitAssign()}>
              确认派工
            </Button>
          </Space>
        }
      >
        {assignTarget ? (
          <Form form={assignForm} layout="vertical">
            <Typography.Paragraph type="secondary">
              {DISPOSAL_TYPE_LABEL[assignTarget.type]} · 组串{' '}
              {strings.find((item) => item.id === assignTarget.stringId)?.code ?? '-'}
            </Typography.Paragraph>
            <Form.Item name="owner" label="责任人" rules={[{ required: true, message: '请输入责任人' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="dueDate" label="要求完成日期" rules={[{ required: true, message: '请选择日期' }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        ) : null}
      </Drawer>

      {/* 复测回填 */}
      <Drawer
        title="复测回填"
        width={380}
        open={Boolean(retestTarget)}
        onClose={() => setRetestTarget(null)}
        extra={
          <Space>
            <Button onClick={() => setRetestTarget(null)}>取消</Button>
            <Button type="primary" onClick={() => void submitRetestForm()}>
              提交复测
            </Button>
          </Space>
        }
      >
        {retestTarget ? (
          <Form form={retestForm} layout="vertical">
            <Typography.Paragraph type="secondary">
              基准电流 = 同汇流箱典型工作电流，复测值达到基准 95% 即判定消缺。
            </Typography.Paragraph>
            <Form.Item
              name="retestCurrentA"
              label="复测电流（A）"
              rules={[{ required: true, message: '请输入复测电流' }]}
            >
              <InputNumber min={0} max={20} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        ) : null}
      </Drawer>
    </div>
  );
}
