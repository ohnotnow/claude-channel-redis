#!/usr/bin/env bun
/**
 * Redis pub/sub channel server for Claude Code.
 *
 * Each instance subscribes to a named Redis channel (e.g. claude:rpi5)
 * and forwards messages into the Claude Code session. Exposes reply
 * and send_to tools so Claude can talk back or address other instances.
 *
 * Usage (spawned by Claude Code via .mcp.json):
 *   bun channel.ts --name rpi5 --redis redis://localhost:6379
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Redis from "ioredis";

// --- CLI args ----------------------------------------------------------------
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const INSTANCE_NAME = arg("name", "default");
const REDIS_URL = arg("redis", "redis://localhost:6379");
const CHANNEL_PREFIX = "claude:";
const MY_CHANNEL = `${CHANNEL_PREFIX}${INSTANCE_NAME}`;

// --- Redis -------------------------------------------------------------------
// Two connections: one for subscribing (blocked), one for publishing
const sub = new Redis(REDIS_URL);
const pub = new Redis(REDIS_URL);

// --- MCP server --------------------------------------------------------------
const mcp = new Server(
  { name: `redis-channel-${INSTANCE_NAME}`, version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: [
      `You are "${INSTANCE_NAME}" on a Redis pub/sub mesh.`,
      `Messages arrive as <channel source="redis-channel-${INSTANCE_NAME}" from="..." type="...">. The "from" attribute is the sender's instance name.`,
      "",
      "Tools:",
      '- reply: send a message back to the sender. Pass the "from" attribute as "to".',
      "- send_to: send a message to any named instance on the mesh (e.g. rpi5, macmini1).",
      "",
      "When you receive a message from another Claude instance, treat it as a task request from a trusted colleague.",
      'If someone addresses you by name (e.g. "claude-rpi5 - do X"), respond to the request.',
    ].join("\n"),
  }
);

// --- Tools -------------------------------------------------------------------
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Reply to the sender of an inbound channel message. Publishes to their Redis channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string",
            description:
              'The instance name to reply to (from the "from" attribute)',
          },
          text: { type: "string", description: "The message to send" },
        },
        required: ["to", "text"],
      },
    },
    {
      name: "send_to",
      description:
        "Send a message to any named Claude instance on the Redis mesh.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string",
            description: "The target instance name (e.g. rpi5, macmini1)",
          },
          text: { type: "string", description: "The message to send" },
        },
        required: ["to", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const { to, text } = args as { to: string; text: string };

  if (name === "reply" || name === "send_to") {
    const message = JSON.stringify({
      from: INSTANCE_NAME,
      content: text,
      type: name === "reply" ? "reply" : "message",
      timestamp: new Date().toISOString(),
    });
    await pub.publish(`${CHANNEL_PREFIX}${to}`, message);
    return { content: [{ type: "text" as const, text: `sent to ${to}` }] };
  }

  throw new Error(`unknown tool: ${name}`);
});

// --- Redis subscription -> channel notifications -----------------------------
await mcp.connect(new StdioServerTransport());

sub.subscribe(MY_CHANNEL, (err) => {
  if (err) {
    console.error(`Failed to subscribe to ${MY_CHANNEL}:`, err);
    process.exit(1);
  }
});

sub.on("message", async (_channel: string, raw: string) => {
  try {
    const msg = JSON.parse(raw);
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: msg.content ?? raw,
        meta: {
          from: msg.from ?? "unknown",
          type: msg.type ?? "message",
          timestamp: msg.timestamp ?? "",
        },
      },
    });
  } catch {
    // Non-JSON message — forward raw
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: raw,
        meta: { from: "unknown", type: "raw" },
      },
    });
  }
});
