# KERN Storage

Persistence for monitor state and network snapshots.

## Backends

| Backend | Env | Use case |
|---------|-----|----------|
| **Local files** (default) | `KERN_DATA_DIR` | Dev, single-node API |
| **S3-compatible** | `KERN_STORAGE_BACKEND=s3` | MinIO, Cloudflare R2, AWS S3 — **you own the bucket** |

## Local layout

| Key | Purpose |
|-----|---------|
| `monitor-store.json` | Connection config, events, incidents |
| `network-snapshots/` | Per-snapshot JSON objects (or legacy `network-snapshots.jsonl`) |

Retention when running locally (or on S3):

| Data | Limit | Disk pruned? |
|------|-------|----------------|
| Events (`monitor-store.json`) | 300 | yes — on each save |
| Incidents | 100 (all open kept + newest resolved) | yes — on each save |
| Network snapshots | 120 | yes — on each snapshot save |

Legacy `network-snapshots.jsonl` is no longer written; once per-file snapshots exist it is deleted automatically. Safe to remove manually if you still have one from an older build.

The API writes a snapshot on every network poll (~3s), so 120 snapshots ≈ **6 minutes** of history at default poll rate.

## S3-compatible storage

Set `KERN_STORAGE_BACKEND=s3` and point at your bucket (MinIO, R2, AWS, etc.):

```bash
export KERN_STORAGE_BACKEND=s3
export KERN_S3_BUCKET=kern-data
export KERN_S3_ACCESS_KEY_ID=...
export KERN_S3_SECRET_ACCESS_KEY=...
export KERN_S3_ENDPOINT=http://127.0.0.1:9000   # MinIO / custom endpoint
export KERN_S3_REGION=us-east-1
export KERN_S3_PREFIX=production                 # optional key prefix
```

Standard `AWS_*` variables are also supported (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_ENDPOINT_URL`).

Objects are stored under:

```text
{prefix}/monitor-store.json
{prefix}/network-snapshots/{timestamp}.json
```

Your observability data stays in **your** object store — not locked to KERN-hosted storage.

## Future

Postgres or ClickHouse for multi-cluster analytics queries — this module remains the persistence boundary until then.
