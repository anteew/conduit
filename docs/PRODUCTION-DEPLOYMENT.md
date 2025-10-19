# Production Deployment Guide

**For mkolbol ecosystem deployments**

This guide covers production deployment of Conduit as the edge gateway for mkolbol-based systems.

## WebSocket Sticky Sessions (T5053)

### Why Sticky Sessions Matter

WebSocket connections are **stateful** and must route to the same Conduit instance for their lifetime:
- Credit window tracking per connection
- Subscribe state per connection  
- Delivery guarantees tied to specific connection

### Load Balancer Configuration

#### nginx

```nginx
upstream conduit_ws {
    # IP hash ensures same client → same backend
    ip_hash;
    
    server conduit1:9088 max_fails=3 fail_timeout=30s;
    server conduit2:9088 max_fails=3 fail_timeout=30s;
    server conduit3:9088 max_fails=3 fail_timeout=30s;
}

server {
    listen 443 ssl http2;
    server_name ws.example.com;
    
    location /v1/subscribe {
        proxy_pass http://conduit_ws;
        
        # WebSocket upgrade
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Preserve client IP
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Timeouts (keep-alive for long connections)
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        
        # Buffering off for real-time
        proxy_buffering off;
    }
}
```

#### HAProxy

```haproxy
frontend ws_frontend
    bind *:443 ssl crt /etc/haproxy/certs/
    
    # Sticky sessions via cookie
    acl is_websocket hdr(Upgrade) -i WebSocket
    use_backend conduit_ws if is_websocket

backend conduit_ws
    # Sticky session via cookie
    cookie SERVERID insert indirect nocache
    
    server conduit1 10.0.1.10:9088 check cookie s1
    server conduit2 10.0.1.11:9088 check cookie s2
    server conduit3 10.0.1.12:9088 check cookie s3
    
    # Health check
    option httpchk GET /health
    http-check expect status 200
```

#### AWS Application Load Balancer

```terraform
resource "aws_lb_target_group" "conduit_ws" {
  name     = "conduit-ws"
  port     = 9088
  protocol = "HTTP"
  vpc_id   = var.vpc_id
  
  # Sticky sessions (required for WebSocket)
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400  # 1 day
    enabled         = true
  }
  
  health_check {
    path                = "/health"
    protocol            = "HTTP"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener" "ws" {
  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = var.certificate_arn
  
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.conduit_ws.arn
  }
}
```

### Kubernetes / Service Mesh

```yaml
apiVersion: v1
kind: Service
metadata:
  name: conduit-ws
  annotations:
    # For nginx-ingress
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "route"
    nginx.ingress.kubernetes.io/session-cookie-hash: "sha1"
spec:
  type: ClusterIP
  sessionAffinity: ClientIP  # IP-based stickiness
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 86400  # 24 hours
  ports:
    - port: 9088
      targetPort: 9088
  selector:
    app: conduit
```

### Connection Draining on Deployment

**Rolling update strategy:**

```yaml
# deployment.yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0  # Keep all pods available during update
  
  template:
    spec:
      terminationGracePeriodSeconds: 300  # 5 minutes for graceful shutdown
      
      containers:
      - name: conduit
        lifecycle:
          preStop:
            exec:
              # Signal graceful shutdown, wait for WS connections to drain
              command: ["/bin/sh", "-c", "kill -SIGTERM 1 && sleep 60"]
```

**Conduit graceful shutdown** (already implemented in T5060):
1. Receive SIGTERM
2. Stop accepting new connections
3. Set health endpoint to "draining"
4. Wait for existing WS connections to close (or timeout)
5. Exit after drain or 60s timeout

### Monitoring Sticky Sessions

**Check if stickiness is working:**

```bash
# Test that same client hits same backend
for i in {1..10}; do
  curl -s http://lb.example.com/health | jq -r '.instance'
done
# Should show same instance ID 10 times
```

**WebSocket connection distribution:**

```bash
# On each Conduit instance
curl -s http://localhost:9087/v1/metrics | jq '.ws.connections.active'
```

Should be roughly even across instances (within ~20%).

### Common Issues

**Problem:** WebSocket disconnects on deployment  
**Solution:** Use rolling updates with grace period

**Problem:** Uneven connection distribution  
**Solution:** Check LB algorithm (round-robin vs IP hash vs least-conn)

**Problem:** Some connections never drain  
**Solution:** Add hard timeout in preStop (force close after 5min)

## Multi-Instance Considerations

### What Scales Horizontally

✅ **HTTP requests** - Fully stateless, scale freely  
✅ **Blob uploads** - Stateless, use shared storage (S3)  
✅ **Queue submissions** - Stateless, shared Redis/BullMQ  

### What Requires Stickiness

⚠️ **WebSocket connections** - Stateful, need sticky sessions  
⚠️ **Credit windows** - Per-connection state  
⚠️ **SSE streams** - Per-connection event streams  

### Shared State (External)

- **BlobSink** → S3/MinIO (shared across instances)
- **QueueSink** → Redis/BullMQ (shared across instances)
- **Control Protocol Backend** → Courier (can be single or clustered)

### Instance-Local State

- WebSocket connection registry
- Active upload tracking
- Rate limit buckets (consider Redis for distributed rate limiting)

## Deployment Checklist

- [ ] Set CONDUIT_BLOB_BACKEND to s3 or minio (not local)
- [ ] Configure Redis HA (Sentinel or Cluster)
- [ ] Enable sticky sessions on load balancer
- [ ] Set terminationGracePeriodSeconds ≥ 60s
- [ ] Configure health/readiness probes
- [ ] Enable structured logging (CONDUIT_HTTP_LOG, CONDUIT_WS_LOG)
- [ ] Set up metrics scraping (/v1/metrics)
- [ ] Configure alerting (see SRE-RUNBOOK.md)
- [ ] Test rolling update doesn't drop WebSocket connections
- [ ] Verify blob storage is accessible from all instances
- [ ] Verify Redis is accessible from all instances

## Example Production Architecture

```
                    ┌─────────────┐
                    │   AWS ALB   │
                    │  (Sticky)   │
                    └──────┬──────┘
                           │
        ┏━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━┓
        ↓                                      ↓
┌───────────────┐                    ┌───────────────┐
│  Conduit-1    │                    │  Conduit-2    │
│  (Pod/EC2)    │                    │  (Pod/EC2)    │
└───────┬───────┘                    └───────┬───────┘
        │                                    │
        └──────────┬────────────┬────────────┘
                   ↓            ↓
           ┌──────────┐   ┌──────────┐
           │  Redis   │   │    S3    │
           │(BullMQ)  │   │ (Blobs)  │
           └──────────┘   └──────────┘
                   ↓
           ┌──────────┐
           │ Courier  │
           │  (Core)  │
           └──────────┘
```

All shared state in external services; Conduit instances stateless except for active connections.

---

**Created for mkolbol ecosystem production deployments**  
**Last updated:** 2025-10-19
