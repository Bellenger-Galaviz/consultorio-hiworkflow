export const APP_TIME_ZONE =
  process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? process.env.APP_TIME_ZONE ?? "America/Mazatlan";

function getParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? "00" : values.hour;

  return {
    day: Number(values.day),
    hour: Number(hour),
    minute: Number(values.minute),
    month: Number(values.month),
    second: Number(values.second),
    year: Number(values.year)
  };
}

function getOffsetMs(date: Date) {
  const parts = getParts(date);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return zonedAsUtc - date.getTime();
}

export function zonedDateTimeToUtc(day: string, time: string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, date, hour, minute, 0, 0);
  const firstPass = new Date(wallClockUtc - getOffsetMs(new Date(wallClockUtc)));
  const secondPass = new Date(wallClockUtc - getOffsetMs(firstPass));

  return secondPass;
}

export function getClinicDayBounds(day: string) {
  return {
    startOfDay: zonedDateTimeToUtc(day, "00:00"),
    endOfDay: zonedDateTimeToUtc(addDaysToInputDate(day, 1), "00:00")
  };
}

export function formatInputDate(date: Date) {
  const parts = getParts(date);

  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

export function formatClinicDate(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(date);
}

export function formatClinicDateTime(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(date);
}

export function formatClinicTime(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    hour12: true,
    minute: "2-digit",
    timeZone: APP_TIME_ZONE
  }).format(date);
}

function addDaysToInputDate(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date + days, 12, 0, 0, 0));

  return [
    String(utc.getUTCFullYear()).padStart(4, "0"),
    String(utc.getUTCMonth() + 1).padStart(2, "0"),
    String(utc.getUTCDate()).padStart(2, "0")
  ].join("-");
}
