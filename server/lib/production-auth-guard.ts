/**
 * S25: production fail-closed startup policy for the account gate.
 *
 * requireAuth only enforces provider email confirmation when ENABLE_EMAIL_VERIFICATION=true
 * (server/lib/auth-policy.ts). Previously only scripts/s22/preflight-env.ts checked that, so a
 * production deploy that forgot the variable would silently accept unconfirmed accounts. The server
 * now refuses to start in production unless the policy is on and demo mode is off.
 * The returned messages name variables only, never values.
 */
export function productionAuthPolicyProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (env.ENABLE_EMAIL_VERIFICATION !== 'true') {
    problems.push('ENABLE_EMAIL_VERIFICATION must be "true" in production (email confirmation is enforced only when it is set)');
  }
  if (env.ALLOW_DEMO_MODE === 'true') {
    problems.push('ALLOW_DEMO_MODE must not be "true" in production');
  }
  return problems;
}

export function assertProductionAuthPolicy(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionAuthPolicyProblems(env);
  if (problems.length > 0) {
    throw new Error(`Refusing to start: insecure production auth configuration. ${problems.join('; ')}`);
  }
}
