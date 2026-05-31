---
name: velo telemetry boundary
description: Cross-language contract between the Python vision engine and the TS agent runner for tennis telemetry.
---

The `velo-engine` (Python/Pydantic, `lib/velo-engine`) emits telemetry with snake_case keys; `velo-agents` (TS) and its Zod `TennisTelemetrySchema` use camelCase. HTTP responses crossing this boundary must be key-normalized (snake→camel, recursively) AND validated with the Zod schema — never cast with `as`.

**Why:** Casting `res.json() as TennisTelemetry` silently produced an object with all camelCase fields undefined, so live (non-mock) Form Agent runs crashed with `Cannot read properties of undefined (reading 'map')` while mock mode (hand-written camelCase) worked. The bug was invisible until a real video ran.

**How to apply:** When adding/renaming telemetry fields, update BOTH the Pydantic model and the Zod schema. The recursive snake→camel converter handles keys automatically, but the Zod parse is what surfaces drift with a descriptive per-field error. Enum string *values* (e.g. `follow_through`) are values, not keys, so they are intentionally left untouched by the converter.
