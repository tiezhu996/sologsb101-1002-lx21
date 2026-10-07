/**
 * 电站限功率时段管理（/plants 电站页内抽屉）
 * 登记每台逆变器（或全厂统一）的限功率时段与限值，统计按实际限值折算：
 * - 跨日：开始 / 结束填完整日期时间即可；
 * - 重叠：同一时刻命中多条时段时自动取最严限值；
 * - 不填结束时间：统计时算到当前批次末尾（本电站现有读数的最晚采集时间）。
 */
import { useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCurtailStore } from '../../stores/curtailStore';
import type { CurtailmentRow } from '../../utils/db';
import type { Inverter } from '../../types/inverter';
import type { Plant } from '../../types/plant';
import {
  OPEN_ENDED_END_LABEL,
  PLANT_WIDE_INVERTER_ID,
  formatLimitRatio,
  validateCurtailment,
  type CurtailmentDraft,
} from '../../types/curtailment';

interface CurtailmentFormValues {
  inverterId: string;
  startAt: dayjs.Dayjs;
  endAt: dayjs.Dayjs | null;
  limitPercent: number;
  limitKw: number | null;
  note: string;
}

interface Props {
  open: boolean;
  plant: Plant | null;
  inverters: Inverter[];
  /** 本电站当前批次末尾（最晚采集时间），仅用于提示未填结束时间的收口点 */
  batchEnd: string;
  onClose: () => void;
}

