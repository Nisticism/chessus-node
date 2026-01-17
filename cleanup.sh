#!/bin/bash

# Cleanup Script - Kills processes on ports 3000 and 3001

echo "🧹 Cleaning up existing processes..."

# Function to kill process on a specific port
kill_port() {
    local port=$1
    echo "Checking port $port..."
    
    # Try to find process using the port
    if command -v lsof &> /dev/null; then
        # Unix/Mac with lsof
        local pid=$(lsof -ti:$port)
        if [ ! -z "$pid" ]; then
            echo "  Killing process $pid on port $port"
            kill -9 $pid 2>/dev/null
        else
            echo "  No process found on port $port"
        fi
    elif command -v netstat &> /dev/null; then
        # Windows/Git Bash with netstat
        local pid=$(netstat -ano | grep ":$port" | grep LISTENING | awk '{print $5}' | head -n 1)
        if [ ! -z "$pid" ]; then
            echo "  Killing process $pid on port $port"
            taskkill //PID $pid //F 2>/dev/null || kill -9 $pid 2>/dev/null
        else
            echo "  No process found on port $port"
        fi
    else
        echo "  Unable to check port (no lsof or netstat found)"
    fi
}

# Kill processes on both ports
kill_port 3001
kill_port 3000

echo "✅ Cleanup complete!"
echo ""
