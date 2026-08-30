export type HereTimeZone = {
  name: string;
  utcOffset: string;
};

export function parseHereTimeZone(payload: unknown): HereTimeZone {
  const item = (payload as any)?.items?.[0];
  const name = item?.timeZone?.name;
  const utcOffset = item?.timeZone?.utcOffset;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("HERE response did not include a destination time zone");
  }
  if (typeof utcOffset !== "string" || !/^[+-]\d{2}:\d{2}$/.test(utcOffset)) {
    throw new Error("HERE response included an invalid UTC offset");
  }
  return { name: name.trim(), utcOffset };
}