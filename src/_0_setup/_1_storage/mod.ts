import { SQL } from "bun";
import type { Fault } from "../../_kernel/mod";

export type DatabaseDestination = { url: string } | { socket: string; database: string; username: string };
export interface Storage {
  sql: SQL;
  close(): Promise<void>;
}

/** Startup verifies an operator-provisioned schema; it never applies DDL. */
export async function openStorage(destination: DatabaseDestination, log: (fault: Fault) => void): Promise<Storage> {
  let sql: SQL | undefined;
  let phase = "configuration";
  try {
    if ("url" in destination) {
      const parsed = new URL(destination.url);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.pathname.length < 2 || parsed.hash !== "") {
        throw new Error("Explicit PostgreSQL destination required");
      }
    } else if (!destination.socket.startsWith("/") || destination.database.length === 0 || destination.username.length === 0) {
      throw new Error("Explicit PostgreSQL socket destination required");
    }
    const target = "url" in destination ? { url: destination.url } : {
      path: destination.socket, database: destination.database, username: destination.username,
    };
    phase = "connection";
    sql = new SQL({ ...target, adapter: "postgres", max: 8, connectionTimeout: 5, idleTimeout: 30,
      connection: { application_name: "solstock-guard", statement_timeout: 5000, lock_timeout: 2000,
        idle_in_transaction_session_timeout: 10000, synchronous_commit: "on", client_min_messages: "warning" } });
    const [server] = await sql`select pg_is_in_recovery() as recovery,
      current_setting('transaction_read_only') as readonly, current_setting('fsync') as fsync,
      current_setting('full_page_writes') as fullpages, current_setting('synchronous_commit') as sync`;
    phase = "durability";
    if (server === undefined || server.recovery !== false || server.readonly !== "off" || server.fsync !== "on" ||
        server.fullpages !== "on" || server.sync !== "on") throw new Error("Writable durable primary required");
    phase = "schema";
    const versions = await sql`select version from solstock_guard.schema_versions order by version`;
    if (versions.length !== 2 || versions[0].version !== 1 || versions[1].version !== 2) {
      throw new Error("Unsupported database schema version");
    }
    const client = sql;
    return { sql: client, async close() {
      try { await client.close({ timeout: 5 }); }
      catch {
        log({ code: "UNAVAILABLE", message: "Database shutdown failed; connection details redacted", retryable: true, context: { component: "storage-startup", phase } });
        throw new Error("Database shutdown failed");
      }
    } };
  } catch {
    log({ code: "UNAVAILABLE", message: "Database readiness failed; verify destination, schema versions 1/2 and durable writable primary", retryable: true, context: { component: "storage-startup", phase } });
    if (sql !== undefined) {
      try { await sql.close({ timeout: 1 }); }
      catch {
        log({ code: "UNAVAILABLE", message: "Database startup cleanup failed; connection details redacted", retryable: true, context: { component: "storage-startup", phase } });
      }
    }
    throw new Error("Database readiness failed");
  }
}
