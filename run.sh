#!/bin/bash

# Simple script to run the ContactsPlus CLI

echo "Starting ContactsPlus CLI..."

# Build if needed
if [ ! -d "dist" ]; then
    echo "Building project..."
    npm run build
fi

# Run the application
node dist/index.js "$@"