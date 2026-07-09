import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { ScanningStatusSchema, type IScanningStatus } from "@steward/contracts/schemas";
import { AppError } from "../../core/app-error.js";
import { ERR_UNEXPECTED } from "../../core/error-codes.js";

type IScanningStatusRow = {
  status: IScanningStatus;
};

export function readScanningStatus(): IScanningStatus {
  let row: IScanningStatusRow | undefined;
  try {
    row = getRuntimeDb().prepare("SELECT status FROM scanning_status WHERE id = 'active'").get() as
      | IScanningStatusRow
      | undefined;
  } catch (err) {
    throw new AppError(
      "Failed to read scanning status from database",
      ERR_UNEXPECTED,
      { table: "scanning_status", rowId: "active" },
      { cause: err }
    );
  }
  if (!row) {
    throw new AppError("Missing required scanning status row", ERR_UNEXPECTED, {
      table: "scanning_status",
      rowId: "active",
    });
  }
  return ScanningStatusSchema.parse(row.status);
}

export function writeScanningStatus(status: IScanningStatus): void {
  getRuntimeDb()
    .prepare(
      `INSERT INTO scanning_status (id, status, updated_at)
       VALUES ('active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .run(status, Date.now());
}
