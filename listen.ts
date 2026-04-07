#!/usr/bin/env bun
/**
 * Debug listener — subscribe to a Redis channel and print messages.
 * Useful for testing without a full Claude Code session.
 *
 * Usage:
 *   bun listen.ts <instance>
 *   bun listen.ts rpi5
 */
import Redis from "ioredis";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REDIS_URL = arg("redis", "redis://localhost:6379");
const CHANNEL_PREFIX = "claude:";

const target = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]);

if (!target) {
  console.error("Usage: bun listen.ts <instance>");
  console.error("  e.g. bun listen.ts rpi5");
  process.exit(1);
}

const channel = `${CHANNEL_PREFIX}${target}`;
const sub = new Redis(REDIS_URL);

console.log(`Listening on ${channel}...`);

sub.subscribe(channel, (err) => {
  if (err) {
    console.error(`Failed to subscribe to ${channel}:`, err);
    process.exit(1);
  }
});

sub.on("message", (_ch: string, raw: string) => {
  try {
    const msg = JSON.parse(raw);
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : "?";
    console.log(`[${time}] ${msg.from ?? "?"} (${msg.type ?? "?"}): ${msg.content}`);
  } catch {
    console.log(`[raw] ${raw}`);
  }
});
