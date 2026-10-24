/** Prefixes of entity ids; users keep fixed ids (`usr_admin`). */
export const ID_PREFIXES = {
  location: 'loc',
  room: 'room',
  member: 'mem',
  booking: 'bk',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** `formatId('bk', 118)` is `bk_3a`: ids are the prefix and the base36 value of a shared counter. */
export const formatId = (prefix: IdPrefix, sequence: number | bigint): string =>
  `${prefix}_${sequence.toString(36)}`;

const ID_PATTERN = /^[a-z]+_([0-9a-z]+)$/;

/** The counter value an id was built from: `sequenceOf('bk_3a')` is 118. */
export const sequenceOf = (id: string): number => {
  const digits = ID_PATTERN.exec(id)?.[1];
  if (digits === undefined) throw new Error(`Not an entity id: ${id}`);
  return Number.parseInt(digits, 36);
};
