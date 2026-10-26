// Functional check of the invitation lifecycle against the DISPOSABLE local
// Supabase stack (synthetic rows only). Refuses non-loopback SUPABASE_URL.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_KEY=<local key> \
//     npx tsx scripts/disposable-env/check-invitations.mts
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) {
  console.error('REFUSING: SUPABASE_URL must be a loopback disposable stack');
  process.exit(2);
}
import { createInvitation, claimInvitation, consumeInvitation, releaseInvitation } from '../../server/lib/invitations';
import { supabaseAdmin } from '../../server/lib/supabase';
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const uid = crypto.randomUUID();
await supabaseAdmin.from('users').insert({ id: uid, email: `synthetic-admin-${uid.slice(0,8)}@example.test`, name: 'Synthetic Admin', role: 'admin' });
const inv = await createInvitation({ email: 'Synthetic.Student@Example.test', createdBy: uid, ttlHours: 1 });
const { data: row } = await supabaseAdmin.from('account_invitations').select('*').eq('id', inv.id).single();
ok(row.token_hash !== inv.token && row.email === 'synthetic.student@example.test', 'stored hash only, normalized email');
ok(await claimInvitation(inv.token, 'other@example.test') === null, 'wrong email rejected');
ok(await claimInvitation('not-a-token', 'synthetic.student@example.test') === null, 'wrong token rejected');
const [a, b] = await Promise.all([claimInvitation(inv.token, 'synthetic.student@example.test'), claimInvitation(inv.token, 'synthetic.student@example.test')]);
ok([a, b].filter(Boolean).length === 1, 'concurrent claims: exactly one succeeds');
await releaseInvitation(inv.id);
const c = await claimInvitation(inv.token, 'SYNTHETIC.student@example.test');
ok(c === inv.id, 'released invitation reclaimable');
ok(await consumeInvitation(inv.id, uid), 'consume');
ok(await claimInvitation(inv.token, 'synthetic.student@example.test') === null, 'consumed invitation cannot be reused');
const inv2 = await createInvitation({ email: 'rev@example.test', createdBy: uid });
await supabaseAdmin.from('account_invitations').update({ revoked_at: new Date().toISOString() }).eq('id', inv2.id);
ok(await claimInvitation(inv2.token, 'rev@example.test') === null, 'revoked invitation rejected');
const inv3 = await createInvitation({ email: 'exp@example.test', createdBy: uid });
await supabaseAdmin.from('account_invitations').update({ created_at: new Date(Date.now()-7200e3).toISOString(), expires_at: new Date(Date.now()-3600e3).toISOString() }).eq('id', inv3.id);
ok(await claimInvitation(inv3.token, 'exp@example.test') === null, 'expired invitation rejected');
