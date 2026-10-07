/**
 * /plants 电站与方阵
 * 录入电站与方阵结构，按容量与纬度带筛选；卡片回显方阵数与告警组串数。
 * 消费 Plant、Array 模型与 <StatBadge>、<EmptyPanel>、<FilterBar>。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RadarChartOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ROUTES } from '../router/routes';
import { usePlantStore } from '../stores/plantStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useSampleStore } from '../stores/sampleStore';
import type { ArrayDraft } from '../types/array';
import type { ArrayRow as DbArrayRow } from '../utils/db';
import { LATITUDE_BAND_LABEL, latitudeBandOf, type LatitudeBand, type PlantDraft } from '../types/plant';
import { azimuthDeviation, tiltLabel } from '../types/array';
import { stringsPerMppt } from '../types/inverter';
import { formatPower, share } from '../utils/unit';
import StatBadge from '../components/common/StatBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import FilterBar, { useFilterValues, useKeywordFilter } from '../components/common/FilterBar';

interface PlantFormValues {
  name: string;
  capacityMWp: number;
  gridDate: dayjs.Dayjs;
  latitude: number;
}

const LATITUDE_OPTIONS = (Object.keys(LATITUDE_BAND_LABEL) as LatitudeBand[]).map((key) => ({
  label: LATITUDE_BAND_LABEL[key],
  value: key,
}));

export default function PlantList() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const plants = usePlantStore((state) => state.plants);
  const arrays = usePlantStore((state) => state.arrays);
  const summaries = usePlantStore((state) => state.summaries);
  const activePlantId = usePlantStore((state) => state.activePlantId);
  const setActivePlant = usePlantStore((state) => state.setActivePlant);
  const createPlant = usePlantStore((state) => state.createPlant);
  const updatePlant = usePlantStore((state) => state.updatePlant);
  const deletePlant = usePlantStore((state) => state.deletePlant);
  const createArray = usePlantStore((state) => state.createArray);
  const updateArray = usePlantStore((state) => state.updateArray);
  const deleteArray = usePlantStore((state) => state.deleteArray);

  const stats = useSampleStore((state) => state.stats);
  const inverters = useDeviceStore((state) => state.inverters);
  const strings = useDeviceStore((state) => state.strings);

  const keyword = useKeywordFilter();
  const filters = useFilterValues(['band']);
  const [plantForm] = Form.useForm<PlantFormValues>();
  const [arrayForm] = Form.useForm<ArrayDraft & { tiltDeg: number }>();
  const [plantModal, setPlantModal] = useState<{ open: boolean; editingId: string | null }>({
    open: false,
    editingId: null,
  });
  const [arrayDrawer, setArrayDrawer] = useState<{ open: boolean; plantId: string; editing: DbArrayRow | null }>({
    open: false,
    plantId: '',
    editing: null,
  });

  const bandFilter = filters.band ?? [];

  const filtered = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    return summaries.filter((item) => {
      if (lower && !item.plant.name.toLowerCase().includes(lower)) return false;
      if (bandFilter.length > 0 && !bandFilter.includes(latitudeBandOf(item.plant.latitude))) return false;
      return true;
    });
  }, [summaries, keyword, bandFilter]);

  const totals = useMemo(() => {
    const totalCapacity = plants.reduce((sum, item) => sum + item.capacityMWp, 0);
    const totalStrings = summaries.reduce((sum, item) => sum + item.stringCount, 0);
    const alarmStrings = summaries.reduce((sum, item) => sum + item.alarmStringCount, 0);
    return {
      plants: plants.length,
      capacity: totalCapacity,
      arrays: arrays.length,
      strings: totalStrings,
      alarmStrings,
      alarmShare: share(alarmStrings, totalStrings),
    };
  }, [plants, arrays, summaries]);

  /** 打开电站表单 */
  const openPlantModal = (editingId: string | null): void => {
    setPlantModal({ open: true, editingId });
    const editing = plants.find((item) => item.id === editingId);
    if (editing) {
      plantForm.setFieldsValue({
        name: editing.name,
        capacityMWp: editing.capacityMWp,
        gridDate: dayjs(editing.gridDate),
        latitude: editing.latitude,
      });
    } else {
      plantForm.resetFields();
      plantForm.setFieldsValue({
        name: '',
        capacityMWp: 20,
        gridDate: dayjs(),
        latitude: 32,
      });
    }
  };

  const submitPlant = async (): Promise<void> => {
    const values = await plantForm.validateFields();
    const draft: PlantDraft = {
      name: values.name,
      capacityMWp: values.capacityMWp,
      gridDate: values.gridDate.format('YYYY-MM-DD'),
      latitude: values.latitude,
    };
    if (plantModal.editingId) {
      await updatePlant(plantModal.editingId, draft);
      message.success('电站信息已更新');
    } else {
      const created = await createPlant(draft);
      message.success('电站已创建，可继续录入方阵');
      setPlantModal({ open: false, editingId: null });
      setArrayDrawer({ open: true, plantId: created.id, editing: null });
      return;
    }
    setPlantModal({ open: false, editingId: null });
  };

  const submitArray = async (): Promise<void> => {
    const values = await arrayForm.validateFields();
    const draft: ArrayDraft = {
      plantId: arrayDrawer.plantId,
      code: values.code,
      tiltDeg: values.tiltDeg,
      azimuthDeg: values.azimuthDeg,
      capacityKw: values.capacityKw,
    };
    if (arrayDrawer.editing) {
      await updateArray(arrayDrawer.editing.id, draft);
      message.success('方阵已更新');
    } else {
      await createArray(draft);
      message.success('方阵已新增');
    }
    setArrayDrawer((prev) => ({ ...prev, editing: null }));
    arrayForm.resetFields();
  };

  /** 方阵行数据：带下级逆变器数量统计 */
  const arrayRows: DbArrayRow[] = useMemo(() => {
    const plant = plants.find((item) => item.id === arrayDrawer.plantId);
    return arrays
      .filter((item) => item.plantId === arrayDrawer.plantId)
      .map((item) => {
        const owned = inverters.filter((inverter) => inverter.arrayId === item.id);
        const ownedIds = new Set(owned.map((inverter) => inverter.id));
        return {
          ...item,
          plantName: plant?.name ?? '-',
          inverterCount: owned.length,
          stringCount: strings.filter((row) => ownedIds.has(row.inverterId)).length,
        };
      });
  }, [arrays, inverters, strings, plants, arrayDrawer.plantId]);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <Typography.Title level={4} className="gb-page-title">
            电站与方阵
          </Typography.Title>
          <Typography.Text type="secondary">
            维护电站装机与并网信息，展开方阵结构；卡片回显方阵数与告警组串数。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<RadarChartOutlined />} onClick={() => navigate(ROUTES.diagnose)}>
            去失配排查
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => navigate(ROUTES.settings)}>
            阈值配置
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openPlantModal(null)}>
            新建电站
          </Button>
        </Space>
      </div>

      <div className="gb-stat-grid">
        <StatBadge title="电站总数" value={totals.plants} suffix="座" color="#0f7b6c" />
        <StatBadge title="合计装机" value={totals.capacity} suffix="MWp" color="#1668dc" />
        <StatBadge title="方阵总数" value={totals.arrays} suffix="个" color="#08979c" />
        <StatBadge
          title="告警组串"
          value={totals.alarmStrings}
          suffix={`/ ${totals.strings}`}
          percent={totals.alarmShare}
          color="#a8071a"
          hint="存在未闭环处置单或离散率 ≥ 失配阈值的组串"
        />
      </div>

      <FilterBar
        keywordPlaceholder="按电站名称搜索"
        selects={[{ key: 'band', label: '纬度带', options: LATITUDE_OPTIONS, width: 220 }]}
        resultCount={filtered.length}
        countUnit="座电站"
        extra={
          <Button size="small" onClick={() => setActivePlant(activePlantId)}>
            重置当前电站
          </Button>
        }
      />

      <div style={{ marginTop: 14 }}>
        {filtered.length === 0 ? (
          <EmptyPanel
            title="没有匹配的电站"
            description="可新建电站或清空筛选条件后重试。"
            createLabel="新建电站"
            onCreate={() => openPlantModal(null)}
          />
        ) : (
          <div className="gb-card-grid">
            {filtered.map((item) => {
              const plantArrays = arrays.filter((array) => array.plantId === item.plant.id);
              const plantStats = stats.filter((stat) => stat.plantId === item.plant.id);
              const mismatch = plantStats.filter((stat) => stat.level === 'mismatch').length;
              return (
                <div
                  key={item.plant.id}
                  className={`gb-plant-card${activePlantId === item.plant.id ? ' is-active' : ''}`}
                  onClick={() => setActivePlant(item.plant.id)}
                >
                  <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
                    <div>
                      <Typography.Text strong style={{ fontSize: 15 }}>
                        {item.plant.name}
                      </Typography.Text>
                      <div className="gb-hint">
                        {item.plant.gridDate} 并网 · 纬度 {item.plant.latitude}°（
                        {LATITUDE_BAND_LABEL[latitudeBandOf(item.plant.latitude)].slice(0, 3)}）
                      </div>
                    </div>
                    <Space size={4}>
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        onClick={(event) => {
                          event.stopPropagation();
                          openPlantModal(item.plant.id);
                        }}
                      />
                      <Popconfirm
                        title="删除电站"
                        description="将级联删除方阵、逆变器、组串、采集与处置单，确认继续？"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={async (event) => {
                          event?.stopPropagation();
                          await deletePlant(item.plant.id);
                          message.success('电站及其下级数据已删除');
                        }}
                      >
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </Popconfirm>
                    </Space>
                  </Space>

                  <Row gutter={8} style={{ marginTop: 10 }}>
                    <Col span={8}>
                      <StatBadge title="装机" value={item.plant.capacityMWp} suffix="MWp" inline color="#1668dc" />
                    </Col>
                    <Col span={8}>
                      <StatBadge title="方阵" value={item.arrayCount} suffix="个" inline color="#08979c" />
                    </Col>
                    <Col span={8}>
                      <StatBadge
                        title="告警组串"
                        value={item.alarmStringCount}
                        suffix={`/${item.stringCount}`}
                        inline
                        color={item.alarmStringCount > 0 ? '#a8071a' : '#237804'}
                      />
                    </Col>
                  </Row>

                  <div className="gb-inline-list" style={{ marginTop: 10 }}>
                    {plantArrays.length === 0 ? (
                      <Tag>暂无方阵</Tag>
                    ) : (
                      plantArrays.map((array) => (
                        <Tag key={array.id} color="#e6f4f1" style={{ color: '#0f7b6c' }}>
                          {array.code} · {array.capacityKw}kW
                        </Tag>
                      ))
                    )}
                  </div>

                  <div
                    className="gb-hint"
                    style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}
                  >
                    <span>
                      逆变器 {item.inverterCount} 台 · 实采失配 {mismatch}
                    </span>
                    <Space size={4}>
                      <Button
                        size="small"
                        type="link"
                        onClick={(event) => {
                          event.stopPropagation();
                          setArrayDrawer({ open: true, plantId: item.plant.id, editing: null });
                        }}
                      >
                        方阵管理
                      </Button>
                      <Button
                        size="small"
                        type="link"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActivePlant(item.plant.id);
                          navigate(ROUTES.inverters);
                        }}
                      >
                        设备台账
                      </Button>
                    </Space>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 电站表单 */}
      <Drawer
        title={plantModal.editingId ? '编辑电站' : '新建电站'}
        width={420}
        open={plantModal.open}
        onClose={() => setPlantModal({ open: false, editingId: null })}
        extra={
          <Space>
            <Button onClick={() => setPlantModal({ open: false, editingId: null })}>取消</Button>
            <Button type="primary" onClick={() => void submitPlant()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={plantForm} layout="vertical">
          <Form.Item name="name" label="电站名称" rules={[{ required: true, message: '请输入电站名称' }]}>
            <Input placeholder="如：沙湖滩一期光伏电站" />
          </Form.Item>
          <Form.Item
            name="capacityMWp"
            label="装机容量（MWp）"
            rules={[{ required: true, message: '请输入装机容量' }]}
          >
            <InputNumber min={0.1} max={2000} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="gridDate" label="并网日期" rules={[{ required: true, message: '请选择并网日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="latitude"
            label="纬度（度）"
            rules={[{ required: true, message: '请输入纬度' }]}
            extra="低于 25° 为低纬带，25°~35° 为中纬带，高于 35° 为高纬带"
          >
            <InputNumber min={-90} max={90} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 方阵管理 */}
      <Drawer
        title={`方阵结构 · ${plants.find((item) => item.id === arrayDrawer.plantId)?.name ?? ''}`}
        width={860}
        open={arrayDrawer.open}
        onClose={() => setArrayDrawer({ open: false, plantId: '', editing: null })}
      >
        <Card
          size="small"
          title={arrayDrawer.editing ? `编辑方阵 ${arrayDrawer.editing.code}` : '新增方阵'}
          style={{ marginBottom: 12 }}
        >
          <Form form={arrayForm} layout="inline" onFinish={() => void submitArray()}>
            <Form.Item name="code" label="编号" rules={[{ required: true, message: '请输入编号' }]}>
              <Input placeholder="A1" style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="tiltDeg" label="倾角°" rules={[{ required: true, message: '请输入倾角' }]}>
              <InputNumber min={0} max={60} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="azimuthDeg" label="方位角°" rules={[{ required: true, message: '请输入方位角' }]}>
              <InputNumber min={90} max={270} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="capacityKw" label="容量kW" rules={[{ required: true, message: '请输入容量' }]}>
              <InputNumber min={1} max={20000} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
                  {arrayDrawer.editing ? '保存修改' : '新增方阵'}
                </Button>
                {arrayDrawer.editing ? (
                  <Button
                    onClick={() => {
                      setArrayDrawer((prev) => ({ ...prev, editing: null }));
                      arrayForm.resetFields();
                    }}
                  >
                    取消编辑
                  </Button>
                ) : null}
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Table<DbArrayRow>
          rowKey="id"
          size="small"
          dataSource={arrayRows}
          pagination={false}
          locale={{
            emptyText: (
              <EmptyPanel
                title="该电站还没有方阵"
                description="先建方阵，才能在方阵下挂接逆变器与组串。"
              />
            ),
          }}
          columns={[
            { title: '方阵编号', dataIndex: 'code', width: 110 },
            {
              title: '倾角',
              dataIndex: 'tiltDeg',
              width: 130,
              render: (value: number) => <Tag color="cyan">{value}° · {tiltLabel(value)}</Tag>,
            },
            {
              title: '方位角',
              dataIndex: 'azimuthDeg',
              width: 150,
              render: (value: number) => (
                <span>
                  {value}° <span className="gb-hint">偏南 {azimuthDeviation(value)}°</span>
                </span>
              ),
            },
            {
              title: '容量',
              dataIndex: 'capacityKw',
              width: 130,
              render: (value: number) => formatPower(value),
            },
            { title: '下级逆变器', dataIndex: 'inverterCount', width: 110 },
            { title: '组串数', dataIndex: 'stringCount', width: 90 },
            {
              title: '操作',
              width: 160,
              render: (_, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setArrayDrawer((prev) => ({ ...prev, editing: row }));
                      arrayForm.setFieldsValue({
                        code: row.code,
                        tiltDeg: row.tiltDeg,
                        azimuthDeg: row.azimuthDeg,
                        capacityKw: row.capacityKw,
                      });
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除方阵及其下级设备？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={async () => {
                      await deleteArray(row.id);
                      message.success('方阵已删除');
                    }}
                  >
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />

        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          方阵下逆变器平均每路 MPPT 承载组串数：
          {inverters
            .filter((inverter) => arrayRows.some((row) => row.id === inverter.arrayId))
            .map((inverter) => {
              const owned = strings.filter((row) => row.inverterId === inverter.id).length;
              return `${inverter.model} ${stringsPerMppt(inverter, owned)} 串/MPPT`;
            })
            .join(' · ') || '暂无逆变器'}
        </Typography.Paragraph>
      </Drawer>
    </div>
  );
}
