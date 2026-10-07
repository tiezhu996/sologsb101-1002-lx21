/**
 * <EmptyPanel> 空数据引导与新建入口
 * 被全部列表页消费，保证任何列表为空时都有明确的下一步动作。
 */
import { Button, Empty, Space, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface EmptyPanelProps {
  /** 空态标题 */
  title?: string;
  /** 补充说明 */
  description?: ReactNode;
  /** 新建按钮文案，不传则不渲染主按钮 */
  createLabel?: string;
  onCreate?: () => void;
  /** 重置数据按钮 */
  resetLabel?: string;
  onReset?: () => void;
  /** 自定义操作区 */
  extra?: ReactNode;
}

export default function EmptyPanel({
  title = '暂无数据',
  description = '当前筛选条件下没有记录，可新建一条或调整筛选条件。',
  createLabel,
  onCreate,
  resetLabel,
  onReset,
  extra,
}: EmptyPanelProps) {
  return (
    <div
      style={{
        padding: '36px 16px',
        background: '#fff',
        border: '1px dashed rgba(0,0,0,0.15)',
        borderRadius: 10,
        textAlign: 'center',
      }}
    >
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />
      <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 4 }}>
        {title}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {description}
      </Typography.Paragraph>
      <Space wrap>
        {createLabel && onCreate ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            {createLabel}
          </Button>
        ) : null}
        {resetLabel && onReset ? (
          <Button icon={<ReloadOutlined />} onClick={onReset}>
            {resetLabel}
          </Button>
        ) : null}
        {extra}
      </Space>
    </div>
  );
}
