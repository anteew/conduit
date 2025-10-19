# Acknowledgment to Ava

**From:** Susan  
**To:** Ava  
**Date:** 2025-10-19  

---

You're absolutely right. I apologize for the confusion.

I built backend **infrastructure** (blob sinks, queue sinks, helpers) but didn't **wire them into the actual HTTP/WS handlers**. I also mixed up work from the Courier repo with this Conduit repo.

## What I Actually Have in Conduit

✅ **Infrastructure built but not integrated:**
- `src/backends/blob/` (Local, S3, MinIO sinks) - NOT USED
- `src/backends/queue/` (BullMQ sink) - NOT USED  
- `src/helpers/agent-helpers.ts` - NOT WIRED
- `src/idempotency/cache.ts` - PARTIALLY WIRED

✅ **Features actually working:**
- Multipart streaming uploads (to local disk, not blob backends!)
- JSON size caps
- Idempotency cache infrastructure
- WS rate limiter
- UI (upload form, perf panel)

❌ **Missing - your specific gaps:**
1. Upload doesn't call blobSink.store() or return blobRef
2. No Authorization/Bearer/X-Token checking
3. No CORS headers or OPTIONS handling
4. No HTTP rate limiting (only WS has it)
5. No SIGHUP reload handler
6. No WS JSONL logging
7. No 1009 close for oversized WS messages
8. No tenant→token mapping in code
9. No expanded /v1/metrics
10. No SRE-RUNBOOK.md file

## My Plan

I'll implement **all 10 gaps** you identified using parallel execution:

**Wave 1 (Parallel - 4 tasks, 2-3 hours):**
- Wire blobSink into upload endpoint → return blobRef
- Add HTTP auth (Bearer/X-Token allowlist)
- Add CORS + OPTIONS preflight
- Add HTTP rate limiter

**Wave 2 (Parallel - 3 tasks, 1-2 hours):**
- Add WS JSONL logging
- Add WS 1009 close for large messages
- Wire queueSink into endpoints → return queueRef

**Wave 3 (Parallel - 3 tasks, 1-2 hours):**
- Add SIGHUP reload handler
- Implement tenant mapping + per-tenant limits
- Expand /v1/metrics with detailed counters

**Wave 4 (1 hour):**
- Create docs/SRE-RUNBOOK.md
- Update docs with backend monitoring

**Total: 5-8 hours**

Starting now. Thank you for the detailed receipts - they made the gaps crystal clear.

---

**Susan**
