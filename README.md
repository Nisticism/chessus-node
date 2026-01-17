# Chessus

A full-stack chess variant platform that allows users to create custom chess games, share them with the community, and engage in forums.

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** v17.9.0 or higher (v23.8.0 recommended)
- **npm** (comes with Node.js)
- **MySQL** v5.7 or higher
- **Git** (for cloning the repository)

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/Nisticism/chessus-node.git
cd chessus-node
```

### 2. Install Dependencies
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd chessus-frontend
npm install
cd ..
```

### 3. Database Setup

#### Create the Database
```sql
CREATE DATABASE chessusnode;
```

#### Configure Database Connection
Edit `configs/db.js` with your MySQL credentials:
```javascript
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',           // Your MySQL username
    password: 'password',   // Your MySQL password
    port: '3306',
    database: 'chessusnode'
});
```

#### Initialize Database Tables
Run the SQL script located at `db/tables-seed.sql` in your MySQL client, or:
```bash
mysql -u root -p chessusnode < db/tables-seed.sql
```

### 4. Start the Application

#### Option 1: Start Everything at Once (Recommended)
```bash
npm run dev
```
This starts both the backend (port 3001) and frontend (port 3000) concurrently.

#### Option 2: Start Services Individually
```bash
# Terminal 1 - Start backend
npm run backend

# Terminal 2 - Start frontend
npm run frontend
```

#### Option 3: Use the Shell Scripts
```bash
# Windows
start.bat

# Unix/Mac/Linux
./start.sh
```

### 5. Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

## 📦 Available Commands

### Root Directory Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both backend and frontend in development mode |
| `npm run start:all` | Alternative command to start both servers |
| `npm run backend` | Start only the backend server (port 3001) |
| `npm run frontend` | Start only the frontend app (port 3000) |
| `npm start` | Start backend server with nodemon |
| `npm run build` | Build the frontend for production |
| `npm run seed` | Seed the database with initial data |

### Frontend Directory Commands
```bash
cd chessus-frontend
```

| Command | Description |
|---------|-------------|
| `npm start` | Start React development server |
| `npm run build` | Create production build |
| `npm test` | Run test suite |

## 🗂️ Project Structure

```
chessus-node/
├── server/              # Backend Express server
│   ├── index.js        # Main server file with API routes
│   └── db-helpers.js   # Database helper functions
├── configs/            # Configuration files
│   └── db.js          # MySQL database connection
├── db/                # Database scripts
│   └── tables-seed.sql # Database schema
├── chessus-frontend/  # React frontend application
│   ├── src/
│   │   ├── actions/   # Redux actions
│   │   ├── reducers/  # Redux reducers
│   │   ├── services/  # API service layer
│   │   ├── components/ # React components
│   │   └── containers/ # Page containers
│   └── public/
├── start.sh           # Unix startup script
├── start.bat          # Windows startup script
├── cleanup.sh         # Kill processes on Unix
└── cleanup.bat        # Kill processes on Windows
```

## 🛠️ Development Workflow

### Hot Reloading
- **Backend**: Uses `nodemon` to automatically restart on file changes
- **Frontend**: React development server hot-reloads on save

### Environment Variables
The application uses the following default ports:
- Backend: `3001`
- Frontend: `3000`
- MySQL: `3306`

### Database Helpers
All database operations use async/await with the helper functions in `server/db-helpers.js`.

### API Endpoints
The backend provides RESTful API endpoints for:
- Authentication (`/login`, `/logout`, `/register`)
- Users (`/users`, `/user/:id`)
- Forums (`/forums`, `/forum/:id`)
- News articles (`/news`)
- Custom chess pieces and game types

## 🔧 Troubleshooting

### Port Already in Use
If you see "Port 3000/3001 already in use", kill existing processes:

**Windows:**
```bash
cleanup.bat
```

**Unix/Mac/Linux:**
```bash
./cleanup.sh
```

Or manually:
```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Unix/Mac/Linux
lsof -ti:3001 | xargs kill -9
```

### Database Connection Refused
1. Verify MySQL is running:
   ```bash
   # Windows
   net start MySQL80
   
   # Mac (Homebrew)
   brew services start mysql
   
   # Linux
   sudo systemctl start mysql
   ```

2. Check credentials in `configs/db.js`
3. Ensure database `chessusnode` exists

### Module Not Found
```bash
# Reinstall dependencies
npm install
cd chessus-frontend && npm install
```

### MySQL Authentication Error
If you get "ER_NOT_SUPPORTED_AUTH_MODE", run this in MySQL:
```sql
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';
FLUSH PRIVILEGES;
```

## 🎨 Frontend Styling

The project uses:
- **SCSS Modules** for component-scoped styling
- **CSS Variables** in `src/index.css` for global theming
- Centralized color system for easy customization

To customize colors, edit CSS variables in `chessus-frontend/src/index.css`:
```css
:root {
  --button-primary-bg: rgb(75, 77, 124);
  --text-white: #ffffff;
  /* ... more variables */
}
```

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Commit: `git commit -m "Add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

## 📄 License

ISC
