import { customType } from "drizzle-orm/pg-core";
import type { LocalDateTime } from "@/engine/types";

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DRIVER_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::00(?:\.0+)?)?$/;

export function localDateTimeToDriver(value: LocalDateTime): string {
  if (!LOCAL_DATE_TIME.test(value)) {
    throw new Error(`Not a LocalDateTime (YYYY-MM-DDTHH:mm): ${value}`);
  }
  return `${value.replace("T", " ")}:00`;
}

export function localDateTimeFromDriver(value: string): LocalDateTime {
  const match = typeof value === "string" ? DRIVER_TIMESTAMP.exec(value) : null;
  if (!match) throw new Error(`Unexpected timestamp value from the database: ${String(value)}`);
  return `${match[1]}T${match[2]}`;
}

/**
 * A wall-clock time in `America/Detroit`, stored as `timestamp without time zone` (see the plan:
 * a timestamp with no zone is a wall-clock value, so DST changes do not move it). Reads and writes
 * the engine's `LocalDateTime` string, whatever text form the driver uses.
 */
export const localDateTime = customType<{ data: LocalDateTime; driverData: string }>({
  dataType: () => "timestamp(0) without time zone",
  toDriver: localDateTimeToDriver,
  fromDriver: localDateTimeFromDriver,
});
