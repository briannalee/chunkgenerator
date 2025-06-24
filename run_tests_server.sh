#!/bin/sh

set -e  # Exit on any error

export CI=true

# Start Redis
echo "Starting Redis..."
redis-server --appendonly no --save "" --daemonize yes
 
echo "Initializing PostgreSQL data directory..."
su - postgres -c  "initdb -D /var/lib/postgresql/data"

echo "Starting PostgreSQL..."
su - postgres -c  "pg_ctl -D /var/lib/postgresql/data -o '-F -p 5432' -w start"

echo "Creating user and database..."
psql -U postgres <<EOF
CREATE USER chunkuser WITH PASSWORD 'chunkpass';
CREATE DATABASE chunkgame OWNER chunkuser;
EOF

# Ensure the PostgreSQL run directory exists and has the correct permissions
mkdir -p /run/postgresql
chown -R postgres:postgres /run/postgresql

echo "Running init.sql..."
psql -U postgres -d chunkgame -f ./chunkgenerator/init_superuser.sql
psql -U chunkuser -d chunkgame -f ./chunkgenerator/init_schema.sql

# Start the server in the background
cd ./chunkgenerator/server
npm run start &

# Wait for server to be ready
sleep 5



# Continue with client build and tests
cd ../client
npm run build
npm run test:river "$@"

echo "Tests completed successfully."