export default function CurtailmentDrawer({ open, plant, inverters, batchEnd, onClose }: Props) {
  const { message } = AntdApp.useApp();
  const curtailments = useCurtailStore((state) => state.curtailments);
  const createCurtailment = useCurtailStore((state) => state.createCurtailment);
  const updateCurtailment = useCurtailStore((state) => state.updateCurtailment);
  const deleteCurtailment = useCurtailStore((state) => state.deleteCurtailment);

  const [form] = Form.useForm<CurtailmentFormValues>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const inverterName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of inverters) map.set(item.id, item.model);
    return (id: string): string => (id === PLANT_WIDE_INVERTER_ID ? '全厂统一' : (map.get(id) ?? '已删除逆变器'));
  }, [inverters]);

  const rows = useMemo(
    () => (plant ? curtailments.filter((item) => item.plantId === plant.id) : []),
    [curtailments, plant],
  );

  const scopeOptions = useMemo(
    () => [
      { label: '全厂统一（全部逆变器）', value: PLANT_WIDE_INVERTER_ID },
      ...inverters.map((item) => ({ label: item.model, value: item.id })),
    ],
    [inverters],
  );

  const openCreate = (): void => {
    setEditingId(null);
    setFormOpen(true);
    form.resetFields();
    form.setFieldsValue({
      inverterId: PLANT_WIDE_INVERTER_ID,
      startAt: dayjs(),
      endAt: null,
      limitPercent: 80,
      limitKw: null,
      note: '',
    });
  };

  const openEdit = (row: CurtailmentRow): void => {
    setEditingId(row.id);
    setFormOpen(true);
    form.setFieldsValue({
      inverterId: row.inverterId,
      startAt: dayjs(row.startAt),
      endAt: row.endAt ? dayjs(row.endAt) : null,
      limitPercent: Number((row.limitRatio * 100).toFixed(1)),
      limitKw: row.limitKw,
      note: row.note,
    });
  };

  const cancelForm = (): void => {
    setFormOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const submit = async (): Promise<void> => {
    if (!plant) return;
    const values = await form.validateFields();
    const draft: CurtailmentDraft = {
      plantId: plant.id,
      inverterId: values.inverterId ?? PLANT_WIDE_INVERTER_ID,
      startAt: values.startAt.format('YYYY-MM-DD HH:mm'),
      endAt: values.endAt ? values.endAt.format('YYYY-MM-DD HH:mm') : '',
      limitRatio: Number((Number(values.limitPercent) / 100).toFixed(4)),
      limitKw: values.limitKw ?? null,
      note: values.note ?? '',
    };
    const errors = validateCurtailment(draft);
    if (errors.length > 0) {
      message.error(errors.join('；'));
      return;
    }
    if (editingId) {
      await updateCurtailment(editingId, draft);
      message.success('限功率时段已更新，排查榜与处置单初始值已按新限值重算');
    } else {
      await createCurtailment(draft);
      message.success('限功率时段已登记，统计口径已按实际限值折算（非整段剔除）');
    }
    cancelForm();
  };

  /** 选中具体逆变器时，按额定功率与限值比例带出限值功率（仅在留空时补） */
  const fillLimitKw = (inverterId: string, percent: number): void => {
    if (inverterId === PLANT_WIDE_INVERTER_ID) return;
    const current = form.getFieldValue('limitKw');
    if (current) return;
    const inverter = inverters.find((item) => item.id === inverterId);
    if (inverter) {
      form.setFieldValue('limitKw', Number(((inverter.ratedKw * percent) / 100).toFixed(1)));
    }
  };

  return (
    <Drawer
      title={`限功率时段 · ${plant?.name ?? ''}`}
      width={920}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        限功率会把同一逆变器下全部组串电流一起压低。统计口径采用
        <Typography.Text strong> 按实际限值折算回升 </Typography.Text>
        （折算电流 = 原始电流 ÷ 限值比例），不整段剔除——否则受限时段离散率无法计算，排查榜会漏掉应处置组串。
        跨日直接填写次日完整时间；同一时刻多条时段
        <Typography.Text strong> 重叠取最严限值</Typography.Text>；
        不填结束时间算到当前批次末尾
        {batchEnd ? `（本电站最晚采集：${batchEnd}）` : '（本电站暂无采集读数）'}。
      </Typography.Paragraph>

      <Card
        size="small"
        title={editingId ? `编辑时段 ${inverterName(rows.find((item) => item.id === editingId)?.inverterId ?? '')}` : '登记时段'}
        style={{ marginBottom: 12 }}
        extra={
          formOpen ? (
            <Button size="small" onClick={cancelForm}>
              收起表单
            </Button>
          ) : (
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增时段
            </Button>
          )
        }
      >
        {formOpen ? (
          <Form form={form} layout="vertical">
            <Space wrap align="start">
              <Form.Item
                name="inverterId"
                label="适用范围"
                rules={[{ required: true, message: '请选择范围' }]}
                style={{ minWidth: 220 }}
              >
                <Select
                  options={scopeOptions}
                  onChange={(value: string) =>
                    fillLimitKw(value, Number(form.getFieldValue('limitPercent') ?? 100))
                  }
                />
              </Form.Item>
              <Form.Item
                name="startAt"
                label="开始时间"
                rules={[{ required: true, message: '请选择开始时间' }]}
              >
                <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="endAt" label="结束时间（可留空，算至批次末尾）">
                <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item
                name="limitPercent"
                label="限值比例（%）"
                rules={[{ required: true, message: '请输入限值比例' }]}
                extra="限到 65% 填 65"
              >
                <InputNumber
                  min={5}
                  max={100}
                  step={5}
                  style={{ width: 130 }}
                  onChange={(value) =>
                    fillLimitKw(
                      form.getFieldValue('inverterId') ?? PLANT_WIDE_INVERTER_ID,
                      Number(value ?? 100),
                    )
                  }
                />
              </Form.Item>
              <Form.Item name="limitKw" label="限值功率（kW，可空）">
                <InputNumber min={0} max={100000} step={10} style={{ width: 150 }} />
              </Form.Item>
              <Form.Item name="note" label="备注 / 调度令">
                <Input placeholder="如：调度令编号" style={{ width: 220 }} />
              </Form.Item>
              <Form.Item label=" ">
                <Space>
                  <Button type="primary" onClick={() => void submit()}>
                    {editingId ? '保存修改' : '登记'}
                  </Button>
                  <Button onClick={cancelForm}>取消</Button>
                </Space>
              </Form.Item>
            </Space>
          </Form>
        ) : (
          <Typography.Text type="secondary">
            点击右上角「新增时段」登记限功率起止时间与逆变器限值；修改后排查榜、处置单初始离散率与同箱基准自动重算。
          </Typography.Text>
        )}
      </Card>

      <Table<CurtailmentRow>
        rowKey="id"
        size="small"
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '该电站暂无限功率时段，限功率期间建议及时登记' }}
        columns={[
          {
            title: '适用范围',
            dataIndex: 'inverterId',
            width: 180,
            render: (value: string) =>
              value === PLANT_WIDE_INVERTER_ID ? (
                <Tag color="purple">全厂统一</Tag>
              ) : (
                <Tag color="geekblue">{inverterName(value)}</Tag>
              ),
          },
          { title: '开始时间', dataIndex: 'startAt', width: 155 },
          {
            title: '结束时间',
            dataIndex: 'endAt',
            width: 175,
            render: (value: string) =>
              value ? (
                value
              ) : (
                <Tag color="orange">未填 · 算至{OPEN_ENDED_END_LABEL}</Tag>
              ),
          },
          {
            title: '限值',
            width: 160,
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{formatLimitRatio(row.limitRatio)}</Typography.Text>
                {row.limitKw !== null ? (
                  <span className="gb-hint">{row.limitKw} kW</span>
                ) : null}
              </Space>
            ),
          },
          { title: '备注', dataIndex: 'note', render: (value: string) => value || '-' },
          {
            title: '操作',
            width: 120,
            render: (_, row) => (
              <Space size={4}>
                <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该限功率时段？"
                  description="删除后相关读数恢复按原始电流统计。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={async () => {
                    await deleteCurtailment(row.id);
                    message.success('限功率时段已删除，统计已恢复原始读数口径');
                  }}
                >
                  <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
