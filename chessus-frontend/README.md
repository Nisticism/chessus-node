# GRIDGROVE Frontend

React-based frontend for the GRIDGROVE chess variant platform.

## 🚀 Quick Start

### Prerequisites
- Node.js v17.9.0 or higher
- Backend server running on port 3001

### Installation
```bash
npm install
```

### Development
```bash
npm start
```
Opens the app at [http://localhost:3000](http://localhost:3000) with hot-reloading enabled.

### Build for Production
```bash
npm run build
```
Creates an optimized production build in the `build` folder.

## 📦 Available Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start development server (port 3000) |
| `npm run build` | Create production build |
| `npm test` | Run tests in interactive watch mode |
| `npm run eject` | Eject from Create React App (⚠️ irreversible) |

## 🏗️ Project Structure

```
src/
├── actions/           # Redux action creators
│   ├── auth.js       # Authentication actions
│   ├── forums.js     # Forum CRUD actions
│   ├── news.js       # News article actions
│   └── users.js      # User management actions
├── reducers/         # Redux reducers
│   ├── authReducer.js
│   ├── forums.js
│   ├── news.js
│   └── users.js
├── services/         # API service layer
│   ├── auth.service.js
│   ├── forums.service.js
│   ├── news.service.js
│   └── user.service.js
├── components/       # Reusable UI components
│   ├── navbar/
│   ├── forum/
│   ├── chess/
│   └── ...
├── containers/       # Page-level components
│   ├── news/
│   ├── forums/
│   ├── gamecreate/
│   └── ...
├── assets/          # Static assets (images, sounds)
├── index.css        # Global styles & CSS variables
├── store.js         # Redux store configuration
└── App.js           # Main app component with routing
```

## 🎨 Styling

### CSS Variables
Global colors are defined in `src/index.css` using CSS custom properties:

```css
:root {
  /* Buttons */
  --button-primary-bg: rgb(75, 77, 124);
  --button-primary-hover: rgb(59, 61, 131);
  --button-border: rgb(117, 124, 252);
  
  /* Text */
  --text-white: #ffffff;
  --text-dark: rgb(54, 54, 54);
  --text-gray: rgb(128, 128, 128);
  
  /* Backgrounds */
  --bg-dark: #1e2129;
  --bg-card: #20242e;
  --content-bg: rgb(150, 187, 175);
  
  /* More variables... */
}
```

### SCSS Modules
Components use SCSS modules for scoped styling. Import and use variables:

```scss
.button {
  background-color: var(--button-primary-bg);
  color: var(--text-white);
  border: 2px solid var(--button-border);
  
  &:hover {
    background-color: var(--button-primary-hover);
  }
}
```

## 🔌 API Integration

### Base URL
The frontend connects to the backend at `http://localhost:3001`.

### Service Layer
All API calls go through service files that use axios:

```javascript
// Example: services/auth.service.js
const API_URL = "http://localhost:3001/";

const login = async (username, password) => {
  const response = await axios.post(API_URL + "login", {
    username,
    password,
  });
  if (response.data.accessToken) {
    localStorage.setItem("user", JSON.stringify(response.data));
  }
  return response.data;
};
```

### Redux Actions
Actions dispatch service calls and update the store:

```javascript
// Example: actions/auth.js
export const login = (username, password) => async (dispatch) => {
  try {
    const data = await AuthService.login(username, password);
    dispatch({
      type: LOGIN_SUCCESS,
      payload: { user: data },
    });
    return Promise.resolve();
  } catch (error) {
    dispatch({ type: LOGIN_FAIL });
    return Promise.reject();
  }
};
```

## 🛡️ Authentication

### Protected Routes
Pages requiring authentication redirect to `/login`:

```javascript
if (!currentUser) {
  return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
}
```

### Token Storage
JWT tokens are stored in `localStorage` and attached to requests via auth headers.

## 🧪 Testing

Run the test suite:
```bash
npm test
```

Create tests alongside components:
```
components/
├── MyComponent.js
└── MyComponent.test.js
```

## 📱 Features

### User Features
- User registration and authentication
- Profile management
- Custom chess variant creation
- Forum discussions with likes/comments
- News articles

### Technical Features
- Redux state management
- React Router v6 navigation
- Protected routes with authentication
- Real-time UI updates
- Responsive design
- SCSS module styling with CSS variables

## 🔧 Configuration

### Proxy (if needed)
Add to `package.json` to proxy API requests:
```json
"proxy": "http://localhost:3001"
```

### Environment Variables
Create `.env` file for custom configuration:
```
REACT_APP_API_URL=http://localhost:3001
```

## 🐛 Troubleshooting

### Port 3000 in Use
```bash
# Find and kill process
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3000 | xargs kill -9
```

### Module Not Found
```bash
rm -rf node_modules package-lock.json
npm install
```

### Build Errors
```bash
# Clear cache
npm cache clean --force
rm -rf node_modules build
npm install
npm run build
```

### CORS Errors
Ensure backend has CORS enabled for `http://localhost:3000`.

## 📦 Dependencies

### Core
- **React 18.0** - UI framework
- **React Router DOM 6.3** - Routing
- **Redux 4.2** - State management
- **Redux Thunk 2.4** - Async actions
- **Axios 0.27** - HTTP client

### UI
- **React Icons 4.4** - Icon library
- **Sass 1.54** - CSS preprocessor

### Development
- **React Scripts 5.0** - Build tooling (Create React App)
- **Redux DevTools Extension** - State debugging

## 🚀 Deployment

### Build
```bash
npm run build
```

### Serve Static Files
The `build` folder can be served with any static file server:

```bash
# Using serve
npx serve -s build

# Using Node.js express
# (see root README for backend deployment)
```

### Production Checklist
- [ ] Update API URLs for production
- [ ] Enable production mode in Redux
- [ ] Optimize images and assets
- [ ] Configure HTTPS
- [ ] Set up environment variables
- [ ] Enable gzip compression
- [ ] Configure caching headers

## 🤝 Contributing

1. Follow the existing code style (SCSS modules + CSS variables)
2. Update tests for new features
3. Use async/await for all async operations
4. Keep components small and focused
5. Document complex logic with comments

## 📚 Learn More

- [React Documentation](https://reactjs.org/)
- [Create React App](https://create-react-app.dev/)
- [Redux Toolkit](https://redux-toolkit.js.org/)
- [React Router](https://reactrouter.com/)
- [SCSS Documentation](https://sass-lang.com/)
