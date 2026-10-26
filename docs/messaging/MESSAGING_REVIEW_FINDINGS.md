# Messaging M3/M4 review notes

- Socket auth shares express-session; Origin validated against FRONTEND_URL allowlist.
- Room join always re-checks participant via getConversation.
- emit only after sendMessage returns; duplicates reuse clientMessageId.
- Redis adapter failure logs and continues without live cross-instance delivery.
- Session store remains MongoDB (connect-mongo); adapter Redis is separate.
