#!/bin/bash

# Chessus Project Startup Script
# This script starts MySQL, the backend server, and the frontend React app

echo "ðŸš€ Starting Chessus Project..."
echo ""

# Clean up any existing processes on ports 3000 and 3001
if [ -f "cleanup.sh" ]; then
    bash cleanup.sh
fi

# Check if MySQL is running
echo "ðŸ“Š Checking MySQL status..."
if command -v mysql.server &> /dev/null; then
    # macOS/Linux with mysql.server
    mysql.server status &> /dev/null
    if [ $? -eq 0 ]; then
        echo "âœ… MySQL is already running"
    else
        echo "ðŸ”„ Starting MySQL server..."
        mysql.server start
        if [ $? -eq 0 ]; then
            echo "âœ… MySQL started successfully"
        else
            echo "âš ï¸  Failed to start MySQL. Please start it manually."
        fi
    fi
elif command -v mysqld &> /dev/null; then
    # Check if MySQL is running via process
    if pgrep -x "mysqld" > /dev/null; then
        echo "âœ… MySQL is already running"
    else
        echo "âš ï¸  MySQL not running. Please start MySQL manually:"
        echo "   Windows: Start MySQL from Services or MySQL Workbench"
        echo "   macOS: brew services start mysql"
        echo "   Linux: sudo service mysql start"
    fi
else
    echo "âš ï¸  MySQL not found. Please ensure MySQL is installed and running."
    echo "   Windows: Start MySQL from Services or MySQL Workbench"
    echo "   macOS: brew services start mysql"
    echo "   Linux: sudo service mysql start"
fi

echo ""
echo "ðŸ“¦ Installing dependencies (if needed)..."
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
fi

if [ ! -d "GRIDGROVE-frontend/node_modules" ]; then
    echo "ðŸ“¦ Installing frontend dependencies..."
    cd GRIDGROVE-frontend && npm install && cd ..
fi

echo ""
echo "ðŸš€ Starting Backend and Frontend servers..."
echo "   Backend will run on: http://localhost:3001"
echo "   Frontend will run on: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Start both servers using npm script
npm run dev
