import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";

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
    PRIMARY KEY (x, y)
  )
`);
}
initDB();




type Tile = {
  x: number;
  y: number;
  type: string;
};

type ChunkData = {
  x: number;
  y: number;
  tiles: Tile[];
};

export function findChunk(x: number, y: number): ChunkData | null {
  const stmt = db.prepare("SELECT tiles FROM chunks WHERE x = ? AND y = ?");
  stmt.bind([x, y]);

  if (!stmt.step()) return null;

  const row = stmt.getAsObject() as { tiles: string };
  return {
    x,
    y,
    tiles: JSON.parse(row.tiles),
  };
}

export function saveChunk(chunk: ChunkData): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunks (x, y, tiles)
    VALUES (?, ?, ?)
  `);
  stmt.run([chunk.x, chunk.y, JSON.stringify(chunk.tiles)]);
  persistDB(); // save changes to disk
}

function persistDB() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}