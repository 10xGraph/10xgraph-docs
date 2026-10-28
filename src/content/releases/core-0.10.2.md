---
package: core
version: "0.10.2"
date: 2026-10-22
summary: Pillow is now optional and moved to the images extra, which makes every install and Docker image about 20 MB smaller. No API changes.
breaking: false
---

Smaller installs: Pillow is now optional. No API changes.

### Changed

- **Pillow is no longer a required dependency.** It moved to the `images` extra, which cuts about 20 MB from every install and Docker image. Image resizing, EXIF orientation and format conversion in the media processor still work when Pillow is present. Without it, images pass through unchanged. To keep the old behaviour, install `10xgraph[images]` (also included in `10xgraph[all]`).
