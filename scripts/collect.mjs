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
  const html = await fetchText("https://wiimmfi.de/game");
  if (/Just a moment|Enable JavaScript and cookies/i.test(html)) {
    throw new Error("blocked by Cloudflare challenge");
  }

  const compact = html.replace(/\s+/g, " ");
  const row = compact.match(/Mario\s+Kart\s+Wii[\s\S]{0,500}?(\d+)\s+(?:players?|online)/i);
  if (!row) throw new Error("could not parse Mario Kart Wii count");

  return {
    count: Number(row[1]),
    status: "ok",
    detail: "parsed from Wiimmfi game page",
  };
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
