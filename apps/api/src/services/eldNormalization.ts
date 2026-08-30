export type EldProviderName = "SAMSARA" | "MOTIVE";

function records(payload: any, keys: string[]) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== ""));
}

function seconds(value: unknown, milliseconds = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return milliseconds ? Math.round(parsed / 1000) : Math.round(parsed);
}

export function normalizeEldSnapshot(
  provider: EldProviderName,
  payloads: { drivers: unknown; vehicles: unknown; hos: unknown },
) {
  const drivers = records(payloads.drivers, ["data", "drivers", "users"]).map((driver: any) => compact({
    providerDriverId: String(driver.id ?? driver.driverId ?? driver.driver_id ?? ""),
    name: driver.name ?? driver.username ?? [driver.firstName ?? driver.first_name, driver.lastName ?? driver.last_name].filter(Boolean).join(" "),
    status: driver.status ?? driver.driverActivationStatus,
  })).filter((driver) => driver.providerDriverId);

  const vehicles = records(payloads.vehicles, ["data", "vehicles"]).map((vehicle: any) => compact({
    providerVehicleId: String(vehicle.id ?? vehicle.vehicleId ?? vehicle.vehicle_id ?? ""),
    name: vehicle.name ?? vehicle.unitNumber ?? vehicle.number,
    unitNumber: vehicle.unitNumber ?? vehicle.number,
    vin: vehicle.vin,
    assignedDriverId: vehicle.assignedDriverId ?? vehicle.current_driver_id ?? vehicle.driver?.id,
  })).filter((vehicle) => vehicle.providerVehicleId);

  const hos = records(payloads.hos, ["data", "hos", "hours_of_service", "logs"]).map((entry: any) => {
    const clocks = entry.clocks ?? entry.hos?.clocks ?? {};
    const drive = clocks.drive ?? entry.drive ?? {};
    const shift = clocks.shift ?? entry.shift ?? {};
    const cycle = clocks.cycle ?? entry.cycle ?? {};
    return compact({
      providerDriverId: String(entry.driverId ?? entry.driver_id ?? entry.driver?.id ?? entry.id ?? ""),
      remainingDriveSeconds: seconds(drive.driveRemainingDurationMs ?? drive.timeRemainingDurationMs ?? entry.driveTimeRemainingDurationMs, true)
        ?? seconds(entry.remainingDriveTime ?? entry.remaining_drive_time),
      remainingOnDutySeconds: seconds(shift.shiftRemainingDurationMs ?? shift.timeRemainingDurationMs ?? entry.shiftTimeRemainingDurationMs, true)
        ?? seconds(entry.remainingOnDutyTime ?? entry.remaining_on_duty_time),
      remainingCycleSeconds: seconds(cycle.cycleRemainingDurationMs ?? cycle.timeRemainingDurationMs ?? entry.cycleTimeRemainingDurationMs, true)
        ?? seconds(entry.remainingCycleTime ?? entry.remaining_cycle_time),
      currentDutyStatus: entry.currentDutyStatus ?? entry.dutyStatus ?? entry.duty_status,
      lastUpdated: entry.updatedAt ?? entry.updated_at ?? entry.endTime,
    });
  }).filter((entry) => entry.providerDriverId);

  return { provider, drivers, vehicles, hos };
}
