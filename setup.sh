#!/bin/bash

# Chunk Generator Server Optimization Setup Script
# This script sets up the optimized server with Redis and PostgreSQL

set -e

echo "🚀 Setting up optimized chunk generation server..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Prerequisites check passed"

# Navigate to server directory
cd server

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Go back to root directory
cd ..

# Create environment file if it doesn't exist
if [ ! -f server/.env ]; then
    echo "📝 Creating environment configuration..."
    cp server/.env.example server/.env
    echo "✅ Environment file created at server/.env"
    echo "📝 Please edit server/.env with your preferred settings"
else
    echo "✅ Environment file already exists"
fi

# Start Redis and PostgreSQL
echo "🐳 Starting Redis and PostgreSQL containers..."
docker-compose up -d postgres redis

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Services are running"
else
    echo "❌ Some services failed to start. Check with: docker-compose ps"
    exit 1
fi

# Build the TypeScript code
echo "🔨 Building TypeScript code..."
cd server
npm run build

echo ""
echo "🎉 Setup complete! Your optimized server is ready."
echo ""
echo "📋 Next steps:"
echo "1. Edit server/.env if needed (database credentials, ports, etc.)"
echo "2. Start the server:"
echo "   - Development mode: npm run dev"
echo "   - Clustered mode: npm run dev:clustered"
echo "   - Production mode: npm run start:optimized"
echo ""
echo "📊 Monitor your services:"
echo "   - Check containers: docker-compose ps"
echo "   - View logs: docker-compose logs"
echo "   - Stop services: docker-compose down"
echo ""
echo "📚 Read OPTIMIZATION_GUIDE.md for detailed information about the improvements."
