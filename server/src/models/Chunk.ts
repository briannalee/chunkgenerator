import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { TerrainPoint } from "../world/TerrainTypes";

// Load SQL.js and initialize database
let db: Database;

const dbPath = path.resolve("data", "game.db");
const dbBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;

async function initDB() {
  const SQL = await initSqlJs();
  db = dbBuffer ? new SQL.Database(dbBuffer) : new SQL.Database();
  // Create table if it doesn't exist
  db.run(`
  CREATE TABLE IF NOT EXISTS chunks (
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    tiles TEXT NOT NULL,
    terrain TEXT NOT NULL,
    PRIMARY KEY (x, y)
  )
`);
}
initDB();

export type ChunkData = {
  x: number;
  y: number;
  tiles: any[];
  terrain?: TerrainPoint[][];
};

export function findChunk(x: number, y: number): ChunkData | null {
  const stmt = db.prepare("SELECT tiles, terrain FROM chunks WHERE x = ? AND y = ?");
  stmt.bind([x, y]);

  if (!stmt.step()) return null;

  const row = stmt.getAsObject() as { tiles: string, terrain: string };
  return {
    x,
    y,
    tiles: JSON.parse(row.tiles),
    terrain: JSON.parse(row.terrain)
  };
}

export function saveChunk(chunk: ChunkData): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunks (x, y, tiles, terrain)
    VALUES (?, ?, ?, ?)
  `);
  
  // Ensure terrain is serialized if it exists
  const terrainJson = chunk.terrain ? JSON.stringify(chunk.terrain) : "[]";
  
  stmt.run([chunk.x, chunk.y, JSON.stringify(chunk.tiles), terrainJson]);
  persistDB(); // save changes to disk
}

function persistDB() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}
