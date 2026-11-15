---
package: core
version: "1.0.0"
date: 2026-11-16
summary: The first stable release of the framework. The public API does not break before 2.0. Since rc7, Claude reasoning is readable by default and Gemini takes a base_url.
breaking: true
---

The first stable release of `10xgraph`. From 1.0 the public API does not break before 2.0, and anything removed is deprecated first: see [Stability and deprecation policy](/docs/project/stability).

```bash
pip install -U 10xgraph 10xgraph-api
```

Released with `10xgraph-api` 1.0.0 and `10xgraph-client` 1.0.0. Python 3.12 to 3.15. Coming from 0.10, read the [upgrade guide](/docs/project/upgrade-to-1.0): the breaking changes are listed in the release candidates below. Coming from 1.0.0rc7, nothing breaks.

### Added

- **`base_url` for the Google provider.** `Agent(provider="google", base_url=...)` sets the base URL on the Gemini Developer API and Vertex AI clients, so Gemini calls can go through proxies, gateways such as LiteLLM, self-hosted endpoints or mock servers.

### Fixed

- **Claude reasoning is readable by default.** Current Claude models default `thinking.display` to `"omitted"`, so with `reasoning_config=True` (or unset) the reasoning block had an empty summary and only a signature. The default now sends `display: "summarized"`; thinking cost is unchanged. An explicit `reasoning_config` dict sends `display` only when it has a `display` key, and a `thinking` passed to the Agent is used as given.
- **A tool's returned dict reaches the model unchanged.** `status`, `error`, `success` and `is_error` were removed from a dict result before the model saw it; they are now only read to set `is_error`.
- **`ReactAgent`, `StructuredOutputAgent` and `PlanActReflectAgent` send reasoning parameters on Chat Completions only when `reasoning_config` is set**, so non-reasoning models on vLLM, Ollama or Groq no longer answer 400.
- **`InMemoryCheckpointer` and `SqliteCheckpointer` report an existing thread as not new**, so `is_new_thread` is correct and a thread name generator no longer renames the thread on every call.
- **A NUL character or lone surrogate no longer breaks a thread.** In client input and caller state it is refused with a `ValidationError` (type `invalid_character`). In model and tool output it is cleaned, and a thread already stuck repairs itself on its next call.
- **`CloudMediaStore`** recognises a missing object from the stdlib download fallback and deletes an owner's index object with the owner's last file.
