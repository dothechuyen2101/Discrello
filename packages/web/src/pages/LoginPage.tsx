import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useLogin } from '../api/hooks';
import { Button, Field, Input } from '../components/ui';
import { ErrorBanner } from '../components/ErrorBanner';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const login = useLogin();
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(password, { onSuccess: () => navigate('/boards', { replace: true }) });
  };

  const error =
    login.error && ApiError.is(login.error) && login.error.status === 401
      ? new Error('Wrong password')
      : login.error;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-xs"
      >
        <div>
          <h1 className="text-lg font-bold text-indigo-700">Discrello</h1>
          <p className="text-sm text-gray-500">Trello → Discord role notifier</p>
        </div>
        <Field label="Admin password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorBanner error={error} />
        <Button
          type="submit"
          variant="primary"
          className="w-full justify-center"
          busy={login.isPending}
          disabled={!password}
        >
          Log in
        </Button>
      </form>
    </div>
  );
}
