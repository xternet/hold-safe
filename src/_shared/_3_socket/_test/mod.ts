import { fork } from "node:child_process";

export async function fixture(mode: "reconnect" | "malformed" | "oversized" | "idle" | "kraken" | "alpaca" | "alpaca-denied" | "alpaca-reconnect" | "solana") {
  const child = fork(`${import.meta.dir}/server.cjs`, [mode], { execPath: "node", stdio: ["ignore", "ignore", "inherit", "ipc"] });
  let connections = 0, subscriptions = 0;
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Fixture exit ${code}`)));
  });
  const port = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.on("message", (message: { port?: number; connections?: number; subscriptions?: number }) => {
      if (message.port !== undefined) resolve(message.port);
      if (message.connections !== undefined) connections = message.connections;
      if (message.subscriptions !== undefined) subscriptions = message.subscriptions;
    });
  });
  return { url: `ws://127.0.0.1:${port}`, connections: () => connections, subscriptions: () => subscriptions,
    async stop() { child.send("stop"); await exited; } };
}
