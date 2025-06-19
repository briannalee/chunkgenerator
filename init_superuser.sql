-- Create a user for the application (only needs to be done once)
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles WHERE rolname = 'chunkuser'
   ) THEN
      CREATE ROLE chunkuser LOGIN PASSWORD 'chunkpass';
   END IF;
END
$do$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE chunkgame TO chunkuser;