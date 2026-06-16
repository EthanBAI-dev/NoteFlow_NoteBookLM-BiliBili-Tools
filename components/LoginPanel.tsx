import { useState } from 'react';
import { LogIn, Mail, Lock, Loader2, AlertCircle, Chrome } from 'lucide-react';
import { signIn, signUp, signInWithGoogle } from '@/lib/auth';
import type { AuthError } from '@supabase/supabase-js';

type AuthMode = 'login' | 'signup';
type LoginState = 'idle' | 'loading' | 'error' | 'success';

interface Props {
  onAuthSuccess?: () => void;
}

export function LoginPanel({ onAuthSuccess }: Props) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<LoginState>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setState('loading');
    setError('');

    const { data, error: authError } = mode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password);

    if (authError) {
      setState('error');
      setError(authError.message);
      return;
    }

    if (data.session) {
      setState('success');
      onAuthSuccess?.();
    } else {
      // Email confirmation needed (sign-up)
      setState('success');
      setError('');
    }
  };

  const handleGoogleSignIn = async () => {
    setState('loading');
    setError('');

    const { data, error: authError } = await signInWithGoogle();
    if (authError) {
      setState('error');
      setError(authError);
      return;
    }

    if (data?.session) {
      setState('success');
      onAuthSuccess?.();
    }
  };

  const isIdle = state === 'idle' || state === 'error';

  return (
    <div className="flex flex-col items-center justify-center min-h-[480px] px-6 bg-surface">
      {/* Logo / Brand */}
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-notebooklm-blue to-blue-500 flex items-center justify-center shadow-lg mb-4">
        <LogIn className="w-7 h-7 text-white" />
      </div>
      <h1 className="text-lg font-semibold text-gray-900 mb-1">登录 Flow2Note</h1>
      <p className="text-xs text-gray-500 mb-8 text-center max-w-[220px]">
        登录后即可使用全部功能，包括导入到 NotebookLM
      </p>

      {/* Google Sign-in */}
      <button
        onClick={handleGoogleSignIn}
        disabled={state === 'loading'}
        className="w-full max-w-[280px] py-2.5 px-4 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-3 shadow-sm hover:shadow transition-all duration-150 btn-press"
      >
        <Chrome className="w-5 h-5 text-gray-600" />
        <span className="text-sm font-medium text-gray-700">使用 Google 账号登录</span>
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 my-5 w-full max-w-[280px]">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-[11px] text-gray-400 font-medium">或使用邮箱</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* Email/Password form */}
      <form onSubmit={handleSubmit} className="w-full max-w-[280px] space-y-3">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱地址"
            required
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-notebooklm-blue/30 focus:border-notebooklm-blue placeholder:text-gray-400 transition-all"
          />
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            required
            minLength={6}
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-notebooklm-blue/30 focus:border-notebooklm-blue placeholder:text-gray-400 transition-all"
          />
        </div>

        <button
          type="submit"
          disabled={state === 'loading' || !email || !password}
          className="w-full py-2.5 bg-notebooklm-blue hover:bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
        >
          {state === 'loading' ? (
            <><Loader2 className="w-4 h-4 animate-spin" />处理中...</>
          ) : (
            <>{mode === 'login' ? '登录' : '注册'}</>
          )}
        </button>

        {/* Error */}
        {state === 'error' && error && (
          <div className="flex items-center gap-2 text-red-500 text-xs bg-red-50 border border-red-100/60 rounded-lg p-3">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Toggle mode */}
        <p className="text-xs text-gray-500 text-center mt-4">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
            className="ml-1 text-notebooklm-blue hover:underline font-medium"
          >
            {mode === 'login' ? '注册' : '登录'}
          </button>
        </p>
      </form>
    </div>
  );
}
