---
package: core
version: "0.10.3"
date: 2026-10-22
summary: Python 3.14 and 3.15 are officially supported, and injectq 0.5 is allowed. No API changes.
breaking: false
---

Python 3.14 and 3.15 support. No API changes.

### Added

- **Python 3.14 and 3.15 are officially supported.** The full test suite runs on 3.12, 3.13, 3.14 and 3.15 in CI, and the package classifiers list all four.

### Changed

- **`injectq` 0.5 is now allowed** (`injectq>=0.4.0,<0.6`). 0.5.0 fixes a crash under Python 3.15 global lazy imports (`PYTHON_LAZY_IMPORTS=all`). 0.4.x keeps working.
- Replaced `asyncio.iscoroutinefunction` and the event-loop policy API, both removed in Python 3.16. The sync `CompiledGraph.stream()` no longer changes the thread's current event loop. No behaviour change otherwise.
