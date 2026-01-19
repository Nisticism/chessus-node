#!/bin/bash

# Chessus Project Startup Script
# This script starts MySQL, the backend server, and the frontend React app

echo "🚀 Starting Chessus Project..."
echo ""

# Clean up any existing processes on ports 3000 and 3001
if [ -f "cleanup.sh" ]; then
    bash cleanup.sh
fi

# Check if MySQL is running
echo "📊 Checking MySQL status..."
if command -v mysql.server &> /dev/null; then
    # macOS/Linux with mysql.server
    mysql.server status &> /dev/null
    if [ $? -eq 0 ]; then
        echo "✅ MySQL is already running"
    else
        echo "🔄 Starting MySQL server..."
        mysql.server start
        if [ $? -eq 0 ]; then
            echo "✅ MySQL started successfully"
        else
            echo "⚠️  Failed to start MySQL. Please start it manually."
        fi
    fi
elif command -v mysqld &> /dev/null; then
    # Check if MySQL is running via process
    if pgrep -x "mysqld" > /dev/null; then
        echo "✅ MySQL is already running"
    else
        echo "⚠️  MySQL not running. Please start MySQL manually:"
        echo "   Windows: Start MySQL from Services or MySQL Workbench"
        echo "   macOS: brew services start mysql"
        echo "   Linux: sudo service mysql start"
    fi
else
    echo "⚠️  MySQL not found. Please ensure MySQL is installed and running."
    echo "   Windows: Start MySQL from Services or MySQL Workbench"
    echo "   macOS: brew services start mysql"
    echo "   Linux: sudo service mysql start"
fi

echo ""
echo "📦 Installing dependencies (if needed)..."
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
fi

if [ ! -d "squarestrat-frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd squarestrat-frontend && npm install && cd ..
fi

echo ""
echo "🚀 Starting Backend and Frontend servers..."
echo "   Backend will run on: http://localhost:3001"
echo "   Frontend will run on: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Start both servers using npm script
npm run dev
