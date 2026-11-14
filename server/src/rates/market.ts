const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 0;
const REOPEN_HOUR_UTC = 22;

export function isMarketClosed(now: Date): boolean {
  const day = now.getUTCDay();
  const afterTen = now.getUTCHours() >= REOPEN_HOUR_UTC;
  if (day === FRIDAY) return afterTen;
  if (day === SATURDAY) return true;
  if (day === SUNDAY) return !afterTen;
  return false;
}
