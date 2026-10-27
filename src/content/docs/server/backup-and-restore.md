---
title: Backup and restore
seoTitle: "Back up and restore 10xGraph deployments"
description: "What 10xGraph persists, how to back up the Postgres tables that hold threads and state, and how to restore or roll back a running deployment safely."
section: "API server"
group: "Operate"
order: 180
label: Backup and restore
updated: "2026-10-27"
faq:
  - question: "What happens if I restore an old Postgres backup with Redis still running?"
    answer: "The Redis cache can hold state newer than the restored database. Postgres is the source of truth and a failed version check invalidates the cache entry, but flush the 10xGraph Redis database before restoring so no stale entries survive."
  - question: "Can I restore a single thread without a full restore?"
    answer: "Yes. Restore the dump into a scratch database, then copy that thread's rows from the thread tables into production using SQL."
  - question: "How often should I test my restore process?"
    answer: "At least quarterly, or before any schema-changing release. A backup you have never restored is a hypothesis, not a recovery plan."
---

## What is durable and what is not

10xGraph persists agent conversations and execution state across two storage layers, each serving a different purpose. Understanding what each holds and which backups to keep is essential for disaster recovery.

For how durable state supports restarts and multiple replicas, see [scaling and reliability](/docs/production/scaling).

| Layer | Contents | Durable | Back up |
| --- | --- | --- | --- |
| **Postgres** | Threads, state, messages, tool-execution ledger, schema version | Yes | **Yes** |
| **Redis** | Hot cache of recent state, default TTL 24h | No | No |
| **Vector store** (Qdrant, Mem0) | Long-term memories | Yes, in that system | Yes, with that system's own tooling |
| **Media store** | Uploaded files | Depends on backend | Yes, if local disk |

## The cache and the version guard

Redis is a read-through cache in front of Postgres, not a second source of truth. It holds the most recent state for each thread and expires entries after 24 hours by default. If Redis disappears, the next read refills it from Postgres: no data loss, only latency.

However, restoring Postgres from an older snapshot while Redis and workers are still running is unsafe. Each state row has a per-thread `version` that increases on every write, and writes are compare-and-swap: a write that expected a version the database no longer has is rejected with `StaleStateError` (HTTP 409 from the API). Reads of the latest state come from Postgres, and the checkpointer drops the cached entry when it hits a conflict. Even so, a run that started before the restore can fail, and cached entries can still reflect pre-restore state until they expire.

Flush the cache before restoring. `FLUSHDB` clears the whole Redis database selected by the URL, so only run it if that database is dedicated to 10xGraph:

```bash
redis-cli -u "$REDIS_URL" FLUSHDB
```

## Tables and schema

10xGraph stores all data in five tables owned by `PgCheckpointer`. With the default `public` schema, they are:

| Table | Purpose | Key columns |
| --- | --- | --- |
| `threads` | Thread metadata and ownership | `thread_id` (PK), `user_id` (indexed) |
| `states` | Serialized graph state snapshots | `thread_id`, `version` (unique together) |
| `messages` | Conversation history | `thread_id` (indexed), `message_id` (PK) |
| `tool_executions` | Idempotency ledger | `(thread_id, tool_call_id)` (composite PK) |
| `schema_version` | Schema migration history | `version` (PK), `applied_at` |

The `version` column in `states` is the linchpin of optimistic concurrency control. It is a per-thread counter that increases on every state write. Any two concurrent writes to the same thread will have seen different versions as their expected baseline, so one will collide on the unique `(thread_id, version)` constraint and fail. The losing write is rejected with `StaleStateError`.

### Schema versioning

The current schema version is **3**. If you pass a custom `schema=` to `PgCheckpointer`, the tables are schema-qualified (e.g., `myschema.threads`), and your backup must target that schema:

```bash
pg_dump "$DATABASE_URL" --format=custom \
  --schema myschema --exclude-schema public \
  --file=custom-schema.dump
```

Schema migrations apply automatically on the first startup of an upgraded server. Always back up before upgrading so you can roll back if a migration causes problems.

### User isolation

The `threads` table carries a `user_id` column (`states`, `messages` and `tool_executions` reference their thread through `thread_id`). By default, `PgCheckpointer` enforces user isolation: a request cannot read or delete another user's threads even if they know the `thread_id`.

If you have disabled user isolation (`enforce_user_isolation=False`), the `user_id` column still exists but is ignored for access control. Backup and restore procedures are unaffected.

---

## Back up

### Routine backups

Take full backups regularly using the custom format, which supports parallel restore and per-table restoration:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="10xgraph-$(date +%Y%m%d-%H%M).dump"
```

If your database is shared with other applications, back up only the tables 10xGraph owns to avoid unnecessary data:

```bash
pg_dump "$DATABASE_URL" --format=custom \
  --table=threads \
  --table=states \
  --table=messages \
  --table=tool_executions \
  --table=schema_version \
  --file=10xgraph-tables-$(date +%Y%m%d-%H%M).dump
```

Always verify a backup is readable before you trust it:

```bash
pg_restore --list 10xgraph-tables.dump | head
```

A backup you have never restored is a hypothesis, not a recovery plan.

### Before a release upgrade

Always back up before applying a schema migration. Migrations run automatically on the first startup of a new version:

```bash
# Full dump before upgrading
pg_dump "$DATABASE_URL" --format=custom > 10xgraph-pre-upgrade.dump

