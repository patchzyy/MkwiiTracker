# mkwii tracker

Tiny GitHub Pages tracker for MKWii distribution player counts.

## Wiimmfi source

The exact Wiimmfi MKWii count comes from:

```text
https://wiimmfi.de/stats/game/mariokartwii/text
```

That page is currently protected by Cloudflare, so GitHub Actions often receives a `403` challenge page instead of the stats table. The collector intentionally does not fall back to `mkw-ana query @-1`, because that only counts a smaller matchmaking-visible slice and can be far below the full Wiimmfi website number.

For consistent Wiimmfi updates, set a repository secret named `WIIMMFI_STATS_URL` to a trusted mirror/API that returns either:

```json
{ "count": 147 }
```

or the same text table format as Wiimmfi's `/text` endpoint.

