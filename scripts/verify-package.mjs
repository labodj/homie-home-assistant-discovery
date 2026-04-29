#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const run = async (command, args, options = {}) => {
  try {
    return await execFileAsync(command, args, {
      cwd: root,
      maxBuffer: 1024 * 1024 * 16,
      ...options,
    });
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    const stdout = error.stdout ? `\n${error.stdout}` : "";
    throw new Error(`${command} ${args.join(" ")} failed.${stdout}${stderr}`, { cause: error });
  }
};

const ensureBuildExists = async () => {
  await access(join(root, "dist", "index.js"));
  await access(join(root, "dist", "mqtt.js"));
  await access(join(root, "dist", "cli.js"));
};

const pack = async (destination) => {
  const { stdout } = await run(npmBin, ["pack", "--json", "--pack-destination", destination]);
  const [entry] = JSON.parse(stdout);
  return join(destination, entry.filename);
};

const main = async () => {
  await ensureBuildExists();
  const tempRoot = await mkdtemp(join(tmpdir(), "homie-home-assistant-discovery-package-"));
  try {
    const packagesDir = join(tempRoot, "packages");
    const consumerDir = join(tempRoot, "consumer");
    await mkdir(packagesDir);
    await mkdir(consumerDir);

    const tarball = await pack(packagesDir);
    await writeFile(
      join(consumerDir, "package.json"),
      JSON.stringify({ private: true, type: "module" }, null, 2),
    );
    await run(npmBin, ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      cwd: consumerDir,
    });

    await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          import { HomieHaDiscoveryBridge } from "homie-home-assistant-discovery";
          const mqtt = await import("homie-home-assistant-discovery/mqtt");
          if (typeof HomieHaDiscoveryBridge !== "function") throw new Error("missing core export");
          if (typeof mqtt.HomieHaDiscoveryMqttBridge !== "function") throw new Error("missing mqtt export");
          const bridge = new HomieHaDiscoveryBridge();
          const result = bridge.ingest({
            topic: "homie/5/package-test/$description",
            payload: JSON.stringify({
              homie: "5.0",
              version: 1,
              nodes: { relay: { properties: { state: { datatype: "boolean" } } } }
            })
          });
          if (result.messages.length !== 2) throw new Error("unexpected discovery message count");
        `,
      ],
      { cwd: consumerDir },
    );

    await run(
      process.execPath,
      [
        join(consumerDir, "node_modules", "homie-home-assistant-discovery", "dist", "cli.js"),
        "--help",
      ],
      { cwd: consumerDir },
    );

    console.log(`Verified local package install from ${tarball}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
