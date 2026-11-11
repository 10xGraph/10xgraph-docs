---
title: Tenancy and access
seoTitle: "Tenancy, roles and reach in 10xGraph"
description: How 10xGraph turns a verified identity into roles, permissions and reach, maps tenant claims to tenant columns, filters data in storage, and what stays your job.
section: Concepts
group: "Platform"
order: 180
updated: "2026-11-10"
faq:
  - q: "Is 10xGraph multi-tenant by default?"
    a: "No. By default a caller reaches only their own data (reach own). To isolate organizations or projects, you declare tenant columns on the checkpointer and store and map tenant claims in auth. Isolation is then enforced for the columns you declare."
  - q: "What does a caller get when they ask for another tenant's thread?"
    a: "A 404, the same answer as for an id that does not exist. A 403 means the caller's role lacks the permission for the route."
  - q: "Do I need Postgres row-level security?"
    a: "No. The storage filter is always on. Row-level security is an opt-in extra layer on PgCheckpointer and PgVectorStore."
---

Access in 10xGraph has two questions. **What may this role do** is answered by permissions. **Whose data may this caller see** is answered by reach and tenant columns. Both start from one verified identity.

## Identity comes from your auth class

When `auth` is configured, the server calls your auth class on every request. `method` is `jwt` or `custom` (a `BaseAuth` subclass); the claims it returns must include `user_id`. The server turns those claims into an `Identity` and puts it in `config["user"]`. Clients cannot set that key, so nothing in a request body can claim to be another user. Auth is off unless you configure it; the production template turns it on.

## Roles, permissions and reach

A role in `auth.roles` has a list of permissions and one reach.

- **Permissions** name an action on a resource, such as `graph:invoke`, `threads:read`, `files:upload` or `tasks:trigger`. A missing permission answers 403. Without roles, every caller gets the default set (everything except `admin:*`) with reach `own`.
- **Reach** is `own`, `tenant` or `all`. `own` is the caller's data only. `tenant` is every user who shares the caller's tenant values. `all` is everything. Reach is required on each role and never falls back to something wider.
- Reach widens reads, lists and deletes. Runs and writes to state or messages stay on the caller's own threads, admins included.

## Tenant claims and tenant columns

Reach `tenant` needs to know what a tenant is. You declare it in two places that must match:

1. `auth.tenant_claims` lists the token claims that identify the tenant, for example `org_id`. A token missing a configured claim is rejected with 401.
2. `tenant_columns` on `PgCheckpointer` and `PgVectorStore` declares matching columns. Their values are filled only from the verified identity, never from request config, state or model output.

The server compares the two at boot and refuses to start in production when they disagree. See [Multi-tenant data](/docs/guides/multi-tenant-data).

## Storage filters every query

Ownership is enforced in storage, not only in route code. Each query filters by the caller's reach, so a thread, message, memory, file or run outside it answers `404` and the graph never starts. The 404 is the same for foreign and unknown ids, so a caller cannot probe which ids exist. See [What is thread isolation?](/docs/glossary/what-is-thread-isolation).

## Optional Postgres row-level security

The storage filter is always on. For defense in depth you can set `row_level_security=True` on `PgCheckpointer` and `PgVectorStore`. Postgres then enforces the tenant columns itself, so a query that forgets the filter still sees no foreign rows. It costs one transaction per call, and a connection role with `BYPASSRLS` skips it. Roll it out for all pods at once. Details are in [Multi-tenant data](/docs/guides/multi-tenant-data).

## What stays your job

- Choosing and verifying the identity provider, and issuing tokens with the claims you map.
- Defining roles that fit your product, and declaring tenant columns before you store tenant data.
- Backfilling rows created before you added a tenant column; they are hidden from tenant-scoped callers until you do.
- Running Postgres and Redis with sensible network and role settings, including a role without `BYPASSRLS`.
- Authorization rules inside your own tools, which the server cannot see.

## Next steps

- [Authentication and authorization](/docs/server/auth): configure `auth`, roles and `tenant_claims`.
- [Multi-tenant data](/docs/guides/multi-tenant-data): declare tenant columns and turn on row-level security.
- [Authorization scopes](/docs/guides/authorization-scopes): permissions per role, step by step.
- [Security and validators](/docs/concepts/security-and-validators): input validation and the production template.
