#!/usr/bin/env bun
/**
 * CLI to send messages to any Claude instance on the Redis mesh.
 *
 * Usage:
 *   bun cli.ts <instance> <message>
 *   bun cli.ts rpi5 "check the status of docker container yaffle"
 *   bun cli.ts macmini1 "what's the status of the golang project?"
 *
 * Options:
 *   --from <name>    Sender name (default: "human")
 *   --redis <url>    Redis URL (default: redis://localhost:6379)
 *   --list           List active instances (those that have announced themselves)
 */
import Redis from "ioredis";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REDIS_URL = arg("redis", "redis://localhost:6379");
const FROM = arg("from", "human");
const CHANNEL_PREFIX = "claude:";

const redis = new Redis(REDIS_URL);

// --list: show active instances
if (process.argv.includes("--list")) {
  const keys = await redis.keys("claude:presence:*");
  if (keys.length === 0) {
    console.log("No active instances found.");
  } else {
    console.log("Active instances:");
    for (const key of keys) {
      const name = key.replace("claude:presence:", "");
      const lastSeen = await redis.get(key);
      console.log(`  ${name} (last seen: ${lastSeen})`);
    }
  }
  redis.disconnect();
  process.exit(0);
}

// Normal send mode
const positional = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--") && !["--from", "--redis"].includes(process.argv[process.argv.indexOf(a) - 1]));

if (positional.length < 2) {
  console.error("Usage: bun cli.ts <instance> <message>");
  console.error('  e.g. bun cli.ts rpi5 "check docker status"');
  console.error("");
  console.error("Options:");
  console.error("  --from <name>    Sender name (default: human)");
  console.error("  --redis <url>    Redis URL (default: redis://localhost:6379)");
  console.error("  --list           List active instances");
  redis.disconnect();
  process.exit(1);
}

const [target, ...messageParts] = positional;
const message = messageParts.join(" ");

const payload = JSON.stringify({
  from: FROM,
  content: message,
  type: "message",
  timestamp: new Date().toISOString(),
});

await redis.publish(`${CHANNEL_PREFIX}${target}`, payload);
console.log(`Sent to ${target}: ${message}`);
redis.disconnect();
