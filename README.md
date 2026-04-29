# English-Tutor-Agent

## Phase 4 Streaming

- New endpoint: `POST /api/chat/stream`
- SSE events:
  - `meta` `{ scenario }`
  - `token` `{ delta }`
  - `done` `{ messageId, scenario, replyLength }`
  - `error` `{ code, message }`
- Frontend flag: `VITE_STREAMING=true` (set `false` to fallback to JSON `POST /api/chat`)
- Verification script: `npx tsx --env-file=.env src/graph/verify-streaming.ts`