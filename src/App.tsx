import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, DemoAuthProvider, useAuth } from '@/context/FirebaseAuthContext';
import FirebaseLogin from '@/pages/FirebaseLogin';
import FirebaseDashboard from '@/pages/FirebaseDashboard';
import ErrorBoundary from '@/components/ErrorBoundary';

const queryClient = new QueryClient();

function AppContent() {
  const { user, loading, firebaseUser, logout } = useAuth();
  if (loading) return <main className="grid min-h-screen place-items-center">Preparando el panel…</main>;
  if (firebaseUser && !user) {
    return <main className="grid min-h-screen place-items-center p-6 text-center">
      <div><h1 className="text-xl font-semibold">Usuario sin acceso</h1>
      <p className="mt-2">El administrador debe crear tu perfil en Firestore.</p>
      <button onClick={() => void logout()} className="mt-4 rounded-lg border px-4 py-2">Cerrar sesión</button></div>
    </main>;
  }
  return user ? <FirebaseDashboard /> : <FirebaseLogin />;
}

export default function App() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
    return <QueryClientProvider client={queryClient}>
      <TooltipProvider><Toaster /><ErrorBoundary><DemoAuthProvider><FirebaseDashboard demo /></DemoAuthProvider></ErrorBoundary></TooltipProvider>
    </QueryClientProvider>;
  }
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider><Toaster /><ErrorBoundary><AuthProvider><AppContent /></AuthProvider></ErrorBoundary></TooltipProvider>
  </QueryClientProvider>;
}
