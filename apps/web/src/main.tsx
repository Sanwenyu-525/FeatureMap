import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import OverviewPage from './pages/OverviewPage';
import FeaturesPage from './pages/FeaturesPage';
import FeatureDetailPage from './pages/FeatureDetailPage';
import ChangesPage from './pages/ChangesPage';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'features', element: <FeaturesPage /> },
      { path: 'features/:id', element: <FeatureDetailPage /> },
      { path: 'changes', element: <ChangesPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
