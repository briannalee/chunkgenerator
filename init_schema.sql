-- Initialize the chunkgame database schema

-- Create the chunks table with proper indexing
CREATE TABLE IF NOT EXISTS chunks (
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    tiles JSONB NOT NULL,
    terrain JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (x, y)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chunks_coords ON chunks(x, y);
CREATE INDEX IF NOT EXISTS idx_chunks_created_at ON chunks(created_at);
CREATE INDEX IF NOT EXISTS idx_chunks_spatial ON chunks USING btree(x, y);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_chunks_updated_at 
    BEFORE UPDATE ON chunks 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Grant privileges to chunkuser
GRANT ALL PRIVILEGES ON TABLE chunks TO chunkuser;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chunkuser;

-- Add some helpful comments
COMMENT ON TABLE chunks IS 'Stores generated terrain chunks with JSONB for efficient querying';
COMMENT ON COLUMN chunks.tiles IS 'Compressed tile data for client rendering';
COMMENT ON COLUMN chunks.terrain IS 'Full terrain data for server-side calculations';