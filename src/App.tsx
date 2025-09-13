import React, { useEffect } from 'react';
import { useStore } from './store/useStore';
import { supabase } from './lib/supabase';
import { LoginPage } from './components/auth/LoginPage';
import { MainLayout } from './components/layout/MainLayout';
import { useMarketData } from './hooks/useMarketData';
import { Toaster } from 'react-hot-toast';

function App() {
  const { isAuthenticated, setUser, setAuthenticated } = useStore();

  // Initialize market data hook
  useMarketData();

  useEffect(() => {
    // Check for existing session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        // Fetch user profile
        const { data: profile, error } = await supabase
          .from('users')
          .select('*')
          .eq('auth_id', session.user.id)
          .single();

        if (!error && profile) {
          setUser({
            id: session.user.id,
            email: session.user.email!,
            name: profile["Candidate's Name"] || 'User',
            role: profile.role,
            created_at: profile.created_at,
          });
          setAuthenticated(true);
        }
      }
    };

    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          setUser(null);
          setAuthenticated(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [setUser, setAuthenticated]);

  return (
    <div className="App">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1F2937',
            color: '#F3F4F6',
            border: '1px solid #374151',
          },
          success: {
            iconTheme: {
              primary: '#10B981',
              secondary: '#F3F4F6',
            },
          },
          error: {
            iconTheme: {
              primary: '#EF4444',
              secondary: '#F3F4F6',
            },
          },
        }}
      />
      
      {isAuthenticated ? <MainLayout /> : <LoginPage />}
    </div>
  );
}

export default App;