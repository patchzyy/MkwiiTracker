import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const root = process.cwd();
const dataFile = path.join(root, "data", "snapshots.json");
const execFileAsync = promisify(execFile);

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
  let text;
  try {
    text = await fetchText("https://wiimmfi.de/stats/game/mariokartwii/text");
  } catch (error) {
    return getWiimmfiWithMkwAna();
  }

  if (/Just a moment|Enable JavaScript and cookies|security verification/i.test(text)) {
    return getWiimmfiWithMkwAna();
  }

  const rows = text.match(/\|RMC[A-Z0-9]\|/g) || [];
  if (!text.includes("!id4!") || rows.length === 0) {
    throw new Error("could not parse Wiimmfi text rows");
  }

  return {
    count: rows.length,
    status: "ok",
    detail: "counted rows from Wiimmfi text stats",
  };
}

async function getWiimmfiWithMkwAna() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Wiimmfi web endpoint blocked and mkw-ana fallback requires Linux x64");
  }

  const toolDir = path.join(root, ".cache", "mkw-ana");
  const toolPath = path.join(toolDir, "mkw-ana");
  await mkdir(toolDir, { recursive: true });

  try {
    await readFile(toolPath);
  } catch {
    const response = await fetch("https://download.wiimm.de/mkw-ana/bin/mkw-ana-x86_64-r2938", { headers });
    if (!response.ok) throw new Error(`mkw-ana download failed: HTTP ${response.status}`);
    await writeFile(toolPath, Buffer.from(await response.arrayBuffer()), { mode: 0o755 });
  }

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(toolPath, ["query", "--brief", "@-1"], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = error.stdout || "";
    stderr = error.stderr || "";
    if (!stdout.trim()) {
      throw new Error(`mkw-ana failed: ${stderr.trim() || error.message}`);
    }
  }
  const match = stdout.match(/(\d+)\s*\*/)?.[1] || stdout.match(/\b(\d+)\b/)?.[1];
  const count = Number(match);
  if (!Number.isFinite(count)) throw new Error(`could not parse mkw-ana output: ${(stdout || stderr).trim()}`);

  return {
    count,
    status: "ok",
    detail: "queried Wiimmfi game server with mkw-ana",
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
