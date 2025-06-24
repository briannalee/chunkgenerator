#!/bin/sh

set -e  # Exit on any error

export CI=true



# Build server and run tests
cd ./chunkgenerator/server
npm run build
npm test "$@"

