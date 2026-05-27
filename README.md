# mkwii tracker

Tiny GitHub Pages tracker for MKWii distribution player counts.

## Wiimmfi source

The default Wiimmfi MKWii count comes from:

```text
https://wiimmfi.de/stats/mkwx?m=json
```

The collector sums `n_players` across MKWii rooms in that JSON response. It intentionally does not fall back to `mkw-ana query @-1`, because that only counts a smaller matchmaking-visible slice and can be far below the full Wiimmfi website number.

If the Wiimmfi JSON endpoint changes, set a repository secret named `WIIMMFI_STATS_URL` to a trusted mirror/API that returns either:

```json
{ "count": 147 }
```

or the same text table format as Wiimmfi's `/text` endpoint.