# Then upgrade your server
pip install --upgrade "10xgraph[pg_checkpoint]"
10xgraph dev --no-open
```

If something goes wrong during migration, you can restore from the pre-upgrade dump. See [upgrading to 1.0](/docs/project/upgrade-to-1.0) for migration details.

### Automate with your platform

Whatever recovery mechanism your platform offers is usually better than cron on a single box:

- **Cloud managed Postgres:** point-in-time recovery, automated backups, cross-region replication
- **Kubernetes:** a sidecar CronJob that runs `pg_dump`, or rely on your managed database
- **VPS:** `pg_dump` to object storage (S3, GCS) on a schedule

What matters is knowing your recovery point objective (RPO) and having tested a restore against it.

---

## Restore

### Full restoration

Restoring production data under live traffic corrupts state. Ensure all workers are stopped before you restore.

Runs in flight hold the state version they read. If you restore Postgres to a point before that version was written, their next write fails the optimistic concurrency check, and cached entries may still reflect pre-restore state.

This is the safe restore procedure:

```bash
# 1. Stop all traffic. Scale workers to zero instead of draining gracefully.
kubectl scale deployment/my-agent --replicas=0

# 2. Flush the Redis cache so it cannot serve stale versions.
redis-cli -u "$REDIS_URL" FLUSHDB

# 3. Restore the dump.
pg_restore --clean --if-exists --no-owner \
  --dbname "$DATABASE_URL" 10xgraph-tables.dump

# 4. Verify the schema version matches the code you are running.
psql "$DATABASE_URL" -c "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;"

# 5. Bring up one worker and smoke-test an existing thread.
kubectl scale deployment/my-agent --replicas=1
# Test: invoke an existing thread and confirm it continues the conversation

# 6. Scale up once confident.
kubectl scale deployment/my-agent --replicas=3
```

The `--clean` flag drops tables before restoring, preventing primary key collisions if you restore over partial data. `--if-exists` suppresses errors if tables do not exist yet (safe idempotency).

### Restore a single thread

Full restores are often overkill. To recover a single conversation from a backup:

1. Restore the dump into a scratch database:

```bash
createdb 10xgraph_scratch
pg_restore --no-owner --dbname 10xgraph_scratch 10xgraph-tables.dump
```

2. Export the thread and its history to CSV:

```sql
-- From the scratch database
\copy (SELECT * FROM threads WHERE thread_id = 'thr_abc123') TO 'threads.csv' CSV HEADER
\copy (SELECT * FROM states WHERE thread_id = 'thr_abc123') TO 'states.csv' CSV HEADER
\copy (SELECT * FROM messages WHERE thread_id = 'thr_abc123') TO 'messages.csv' CSV HEADER
```

3. Import into production, **only if the thread is not currently running**:

```bash
psql "$DATABASE_URL" <<EOF
-- Import from the CSV files
\copy threads FROM 'threads.csv' CSV HEADER
\copy states FROM 'states.csv' CSV HEADER
\copy messages FROM 'messages.csv' CSV HEADER
EOF
```

Keep the `version` column intact. Editing or rewriting it defeats the concurrency guard and can cause future writes to fail mysteriously. If you must restore a specific version, use `UPDATE` and ensure the new version is higher than any version in production for that thread.

---

## Retention and data deletion

### Delete a user's data

Threads carry a `user_id` field indicating the owner. The `states`, `messages` and `tool_executions` tables reference `threads` with `ON DELETE CASCADE`, so deleting the thread rows removes everything else:

```sql
DELETE FROM threads WHERE user_id = 'user-123';
```

Then handle related data outside Postgres:

1. **Redis:** Deleting a thread through the checkpointer clears its cache entry. If you delete rows with SQL, remove the cached keys yourself or flush the cache.
2. **Vector store:** Delete the user's memories from Qdrant or Mem0 using that system's API.
3. **Media store:** Delete uploaded files from cloud storage or local disk.

These deletions are not transactional with Postgres, so implement a retry strategy for media deletion.

### State history pruning

By default, `PgCheckpointer` keeps the 20 most recent state snapshots per thread and deletes older ones on write. This is the `state_history_limit` parameter. Older snapshots are dropped to prevent unbounded table growth but kept long enough for typical retries and concurrency conflicts.

To change the limit (e.g., keep 50 states):

```python
checkpointer = PgCheckpointer(
    postgres_dsn="postgresql://...",
    redis_url="redis://...",
    state_history_limit=50
)
```

Large state_history_limit values trade storage for more history available during retries. The table will grow proportionally.

---

## Test your restore

A restoration procedure you have never tested is a hope, not a plan. Test at least once per quarter or before any major release.

1. Restore the latest backup into a scratch database (not production).
2. Point a staging server at the scratch database.
3. Invoke an existing thread and send a follow-up message.
4. Verify the response includes context from before the restore (the model references earlier messages).

If step 4 fails, your backup is incomplete. Usually, the `messages` table was excluded from a table-scoped dump.

Example test command:

```bash
# Restore to scratch
createdb 10xgraph_test
pg_restore --no-owner --dbname 10xgraph_test 10xgraph-tables.dump

# Point the staging server's checkpointer DSN at postgresql://localhost/10xgraph_test

# Invoke an existing thread
curl -X POST http://localhost:8000/v1/graph/invoke \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": [{"type": "text", "text": "Continue the conversation"}]}],
    "config": {"thread_id": "thr_existing_id"}
  }'

# Confirm the response includes old context
```

---

## Related

- [Configuring checkpointing](/docs/guides/set-up-checkpointing)
- [Durability and concurrency](/docs/guides/durability-and-concurrency)
- [Deploy on Kubernetes](/docs/server/kubernetes)
- [Production checklist](/docs/server/production-checklist)
- [Environment variables](/docs/reference/api-cli/environment)
