# Startup Scripts

This folder contains scripts to easily start the entire GRIDGROVE application stack.

## Prerequisites

1. **MySQL** must be installed
2. **Node.js** (v17.9.0 recommended)
3. **npm** (comes with Node.js)

## Installation

Before first run, install dependencies:

```bash
npm install
```

## Quick Start

### Option 1: Using npm scripts (Recommended)

```bash
# Install concurrently if not already installed
npm install

# Start both frontend and backend
npm run dev
# or
npm run start:all
```

### Option 2: Using startup scripts

**On Windows:**
```bash
# Double-click start.bat
# OR run in Command Prompt/PowerShell:
start.bat
```

**On Mac/Linux/Git Bash:**
```bash
# Make the script executable (first time only)
chmod +x start.sh

# Run the script
./start.sh
```

## What Gets Started

1. **MySQL Server** (if not already running)
   - Port: 3306 (default)
   
2. **Backend Server** (Express/Node.js)
   - URL: http://localhost:3001
   - Auto-restarts on code changes (nodemon)
   
3. **Frontend Server** (React)
   - URL: http://localhost:3000
   - Auto-refreshes on code changes

## Individual Services

You can also start services individually:

```bash
# Backend only
npm start
# or
npm run backend

# Frontend only
npm run frontend

# Start and build frontend for production
npm run build
```

## Stopping the Servers

Press `Ctrl+C` in the terminal to stop all running services.

## Troubleshooting

### MySQL Won't Start
- **Windows**: Start MySQL from Services (Win+R â†’ `services.msc`) or MySQL Workbench
- **Mac**: `brew services start mysql`
- **Linux**: `sudo service mysql start` or `sudo systemctl start mysql`

### Port Already in Use
- Backend (3001): Check if another process is using port 3001
- Frontend (3000): Check if another React app is running

### Dependencies Issues
```bash
# Reinstall all dependencies
npm install
cd GRIDGROVE-frontend && npm install && cd ..
```

## Environment Variables

Make sure you have a `.env` file in the root directory with:
```
PORT=3001
ACCESS_TOKEN_SECRET=your_secret_here
# Add other environment variables as needed
```
