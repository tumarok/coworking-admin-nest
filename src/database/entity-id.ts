import { formatId, type IdPrefix } from '../common/ids/ids.js';
import type { DbClient } from './prisma.service.js';

/**
 * The next id of a new entity: the shared counter feeds every table, so `loc_1`, `room_6`, `mem_12`
 * and `bk_3a` never collide. Also returns the counter value, which the row stores as its `seq`.
 */
export const nextEntityId = async (
  client: DbClient,
  prefix: IdPrefix,
): Promise<{ id: string; seq: bigint }> => {
  const rows = await client.$queryRaw<{ seq: bigint }[]>`SELECT nextval('entity_seq') AS seq`;
  const row = rows.at(0);
  if (row === undefined) throw new Error('entity_seq returned no value');
  return { id: formatId(prefix, row.seq), seq: row.seq };
};
