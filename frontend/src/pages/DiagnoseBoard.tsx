/**
 * /diagnose 失配排查工作台
 * 按离散率倒序排序、标记可疑组串、追溯同汇流箱与同逆变器对比；
 * 消费 Sample、String、Inverter 与 <DiscreteBadge>、<FilterBar>。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Progress,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  AimOutlined,
  FileProtectOutlined,
  LineChartOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useSampleStore } from '../stores/sampleStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useDisposalStore } from '../stores/disposalStore';
import { useCompareGroup, useStringRank } from '../hooks/useStringRank';
import type { StringDiscreteStat } from '../types/sample';
import { DISCRETE_LEVEL_LABEL } from '../types/sample';
import { groupKeyOf } from '../utils/discrete';
import { formatCurrent, formatPercent, share } from '../utils/unit';
import { shiftDate } from '../utils/format';
import DiscreteBadge from '../components/common/DiscreteBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import FilterBar, { useFilterValues, useKeywordFilter } from '../components/common/FilterBar';

type SortKey = 'score' | 'discrete' | 'bias';

export default function DiagnoseBoard() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const thresholds = useSampleStore((state) => state.thresholds);
  const samplesOfString = useSampleStore((state) => state.samplesOfString);
  const markedStringIds = useSampleStore((state) => state.markedStringIds);
  const toggleMark = useSampleStore((state) => state.toggleMark);
  const markMany = useSampleStore((state) => state.markMany);
  const clearMarks = useSampleStore((state) => state.clearMarks);
  const createDisposal = useDisposalStore((state) => state.createDisposal);
  const disposals = useDisposalStore((state) => state.disposals);

  const plants = useDeviceStore((state) => state.plants);
  const inverters = useDeviceStore((state) => state.inverters);
  const arrays = useDeviceStore((state) => state.arrays);
  const strings = useDeviceStore((state) => state.strings);

  const keyword = useKeywordFilter();
  const filters = useFilterValues(['plant', 'inverter', 'level']);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string>('');

  const plantFilter = filters.plant ?? [];
  const inverterFilter = filters.inverter ?? [];
  const levelFilter = filters.level ?? [];
  const scopedPlant = plantFilter.length === 1 ? plantFilter[0] : '';
  const scopedInverter = inverterFilter.length === 1 ? inverterFilter[0] : '';

  const rank = useStringRank({
    sortBy,
    onlySuspicious,
    topN: 12,
    plantId: scopedPlant,
    inverterId: scopedInverter,
  });

  const filtered = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    return rank.ranked.filter((stat) => {
      if (plantFilter.length > 0 && !plantFilter.includes(stat.plantId)) return false;
      if (inverterFilter.length > 0 && !inverterFilter.includes(stat.inverterId)) return false;
      if (levelFilter.length > 0 && !levelFilter.includes(stat.level)) return false;
      if (lower) {
        const haystack = [stat.stringCode, stat.combinerBox, stat.inverterId].join(' ').toLowerCase();
        if (!haystack.includes(lower)) return false;
      }
      return true;
    });
  }, [rank.ranked, keyword, plantFilter, inverterFilter, levelFilter]);

  const { sameBox, sameInverter, target } = useCompareGroup(detailId);

  const detailSamples = useMemo(
    () => (detailId ? samplesOfString(detailId).slice(-10) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailId, samplesOfString],
  );

  const detailString = strings.find((item) => item.id === detailId) ?? null;
  const detailInverter = detailString
    ? (inverters.find((item) => item.id === detailString.inverterId) ?? null)
    : null;
  const detailArray = detailInverter
    ? (arrays.find((item) => item.id === detailInverter.arrayId) ?? null)
    : null;
  const detailPlant = detailArray
    ? (plants.find((item) => item.id === detailArray.plantId) ?? null)
    : null;

  /** 该组串是否已有未闭环处置单 */
  /** 未闭环处置单计数：按组串聚合，用于排查榜内联提示 */
  const openDisposalsOf = (stringId: string): number =>
    disposals.filter((item) => item.stringId === stringId && item.state !== 'retested').length;

  const createForSelected = async (): Promise<void> => {
    if (selectedIds.length === 0) {
      message.warning('请先勾选要处理的组串');
      return;
    }
    const owner = '李文波';
    for (const stringId of selectedIds) {
      /** 已存在未闭环处置单的组串跳过，避免重复派单 */
      if (openDisposalsOf(stringId) > 0) continue;
      const stat = rank.ranked.find((item) => item.stringId === stringId);
      await createDisposal({
        stringId,
        type: 'clean',
        owner,
        dueDate: shiftDate(3),
        initialDiscreteRate: stat?.discreteRate ?? 0,
      });
    }
    message.success(`已为 ${selectedIds.length} 串批量生成清洗处置单（重复派单已自动跳过）`);
    setSelectedIds([]);
    navigate('/disposals');
  };

  const totals = useMemo(
    () => ({
      total: rank.total,
      mismatch: rank.mismatchCount,
      marked: markedStringIds.length,
      markedButNormal: rank.markedButNormal,
      average: rank.averageDiscreteRate,
      mismatchShare: share(rank.mismatchCount, rank.total),
    }),
    [rank, markedStringIds.length],
  );

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <Typography.Title level={4} className="gb-page-title">
            失配排查工作台
          </Typography.Title>
          <Typography.Text type="secondary">
            按离散率与电流偏差排序定位可疑组串，支持人工标记、同汇流箱/同逆变器对比追溯与一键派单。
          </Typography.Text>
        </div>
        <Space wrap>
          <Segmented<SortKey>
            size="small"
            value={sortBy}
            onChange={(value) => setSortBy(value)}
            options={[
              { label: '综合评分', value: 'score' },
              { label: '离散率', value: 'discrete' },
              { label: '电流偏差', value: 'bias' },
            ]}
          />
          <Button
            size="small"
            type={onlySuspicious ? 'primary' : 'default'}
            onClick={() => setOnlySuspicious((prev) => !prev)}
          >
            只看可疑
          </Button>
          <Button size="small" onClick={clearMarks} disabled={markedStringIds.length === 0}>
            清空标记（{markedStringIds.length}）
          </Button>
          <Button
            type="primary"
            icon={<FileProtectOutlined />}
            disabled={selectedIds.length === 0}
            onClick={() => void createForSelected()}
          >
            批量派单（{selectedIds.length}）
          </Button>
        </Space>
      </div>

      <div className="gb-stat-grid">
        <StatBadge title="在册组串" value={totals.total} suffix="串" color="#0f7b6c" />
        <StatBadge
          title="失配组串"
          value={totals.mismatch}
          suffix={`/ ${totals.total}`}
          percent={totals.mismatchShare}
          color="#a8071a"
          hint={`失配阈值 ≥ ${thresholds.discreteAlarmRate}%`}
        />
        <StatBadge
          title="平均离散率"
          value={totals.average}
          suffix="%"
          color={totals.average >= thresholds.discreteWatchRate ? '#d46b08' : '#237804'}
        />
        <StatBadge
          title="人工标记"
          value={totals.marked}
          suffix="串"
          color="#1668dc"
          hint={`其中 ${totals.markedButNormal} 串当前离散率正常，建议复核`}
        />
      </div>

      <FilterBar
        keywordPlaceholder="按组串 / 汇流箱搜索"
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
            label: '档位',
            options: [
              { label: '正常', value: 'normal' },
              { label: '关注', value: 'watch' },
              { label: '失配', value: 'mismatch' },
            ],
            width: 180,
          },
        ]}
        resultCount={filtered.length}
        countUnit="串"
      />

      <Row gutter={14} style={{ marginTop: 14 }}>
        <Col xs={24} xl={16}>
          <Card size="small" title="组串排查榜（离散率 / 电流偏差）" styles={{ body: { padding: 12 } }}>
            {filtered.length === 0 ? (
              <EmptyPanel
                title="没有匹配的组串"
                description="可清空筛选条件，或先在采集页录入组串读数。"
                extra={
                  <Button type="primary" onClick={() => navigate('/samples')}>
                    去录入采集
                  </Button>
                }
              />
            ) : (
              <Table<StringDiscreteStat>
                rowKey="stringId"
                size="small"
                dataSource={filtered}
                pagination={{ pageSize: 12, size: 'small' }}
                scroll={{ x: 1080 }}
                rowClassName={(row) => (markedStringIds.includes(row.stringId) ? 'gb-rank-row is-marked' : '')}
                rowSelection={{
                  selectedRowKeys: selectedIds,
                  onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
                }}
                columns={[
                  {
                    title: '排名',
                    width: 70,
                    render: (_, __, index) => (
                      <Tag color={index === 0 ? 'red' : index < 3 ? 'orange' : 'default'}>#{index + 1}</Tag>
                    ),
                  },
                  {
                    title: '组串',
                    width: 170,
                    render: (_, row) => (
                      <Space size={6}>
                        <span>
                          {row.combinerBox} · {row.stringCode}
                        </span>
                        {markedStringIds.includes(row.stringId) ? <StarOutlined style={{ color: '#faad14' }} /> : null}
                      </Space>
                    ),
                  },
                  {
                    title: '离散率',
                    width: 165,
                    sorter: (a, b) => a.discreteRate - b.discreteRate,
                    render: (_, row) => (
                      <DiscreteBadge
                        rate={row.discreteRate}
                        thresholds={thresholds}
                        biasPercent={row.currentBiasPercent}
                        sampleCount={row.sampleCount}
                        size="small"
                      />
                    ),
                  },
                  {
                    title: '电流偏差',
                    dataIndex: 'currentBiasPercent',
                    width: 110,
                    render: (value: number) => (
                      <Typography.Text type={Math.abs(value) >= thresholds.currentBiasPercent ? 'danger' : undefined}>
                        {formatPercent(value, 2, true)}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: '平均电流',
                    dataIndex: 'avgCurrentA',
                    width: 105,
                    render: (value: number) => formatCurrent(value),
                  },
                  { title: '采集点数', dataIndex: 'sampleCount', width: 95 },
                  { title: '最后采集', dataIndex: 'lastSampledAt', width: 145 },
                  {
                    title: '未闭环处置',
                    width: 110,
                    render: (_, row) => {
                      const count = openDisposalsOf(row.stringId);
                      return count > 0 ? <Tag color="orange">{count} 单</Tag> : <Tag>无</Tag>;
                    },
                  },
                  {
                    title: '操作',
                    width: 190,
                    fixed: 'right',
                    render: (_, row) => (
                      <Space size={2}>
                        <Button size="small" type="link" onClick={() => setDetailId(row.stringId)}>
                          追溯
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          onClick={() => toggleMark(row.stringId)}
                        >
                          {markedStringIds.includes(row.stringId) ? '取消标记' : '标记'}
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          onClick={async () => {
                            if (openDisposalsOf(row.stringId) > 0) {
                              message.warning('该组串已有未闭环处置单');
                              return;
                            }
                            await createDisposal({
                              stringId: row.stringId,
                              type: row.discreteRate >= thresholds.discreteAlarmRate ? 'replace' : 'clean',
                              owner: '张启明',
                              dueDate: shiftDate(5),
                              initialDiscreteRate: row.discreteRate,
                            });
                            message.success('已生成处置单');
                            navigate('/disposals');
                          }}
                        >
                          派单
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Card size="small" title="Top 榜（最可疑 12 串）" styles={{ body: { padding: 12 } }}>
              {rank.top.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
              ) : (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {rank.top.map((stat) => (
                    <div key={stat.stringId}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Button type="link" size="small" onClick={() => setDetailId(stat.stringId)}>
                          {stat.combinerBox} · {stat.stringCode}
                        </Button>
                        <span>
                          {DISCRETE_LEVEL_LABEL[stat.level]} {stat.discreteRate.toFixed(2)}%
                        </span>
                      </Space>
                      <Progress
                        percent={Math.min(100, stat.discreteRate * 6)}
                        size="small"
                        showInfo={false}
                        strokeColor={
                          stat.level === 'mismatch' ? '#a8071a' : stat.level === 'watch' ? '#d46b08' : '#237804'
                        }
                      />
                    </div>
                  ))}
                </Space>
              )}
              <Button
                size="small"
                block
                style={{ marginTop: 10 }}
                onClick={() => markMany(rank.top.map((item) => item.stringId))}
              >
                标记 Top 12
              </Button>
            </Card>

            <Card size="small" title="汇流箱对比（平均离散率）" styles={{ body: { padding: 12 } }}>
              {rank.boxGroups.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
              ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {rank.boxGroups.slice(0, 6).map((group) => (
                    <div key={group.key}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <span>
                          <AimOutlined /> {group.label}
                          <span className="gb-hint"> · {group.count} 串</span>
                        </span>
                        <Typography.Text
                          type={
                            group.averageRate >= thresholds.discreteAlarmRate
                              ? 'danger'
                              : group.averageRate >= thresholds.discreteWatchRate
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {group.averageRate.toFixed(2)}%
                        </Typography.Text>
                      </Space>
                      <Progress
                        percent={Math.min(100, group.averageRate * 6)}
                        size="small"
                        showInfo={false}
                        strokeColor={group.averageRate >= thresholds.discreteAlarmRate ? '#a8071a' : '#0f7b6c'}
                      />
                    </div>
                  ))}
                </Space>
              )}
            </Card>
          </Space>
        </Col>
      </Row>

      {/* 追溯抽屉：同汇流箱 / 同逆变器对比 */}
      <Drawer
        title={detailString ? `组串追溯 · ${detailString.combinerBox} / ${detailString.code}` : '组串追溯'}
        width={880}
        open={Boolean(detailId)}
        onClose={() => setDetailId('')}
      >
        {!target || !detailString ? (
          <EmptyPanel title="未找到该组串的采集数据" description="请先在采集页录入读数。" />
        ) : (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Descriptions size="small" column={3} bordered>
              <Descriptions.Item label="电站">{detailPlant?.name ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="方阵">{detailArray?.code ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="逆变器">{detailInverter?.model ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="组件型号">{detailString.moduleModel}</Descriptions.Item>
              <Descriptions.Item label="串联数">{detailString.seriesCount}</Descriptions.Item>
              <Descriptions.Item label="分组键">{groupKeyOf(target)}</Descriptions.Item>
              <Descriptions.Item label="离散率" span={1}>
                <DiscreteBadge rate={target.discreteRate} thresholds={thresholds} />
              </Descriptions.Item>
              <Descriptions.Item label="电流偏差">
                {formatPercent(target.currentBiasPercent, 2, true)}
              </Descriptions.Item>
              <Descriptions.Item label="未闭环处置">
                {openDisposalsOf(target.stringId)} 单
              </Descriptions.Item>
            </Descriptions>

            <Row gutter={14}>
              <Col span={12}>
                <Card size="small" title={`同汇流箱对比（${sameBox.length} 串）`} styles={{ body: { padding: 8 } }}>
                  <Table<StringDiscreteStat>
                    rowKey="stringId"
                    size="small"
                    pagination={false}
                    dataSource={sameBox}
                    columns={[
                      {
                        title: '组串',
                        dataIndex: 'stringCode',
                        render: (value: string, row) => (
                          <Space size={4}>
                            <span>{value}</span>
                            {row.stringId === target.stringId ? <Tag color="blue">当前</Tag> : null}
                          </Space>
                        ),
                      },
                      {
                        title: '归一化电流',
                        dataIndex: 'avgNormalizedCurrentA',
                        render: (value: number) => formatCurrent(value),
                      },
                      {
                        title: '离散率',
                        width: 110,
                        render: (_, row) => (
                          <DiscreteBadge rate={row.discreteRate} thresholds={thresholds} size="small" />
                        ),
                      },
                    ]}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="本串最近采集序列" styles={{ body: { padding: 8 } }}>
                  {detailSamples.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无采集" />
                  ) : (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={detailSamples}
                      columns={[
                        { title: '时间', dataIndex: 'sampledAt', width: 130 },
                        {
                          title: '电流',
                          dataIndex: 'currentA',
                          render: (value: number) => formatCurrent(value),
                        },
                        {
                          title: '辐照度',
                          dataIndex: 'irradianceWm2',
                          render: (value: number) => `${value} W/m²`,
                        },
                        {
                          title: '离散率',
                          dataIndex: 'discreteRate',
                          render: (value: number) => `${value.toFixed(2)}%`,
                        },
                      ]}
                    />
                  )}
                </Card>
              </Col>
            </Row>

            <Card size="small" title={`同逆变器对比（${sameInverter.length} 串，按离散率倒序）`} styles={{ body: { padding: 8 } }}>
              <Table<StringDiscreteStat>
                rowKey="stringId"
                size="small"
                pagination={{ pageSize: 6, size: 'small' }}
                dataSource={sameInverter}
                columns={[
                  { title: '汇流箱', dataIndex: 'combinerBox', width: 100 },
                  { title: '组串', dataIndex: 'stringCode', width: 110 },
                  {
                    title: '判定',
                    dataIndex: 'level',
                    width: 90,
                    render: (value: StringDiscreteStat['level']) => DISCRETE_LEVEL_LABEL[value],
                  },
                  {
                    title: '离散率',
                    width: 150,
                    render: (_, row) => (
                      <DiscreteBadge rate={row.discreteRate} thresholds={thresholds} size="small" />
                    ),
                  },
                  {
                    title: '电流偏差',
                    dataIndex: 'currentBiasPercent',
                    render: (value: number) => formatPercent(value, 2, true),
                  },
                  {
                    title: '操作',
                    width: 90,
                    render: (_, row) => (
                      <Button size="small" type="link" onClick={() => setDetailId(row.stringId)}>
                        切换
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>

            <Space>
              <Button
                type="primary"
                icon={<LineChartOutlined />}
                onClick={() => {
                  void createDisposal({
                    stringId: target.stringId,
                    type: target.discreteRate >= thresholds.discreteAlarmRate ? 'replace' : 'clean',
                    owner: '王慧敏',
                    dueDate: shiftDate(5),
                    initialDiscreteRate: target.discreteRate,
                  }).then(() => {
                    message.success('已生成处置单');
                    navigate('/disposals');
                  });
                }}
              >
                生成处置单
              </Button>
              <Button onClick={() => toggleMark(target.stringId)}>
                {markedStringIds.includes(target.stringId) ? '取消标记' : '标记可疑'}
              </Button>
              <Button onClick={() => navigate('/samples')}>补充采集</Button>
            </Space>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
