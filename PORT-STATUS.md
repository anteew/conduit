# Porting Courier Features to Conduit

**Status:** In Progress  
**From:** /srv/repos0/courier  
**To:** /srv/repos0/conduit  

## What Needs to be Ported

Based on Ava's HARDENING-ISSUES.md, these features exist in Courier but need to be in Conduit:

### ✅ Already Ported
1. **Tenancy module** - src/tenancy/tenant-manager.ts

### 🔄 In Progress
2. **HTTP Auth** - Extract from Courier gateway/http.ts → Conduit connectors/http.ts
3. **CORS** - Extract CORS logic
4. **HTTP Rate Limiter** - Extract token bucket implementation
5. **WS JSONL Logging** - Extract from Courier gateway/ws.ts
6. **WS 1009 Close** - Message size cap logic
7. **Expanded Metrics** - Enhanced /v1/metrics endpoint
8. **SIGHUP Reload** - Already added to Conduit src/index.ts
9. **SRE Runbook** - Copy docs/SRE-RUNBOOK.md
10. **Examples** - Port examples/github-issues/

## Strategy

Rather than copy-paste, I'll extract the key patterns and integrate cleanly into Conduit's existing structure.

**Next:** Add auth, CORS, rate limiting to Conduit's http.ts in a clean, integrated way.
