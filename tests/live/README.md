# Live provider smokes

These tests are excluded from `pnpm test`. They incur Fal/Stability charges when run.

```bash
PIXELFORGE_LIVE_PROVIDERS=1 FAL_KEY=... STABILITY_API_KEY=... pnpm test:live
```

Do not log secrets or result URLs. A skipped test is not a pass. See `docs/PHASE_4_8.md`.
