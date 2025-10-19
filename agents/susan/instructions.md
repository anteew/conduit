```json
{
  "ampcode": "v1",
  "waves": [
    {
      "id": "Wave-Edge-Enhancements",
      "parallel": true,
      "tasks": [
        "T-S1-SSE",
        "T-S1-WSERR",
        "T-S1-DELAY",
        "T-S1-TOKEN",
        "T-S1-CI",
        "T-S1-DOCKER"
      ]
    }
  ],
  "tasks": [
    {
      "id": "T-S1-SSE",
      "agent": "gemini",
      "title": "Add SSE live view for latestPerAgent",
      "why": "Provide lightweight live updates without WS",
      "allowedFiles": [
        "src/gateway/http.ts",
        "src/views/latest.ts",
        "src/control/client.ts"
      ],
      "verify": [
        "node --loader ts-node/esm src/index.ts & echo $! > /tmp/courier.pid; sleep 1; timeout 3s curl -N 'http://127.0.0.1:8787/v1/live?view=latestPerAgent' || true; kill $(cat /tmp/courier.pid) || true"
      ],
      "deliverables": [
        "GET /v1/live?view=latestPerAgent streams SSE events with heartbeats"
      ]
    },
    {
      "id": "T-S1-WSERR",
      "agent": "gemini",
      "title": "WebSocket error mapping and closes",
      "why": "Predictable WS semantics on invalid frames",
      "allowedFiles": ["src/gateway/ws.ts"],
      "verify": [
        "# Manual: send malformed JSON or unknown op; server replies with error frame and may close"
      ],
      "deliverables": [
        "WS sends error frames for invalid ops and closes with reason codes"
      ]
    },
    {
      "id": "T-S1-DELAY",
      "agent": "gemini",
      "title": "Implement delayed requeue on nack",
      "why": "Enable basic retry/backoff",
      "allowedFiles": [
        "src/control/server.ts",
        "src/core/queue.ts"
      ],
      "verify": [
        "# Manual: subscribe, nack with delayMs, verify redelivery after delay"
      ],
      "deliverables": [
        "nack{id,delayMs} re-enqueues after ~delayMs"
      ]
    },
    {
      "id": "T-S1-TOKEN",
      "agent": "gemini",
      "title": "Token allowlist at edge (Bearer)",
      "why": "Demo-grade auth at gateways without core changes",
      "allowedFiles": [
        "src/gateway/http.ts",
        "src/gateway/ws.ts"
      ],
      "verify": [
        "COURIER_TOKENS=dev-local node --loader ts-node/esm src/index.ts & echo $! > /tmp/courier.pid; sleep 1; test $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/health) -eq 200; test $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8787/v1/enqueue -H 'content-type: application/json' -d '{\"to\":\"agents/Jen/inbox\",\"envelope\":{\"id\":\"e-1\",\"ts\":\"2025-10-18T00:00:00Z\",\"type\":\"notify\",\"payload\":{}}}') -eq 401; kill $(cat /tmp/courier.pid) || true"
      ],
      "deliverables": [
        "401 on missing/invalid token for protected endpoints; /health exempt"
      ]
    },
    {
      "id": "T-S1-CI",
      "agent": "gemini",
      "title": "CI smoke using watchdog",
      "why": "Green signal on PRs with non-blocking test",
      "allowedFiles": [
        ".github/workflows/ci.yml"
      ],
      "verify": [
        "# CI: npm ci && npm run test:watch"
      ],
      "deliverables": [
        "GitHub Actions workflow that runs npm run test:watch"
      ]
    },
    {
      "id": "T-S1-DOCKER",
      "agent": "gemini",
      "title": "Dockerfile + .env.dev polish",
      "why": "One-command spin-up for contributors",
      "allowedFiles": [
        "Dockerfile",
        "config/.env.dev",
        "README.md"
      ],
      "verify": [
        "# Manual: docker build && docker run -p8787:8787 -p8788:8788"
      ],
      "deliverables": [
        "Dockerfile, example env file, README run instructions"
      ]
    }
  ]
}
```
