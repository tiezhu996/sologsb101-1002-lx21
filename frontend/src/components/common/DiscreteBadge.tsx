/**
 * <DiscreteBadge> 离散率档位徽标
 * 按离散率区间渲染正常 / 关注 / 失配三档底色，被采集页与失配排查工作台消费。
 */
import { Tag, Tooltip } from 'antd';
import { DISCRETE_BG, DISCRETE_COLOR, levelOf } from '../../utils/discrete';
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '../../types/settings';
import { DISCRETE_LEVEL_LABEL, type DiscreteLevel } from '../../types/sample';
import { formatPercent } from '../../utils/unit';

export interface DiscreteBadgeProps {
  /** 离散率（%） */
  rate: number;
  /** 判定阈值，缺省用系统默认阈值 */
  thresholds?: ThresholdConfig;
  /** 是否展示数值文本 */
  showValue?: boolean;
  /** 电流偏差（%），展示时附带 */
  biasPercent?: number;
  /** 采集点数不足时的提示 */
  sampleCount?: number;
  size?: 'small' | 'default';
}

/** 依据阈值给档位 */
export function levelOfRate(rate: number, thresholds: ThresholdConfig = DEFAULT_THRESHOLDS): DiscreteLevel {
  return levelOf(rate, thresholds);
}

export default function DiscreteBadge({
  rate,
  thresholds = DEFAULT_THRESHOLDS,
  showValue = true,
  biasPercent,
  sampleCount,
  size = 'default',
}: DiscreteBadgeProps) {
  const level = levelOf(rate, thresholds);
  const label = DISCRETE_LEVEL_LABEL[level];
  const tooltip = [
    `离散率 ${rate.toFixed(2)}%（关注 ≥ ${thresholds.discreteWatchRate}%，失配 ≥ ${thresholds.discreteAlarmRate}%）`,
    typeof biasPercent === 'number' ? `电流偏差 ${formatPercent(biasPercent, 2, true)}` : '',
    typeof sampleCount === 'number' ? `采集点数 ${sampleCount}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Tooltip title={tooltip}>
      <Tag
        color={DISCRETE_COLOR[level]}
        style={{
          background: DISCRETE_BG[level],
          borderColor: DISCRETE_COLOR[level],
          color: DISCRETE_COLOR[level],
          fontWeight: level === 'mismatch' ? 600 : 400,
          marginInlineEnd: 0,
          fontSize: size === 'small' ? 12 : 13,
        }}
      >
        {showValue ? `${label} ${rate.toFixed(2)}%` : label}
        {typeof sampleCount === 'number' && sampleCount < thresholds.minSampleCount ? '（点数不足）' : ''}
      </Tag>
    </Tooltip>
  );
}
