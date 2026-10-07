/**
 * <StatBadge> 计数与占比徽标
 * 展示组串总数、失配数、处置完成率等指标，被电站页、处置单页、阈值页消费。
 */
import { Card, Progress, Statistic, Tooltip } from 'antd';
import type { ReactNode } from 'react';

export interface StatBadgeProps {
  /** 指标名称 */
  title: string;
  /** 主数值 */
  value: number | string;
  /** 单位/后缀 */
  suffix?: string;
  /** 占比（0~100），提供时展示进度条 */
  percent?: number;
  /** 进度条颜色 */
  color?: string;
  /** 悬浮说明 */
  hint?: string;
  /** 是否小尺寸（内联在卡片头部） */
  inline?: boolean;
  /** 图标 */
  icon?: ReactNode;
}

export default function StatBadge({
  title,
  value,
  suffix,
  percent,
  color = '#1677ff',
  hint,
  inline = false,
  icon,
}: StatBadgeProps) {
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: inline ? 2 : 6 }}>
      <Statistic
        title={
          <span style={{ fontSize: inline ? 12 : 13 }}>
            {icon} {title}
          </span>
        }
        value={value}
        suffix={suffix}
        valueStyle={{ fontSize: inline ? 16 : 22, fontWeight: 600, color }}
      />
      {typeof percent === 'number' ? (
        <Progress
          percent={Math.max(0, Math.min(100, percent))}
          size="small"
          strokeColor={color}
          format={(value) => `${value?.toFixed(1) ?? '0.0'}%`}
        />
      ) : null}
    </div>
  );

  const wrapped = hint ? <Tooltip title={hint}>{body}</Tooltip> : body;

  if (inline) return wrapped;

  return (
    <Card size="small" variant="outlined" styles={{ body: { padding: 14 } }}>
      {wrapped}
    </Card>
  );
}
