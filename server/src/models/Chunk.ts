import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { TerrainPoint } from "../world/TerrainTypes.js";

// Load SQL.js and initialize database
let db: Database;
let pendingWrites: Map<string, ChunkData> = new Map();
let writeTimeout: NodeJS.Timeout | null = null;
const BATCH_WRITE_DELAY = 1000; // 1 second delay for batching writes

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
  // Add to pending writes for batch processing
  const key = `${chunk.x},${chunk.y}`;
  pendingWrites.set(key, chunk);
  
  // Schedule batch write if not already scheduled
  if (writeTimeout === null) {
    writeTimeout = setTimeout(() => {
      flushPendingWrites();
      writeTimeout = null;
    }, BATCH_WRITE_DELAY);
  }
}

function flushPendingWrites(): void {
  if (pendingWrites.size === 0) return;
  
  // Prepare statement once for batch operation
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunks (x, y, tiles, terrain)
    VALUES (?, ?, ?, ?)
  `);
  
  // Process all pending writes in a transaction for better performance
  db.exec('BEGIN TRANSACTION');
  
  try {
    for (const chunk of pendingWrites.values()) {
      // Ensure terrain is serialized if it exists
      const terrainJson = chunk.terrain ? JSON.stringify(chunk.terrain) : "[]";
      stmt.run([chunk.x, chunk.y, JSON.stringify(chunk.tiles), terrainJson]);
    }
    
    db.exec('COMMIT');
    pendingWrites.clear();
    
    // Persist to disk asynchronously
    setImmediate(() => persistDB());
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('Error during batch write:', error);
  }
}

function persistDB() {
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (error) {
    console.error('Error persisting database:', error);
  }
}

// Force flush on process exit
process.on('exit', () => {
  if (writeTimeout) {
    clearTimeout(writeTimeout);
    flushPendingWrites();
  }
});

process.on('SIGINT', () => {
  if (writeTimeout) {
    clearTimeout(writeTimeout);
    flushPendingWrites();
  }
  process.exit(0);
});
