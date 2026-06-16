import { useState, useEffect, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { restoreSession, getCachedUser } from '@/lib/auth';
import { LoginPanel } from './LoginPanel';

type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthUser {
  id: string;
  email: string | undefined;
  avatar_url: string | undefined;
  name: string | undefined;
}

interface Props {
  children: ReactNode;
  onAuthChange?: (user: AuthUser | null) => void;
}

export function AuthGuard({ children, onAuthChange }: Props) {
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    (async () => {
      const { session } = await restoreSession();
      if (session?.user) {
        const authUser: AuthUser = {
          id: session.user.id,
          email: session.user.email || undefined,
          avatar_url: session.user.user_metadata?.avatar_url || undefined,
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || undefined,
        };
        setAuthState('authenticated');
        onAuthChange?.(authUser);
      } else {
        setAuthState('unauthenticated');
        onAuthChange?.(null);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuthSuccess = async () => {
    const cached = await getCachedUser();
    if (cached) {
      const authUser: AuthUser = {
        id: cached.id,
        email: cached.email,
        avatar_url: cached.avatar_url,
        name: cached.name,
      };
      setAuthState('authenticated');
      onAuthChange?.(authUser);
    } else {
      const { session } = await restoreSession();
      if (session?.user) {
        const authUser: AuthUser = {
          id: session.user.id,
          email: session.user.email || undefined,
          avatar_url: session.user.user_metadata?.avatar_url || undefined,
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || undefined,
        };
        setAuthState('authenticated');
        onAuthChange?.(authUser);
      }
    }
  };

  // Loading state
  if (authState === 'loading') {
    return (
      <div className="min-h-[480px] flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-notebooklm-blue/10 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-notebooklm-blue animate-spin" />
          </div>
          <p className="text-xs text-gray-400">正在验证身份...</p>
        </div>
      </div>
    );
  }

  // Login screen
  if (authState === 'unauthenticated') {
    return <LoginPanel onAuthSuccess={handleAuthSuccess} />;
  }

  // Authenticated — show children
  return <>{children}</>;
}
