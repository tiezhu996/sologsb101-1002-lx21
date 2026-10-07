/**
 * 持久化元信息：所有落库实体共用的行修订号。
 * 索引页的视图行类型通过继承它，保证与 utils/db.ts 的持久化行类型结构一致。
 */
export const ROW_REVISION = 2;

/** 行修订号：用于按行迁移与版本核对 */
export interface Revisioned {
  revision: number;
}
