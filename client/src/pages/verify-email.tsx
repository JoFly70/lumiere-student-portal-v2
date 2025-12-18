import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    // Get the verification token from URL hash
    const hash = window.location.hash;

    if (!hash || !hash.includes('access_token')) {
      setStatus('error');
      setMessage('Invalid verification link. Please check your email and try again.');
      return;
    }

    // Supabase handles verification automatically via the link
    // The hash contains the access_token which confirms email verification
    setTimeout(() => {
      setStatus('success');
      setMessage('Your email has been verified successfully! You can now log in.');
    }, 1500);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Email Verification</CardTitle>
          <CardDescription className="text-center">
            {status === 'verifying' && 'Please wait while we verify your email'}
            {status === 'success' && 'Verification complete'}
            {status === 'error' && 'Verification failed'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'verifying' && (
            <div className="flex flex-col items-center space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
              <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-12 w-12" />
              </div>
              <Alert className="border-green-200 bg-green-50 dark:bg-green-900/20">
                <AlertDescription className="text-center">{message}</AlertDescription>
              </Alert>
              <Button
                className="w-full"
                onClick={() => setLocation('/login')}
              >
                Go to Login
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center text-red-600 dark:text-red-400">
                <XCircle className="h-12 w-12" />
              </div>
              <Alert variant="destructive">
                <AlertDescription className="text-center">{message}</AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setLocation('/login')}
                >
                  Back to Login
                </Button>
                <p className="text-xs text-center text-gray-500">
                  Didn't receive the email?{' '}
                  <button
                    onClick={() => setLocation('/resend-verification')}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    Resend verification email
                  </button>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
