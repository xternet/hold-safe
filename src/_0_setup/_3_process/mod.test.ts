import { expect, test } from "bun:test";

test("foreground SIGTERM awaits draining and exits cleanly", async () => {
  const code = `import { foreground } from './src/_0_setup/_3_process/mod.ts';
    await foreground(async signal => {
      console.log('ready');
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      await Bun.sleep(20);
      console.log('drained');
    }, fault => console.error(JSON.stringify(fault)));`;
  const child = Bun.spawn([process.execPath, "--eval", code], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader(), first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("ready");
    child.kill("SIGTERM");
    const output = async () => {
      let text = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += new TextDecoder().decode(chunk.value);
      }
      reader.releaseLock(); return text;
    };
    const [out, err, exit] = await Promise.all([output(), new Response(child.stderr).text(), child.exited]);
    expect(out).toContain("drained"); expect(err).toBe(""); expect(exit).toBe(0);
  } finally { if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
});
