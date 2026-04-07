# claude-channel-redis

**Work in progress.** Redis pub/sub as a transport layer for Claude Code channels, so multiple instances on a LAN can talk to each other.

## What this is

Claude Code recently added [channels](https://docs.anthropic.com/en/docs/claude-code/channels) -- a way for MCP servers to push events into a running session. This project hooks that up to Redis pub/sub, so any Claude Code instance that can reach a shared Redis server can send and receive messages.

Each instance gets a named channel (e.g. `claude:rpi5`, `claude:macmini1`). You send messages from the CLI, and instances can address each other directly with the `send_to` tool.

Where I want to get to: a little swarm of Claude Code instances across machines on a LAN, where you ask one to delegate work to another. Like telling your MacMini Claude to get the RPi5 Claude to clone a repo and build it. Whether that actually works well is another matter.

## Status

Proof of concept. The basic flow works -- send a message via Redis, it arrives in a Claude Code session, Claude acts on it. The reply path and inter-instance communication (`send_to`) are wired up but I haven't tested them end-to-end yet.

### What works

- Channel server receives messages from Redis, pushes them into Claude Code
- CLI sends messages to any named instance
- Claude Code treats inbound messages as task requests and gets on with them

### What's not tested yet

- Reply flow (Claude sending responses back via Redis to the sender)
- Two Claude Code instances talking to each other via `send_to`
- Permission relay for remote tool approval
- Running across multiple machines on a LAN

### Known blockers

- Channels require a personal claude.ai login (not team plan, as of April 2025)
- Auto mode requires a team plan
- So you can't actually test both at once without swapping accounts, which is annoying

## Project structure

| File | What it does |
|------|-------------|
| `channel.ts` | MCP channel server. Claude Code spawns this as a subprocess. Subscribes to `claude:<name>` on Redis, forwards messages as channel notifications. Exposes `reply` and `send_to` tools. |
| `cli.ts` | CLI for sending messages to any instance: `bun cli.ts rpi5 "check docker status"` |
| `listen.ts` | Debug listener -- prints messages on a channel without needing Claude Code running. Handy for testing. |
| `.mcp.json` | Tells Claude Code how to spawn the channel server. |

## Getting started

You need [Bun](https://bun.sh) and a Redis server reachable from wherever you're running this.

```bash
bun install
```

### Quick test (no Claude Code needed)

In one terminal, start a listener:

```bash
bun listen.ts rpi5
```

In another, send a message:

```bash
bun cli.ts rpi5 "hello from the other side"
```

### With Claude Code

Edit `.mcp.json` to set your instance name and Redis URL, then start Claude Code with the dev flag:

```bash
claude --dangerously-load-development-channels server:redis-channel
```

In another terminal, send it something to do:

```bash
bun cli.ts macmini1 "check the status of docker container yaffle"
```

The `--name` argument in `.mcp.json` controls which Redis channel the instance subscribes to -- change it per machine. `--redis` defaults to `redis://localhost:6379`.

## Redis message format

Messages on the pub/sub channels are JSON:

```json
{
  "from": "human",
  "content": "check docker status",
  "type": "message",
  "timestamp": "2025-04-07T12:00:00.000Z"
}
```

The `type` field is either `"message"` (new request) or `"reply"` (response to a previous message).

## TODO

1. Test the reply flow -- run `bun listen.ts human` and see if Claude's responses actually come back via Redis
2. Make instance name configurable via env var so the same `.mcp.json` works on every machine
3. Get two Claude Code sessions talking to each other via `send_to`
4. Figure out permission relay for remote tool approval (this might be the hard bit)
5. Maybe a broadcast channel that all instances listen to
