# Messaging Backend Plan — M1–M4

## Stages
- **M1/M2 (implemented):** HTTP conversations, idempotent sends, notifications, recovery, CSRF double-submit.
- **M3 (implemented):** Socket.IO on the HTTP server; session cookie auth; Origin allowlist; room join after participant check; `conversation:send` persists via service then emits `conversation:message`.
- **M4 (implemented):** `@socket.io/redis-adapter` with dedicated ioredis pub/sub clients; multi-process fan-out. Redis outage degrades live delivery only; HTTP remains available.

## Socket event contract
| Event | Direction | Notes |
|-------|-----------|--------|
| `conversation:join` | client→server | `{ conversationId }` + ack |
| `conversation:leave` | client→server | `{ conversationId }` |
| `conversation:send` | client→server | `{ conversationId, body, clientMessageId }` → persists then broadcasts |
| `conversation:message` | server→room | `{ conversationId, message }` after durable write |
| `conversation:error` | server→client | failures when no ack callback |
| `session:invalidated` | server→client | before forced disconnect on logout |

## Auth
Socket.IO reuses express-session middleware + Mongo session store. No JWT in localStorage or query strings.
Logout calls `disconnectAccountSockets`.

## Persistence
HTTP service is authoritative. Socket send path calls `conversationService.sendMessage` before emit.
