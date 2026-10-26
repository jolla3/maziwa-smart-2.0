# Messaging build status (M3/M4)

## Implemented
- M3 Socket.IO session auth, join ACL, persist-before-emit
- M4 Redis adapter (enableRedisAdapter: true in production server)

## Tests
```bash
npm test -- tests/integration/conversations.socket.m3.test.js --detectOpenHandles
MESSAGING_TEST_REDIS_URL=redis://127.0.0.1:6379 npm test -- tests/integration/conversations.socket.m4.test.js --detectOpenHandles
npm test -- --detectOpenHandles
```

## Notes
- M4 cross-instance proof requires a reachable Redis.
- Open-handle discipline: closeSocketServer → httpServer.close → disposeAppResources → mongoose → memoryServer.
