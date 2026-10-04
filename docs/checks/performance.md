# Performance: query counts and TTFB

Baseline recorded 2026-10-04 against the code before T-0170.

| loader | before (N = 1 / 5 / 50) | after (N = 1 / 5 / 50) |
| --- | --- | --- |
| listSessions | 4 / 16 / 151 | 4 / 16 / 151 |
| dashboard | 11 / 43 / 403 | 11 / 43 / 403 |
| agents | 12 / 44 / 404 | 12 / 44 / 404 |
