/**
 * <FilterBar> 关键字 + 多选条件筛选条
 * 条件与 URL query 同步（刷新/分享链接后筛选状态不丢），
 * 被三级设备台账页、失配排查工作台消费。
 */
import { Button, Card, Input, Select, Space, Tag, Typography } from 'antd';
import { ClearOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface FilterBarOption {
  label: string;
  value: string;
}

export interface FilterBarSelect {
  /** query 参数名 */
  key: string;
  label: string;
  options: FilterBarOption[];
  /** 是否允许多选，默认 true */
  multiple?: boolean;
  width?: number;
  placeholder?: string;
}

export interface FilterBarProps {
  /** 关键字搜索占位文案 */
  keywordPlaceholder?: string;
  /** 关键字对应的 query 参数名，默认 kw */
  keywordKey?: string;
  /** 多选条件定义 */
  selects?: FilterBarSelect[];
  /** 右侧附加操作 */
  extra?: React.ReactNode;
  /** 筛选变化回调（已同步 URL） */
  onChange?: (values: { keyword: string; filters: Record<string, string[]> }) => void;
  /** 命中条数展示 */
  resultCount?: number;
  /** 命中条数单位 */
  countUnit?: string;
}

/** 从 URLSearchParams 读取多选值 */
function readValues(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function FilterBar({
  keywordPlaceholder = '按名称 / 编号搜索',
  keywordKey = 'kw',
  selects = [],
  extra,
  onChange,
  resultCount,
  countUnit = '条',
}: FilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(() => searchParams.get(keywordKey) ?? '');

  const filterValues = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const select of selects) {
      result[select.key] = readValues(searchParams, select.key);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, selects.map((item) => item.key).join(',')]);

  const pushParams = useCallback(
    (nextKeyword: string, nextFilters: Record<string, string[]>) => {
      const params = new URLSearchParams(searchParams);
      if (nextKeyword.trim()) params.set(keywordKey, nextKeyword.trim());
      else params.delete(keywordKey);
      for (const select of selects) {
        const values = nextFilters[select.key] ?? [];
        if (values.length > 0) params.set(select.key, values.join(','));
        else params.delete(select.key);
      }
      setSearchParams(params, { replace: true });
      onChange?.({ keyword: nextKeyword.trim(), filters: nextFilters });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, setSearchParams, keywordKey, selects, onChange],
  );

  // URL 变化时回填输入框（例如从其它页面带参跳转过来）
  useEffect(() => {
    const current = searchParams.get(keywordKey) ?? '';
    setKeyword((prev) => (prev === current ? prev : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, keywordKey]);

  const handleKeyword = (value: string): void => {
    setKeyword(value);
    pushParams(value, filterValues);
  };

  const handleSelect = (key: string, values: string[]): void => {
    pushParams(keyword, { ...filterValues, [key]: values });
  };

  const handleReset = (): void => {
    setKeyword('');
    const cleared: Record<string, string[]> = {};
    for (const select of selects) cleared[select.key] = [];
    pushParams('', cleared);
  };

  const activeCount =
    (keyword.trim() ? 1 : 0) +
    Object.values(filterValues).filter((values) => values.length > 0).length;

  return (
    <Card size="small" variant="outlined" styles={{ body: { padding: 12 } }}>
      <Space wrap size={[10, 10]} style={{ width: '100%' }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={keywordPlaceholder}
          value={keyword}
          onChange={(event) => handleKeyword(event.target.value)}
          style={{ width: 240 }}
        />
        {selects.map((select) => (
          <Space key={select.key} size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {select.label}
            </Typography.Text>
            <Select
              mode={select.multiple === false ? undefined : 'multiple'}
              allowClear
              maxTagCount={2}
              placeholder={select.placeholder ?? `选择${select.label}`}
              value={select.multiple === false ? (filterValues[select.key]?.[0] ?? undefined) : filterValues[select.key]}
              options={select.options}
              onChange={(value) => {
                if (Array.isArray(value)) handleSelect(select.key, value);
                else handleSelect(select.key, value ? [String(value)] : []);
              }}
              style={{ minWidth: select.width ?? 168 }}
            />
          </Space>
        ))}
        <Button icon={<ClearOutlined />} onClick={handleReset} disabled={activeCount === 0}>
          重置
        </Button>
        {typeof resultCount === 'number' ? (
          <Tag color="blue">
            {resultCount} {countUnit}
          </Tag>
        ) : null}
        {extra}
      </Space>
    </Card>
  );
}

/** 供页面复用：从 URL query 中读取筛选值 */
export function useFilterValues(keys: string[]): Record<string, string[]> {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<Record<string, string[]>>({});
  const joined = keys.join(',');
  useEffect(() => {
    const result: Record<string, string[]> = {};
    for (const key of joined.split(',').filter(Boolean)) {
      result[key] = readValues(searchParams, key);
    }
    setState(result);
  }, [searchParams, joined]);
  return state;
}

/** 供页面复用：关键字 */
export function useKeywordFilter(key = 'kw'): string {
  const [searchParams] = useSearchParams();
  return searchParams.get(key) ?? '';
}

/** 重载提示图标（列表页刷新按钮统一使用） */
export function ReloadIcon() {
  return <ReloadOutlined />;
}
