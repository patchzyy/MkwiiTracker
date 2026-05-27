import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataFile = path.join(root, "data", "snapshots.json");

const headers = {
  "accept": "application/json,text/html;q=0.8,*/*;q=0.5",
  "user-agent": "MKWiiTracker/1.0 (+https://github.com/patchzyy/MkwiiTracker)",
};

async function fetchJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function parseWiimmfiPayload(text) {
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) {
      const rooms = json.filter((item) => item?.type === "room" && item?.is_mkw);
      const count = rooms.reduce((sum, room) => sum + Number(room.n_players || 0), 0);
      if (rooms.length > 0 && Number.isFinite(count)) {
        return {
          count,
          detail: `${rooms.length} rooms from Wiimmfi JSON stats`,
        };
      }
    }

    const count = Number(json?.wiimmfi ?? json?.mariokartwii ?? json?.count ?? json?.online);
    if (Number.isFinite(count)) {
      return {
        count,
        detail: "read count from configured Wiimmfi source",
      };
    }
  } catch {
    // Not JSON; fall through to the official text table parser.
  }

  if (/Just a moment|Enable JavaScript and cookies|security verification/i.test(text)) {
    throw new Error("blocked by Cloudflare challenge");
  }

  const rows = text.match(/\|RMC[A-Z0-9]\|/g) || [];
  if (!text.includes("!id4!") || rows.length === 0) {
    throw new Error("could not parse Wiimmfi text rows");
  }

  return {
    count: rows.length,
    detail: "counted rows from Wiimmfi text stats",
  };
}

async function getRwfc() {
  const groups = await fetchJson("http://rwfc.net/api/groups");
  const online = groups.reduce((total, group) => {
    const players = Object.values(group.players || {});
    return total + players.reduce((sum, player) => sum + Number(player.count || 1), 0);
  }, 0);

  return {
    count: online,
    status: "ok",
    detail: `${groups.length} rooms`,
  };
}

async function getNewwfc() {
  const stats = await fetchJson("https://newwfc.xyz/api/stats");
  const count = Number(stats?.mariokartwii?.online ?? stats?.global?.online);
  if (!Number.isFinite(count)) throw new Error("missing mariokartwii.online");

  return {
    count,
    status: "ok",
    detail: `${stats?.mariokartwii?.groups ?? "unknown"} groups`,
  };
}

async function getWiimmfi() {
  const urls = [
    process.env.WIIMMFI_STATS_URL,
    "https://wiimmfi.de/stats/mkwx?m=json",
    "https://wiimmfi.de/stats/game/mariokartwii/text",
  ].filter(Boolean);

  const errors = [];
  for (const url of urls) {
    try {
      const text = await fetchText(url);
      const parsed = parseWiimmfiPayload(text);

      return {
        count: parsed.count,
        status: "ok",
        detail: parsed.detail,
      };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  throw new Error(errors.join("; "));
}

async function safely(name, getter) {
  try {
    return await getter();
  } catch (error) {
    return {
      count: null,
      status: error.message,
      detail: "collector could not read this source",
    };
  }
}

async function readSnapshots() {
  try {
    const existing = JSON.parse(await readFile(dataFile, "utf8"));
    return Array.isArray(existing.snapshots) ? existing.snapshots : [];
  } catch {
    return [];
  }
}

function pruneSnapshots(points) {
  const newest = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  return points.filter((point) => {
    const time = new Date(point.timestamp).getTime();
    return Number.isFinite(time) && newest - time <= maxAge;
  });
}

const [wiimmfi, rwfc, newwfc] = await Promise.all([
  safely("wiimmfi", getWiimmfi),
  safely("rwfc", getRwfc),
  safely("newwfc", getNewwfc),
]);

const snapshot = {
  timestamp: new Date().toISOString(),
  counts: {
    wiimmfi: wiimmfi.count,
    rwfc: rwfc.count,
    newwfc: newwfc.count,
  },
  sources: {
    wiimmfi: { status: wiimmfi.status, detail: wiimmfi.detail },
    rwfc: { status: rwfc.status, detail: rwfc.detail },
    newwfc: { status: newwfc.status, detail: newwfc.detail },
  },
};

const snapshots = pruneSnapshots([...(await readSnapshots()), snapshot]);
await mkdir(path.dirname(dataFile), { recursive: true });
await writeFile(dataFile, `${JSON.stringify({ snapshots }, null, 2)}\n`);

console.log(`Collected ${JSON.stringify(snapshot.counts)}`);
