# Lumière Student Portal: nightly database backup on the OVH VPS

This uses the same OVH VPS-1 (`ssh ovh-sign`) that runs ClientDesk's production backup, and the same design, kept smaller. It exists because the Supabase project is on the Free plan, which has **no scheduled backups** (see `docs/s34/S34-BACKUP-RESTORE-RUNBOOK.md`).

```
Supabase production DB (rheronevecsffaejteoj) ── pg_dump, read-only ──┐
                                                                       ├→ lumiere-backup.service (user lpbackup, systemd sandbox)
  schemas: public (all portal data), auth (sign-in accounts), storage (file list)
      → check the dump is readable and has students / users / auth.users
      → age-encrypt to the OFFLINE recovery key (the same one as ClientDesk) + an OPERATIONAL key on the VPS
      → decrypt with the operational key, compare SHA-256 (verified)
      → /var/backups/lumiere-portal/lumiere-portal-<time>.dump.age (+ .json manifest), 14 days kept, never fewer than 3
nightly 03:40 UTC (a missed run, for example with the host down, runs at the next boot)
```

**Not included:** the uploaded files themselves (document scans, photos) in Supabase Storage. Only their list is in the backup. Backing up the files is a possible next step.

**Not yet included:** an off-site copy, and the email alert that ClientDesk has. For now, check `last-run.json` (see "Check").

## Install (once): owner, about 5 minutes

1. Open a terminal on your computer and connect to the VPS: `ssh ovh-sign`
2. Download the four files and run the installer:

   ```bash
   mkdir -p ~/lumiere-backup && cd ~/lumiere-backup && for f in install.sh lumiere-backup.sh lumiere-backup.service lumiere-backup.timer; do curl -fsSLO "https://raw.githubusercontent.com/JoFly70/lumiere-student-portal-v2/claude/s34-post-audit-maintenance/deploy/backup-ovh-lumiere/$f"; done && sudo bash install.sh
   ```

3. When asked, paste the Portal's `DATABASE_URL` (Replit → Secrets → `DATABASE_URL` → copy) and press Enter. Nothing appears on screen while you paste; that is normal. The installer refuses anything that is not the Lumière production database.
4. The installer runs the first backup straight away and prints `SUCCESS` with the file name.

### If the first backup fails to connect

`last-run.json` then says `pg_dump failed: … could not connect / timeout / prepared statement …`. Use the **Session pooler** address instead:

1. Open Supabase → your project → **Connect** (top bar).
2. Choose **Session pooler**: port **5432**, host like `aws-0-<region>.pooler.supabase.com`, user `postgres.rheronevecsffaejteoj`. Copy it.
3. Put the database password in place of `[YOUR-PASSWORD]`. It is the same password as in Replit's `DATABASE_URL`.
4. On the VPS: `cd ~/lumiere-backup && sudo bash install.sh --set-db-url` and paste it.

Why: the direct address can be IPv6-only, and the "Transaction pooler" (port 6543) cannot run a backup.

## Check

```bash
sudo cat /var/backups/lumiere-portal/last-run.json      # "status":"PASS" and the time of the last run
systemctl list-timers lumiere-backup.timer              # when the next run is
sudo ls -lh /var/backups/lumiere-portal                 # the encrypted copies
journalctl -u lumiere-backup -n 40                      # log of the last runs (no secrets, no data)
```

- Run a backup now: `sudo systemctl start lumiere-backup.service`
- The database password changed: `cd ~/lumiere-backup && sudo bash install.sh --set-db-url`

## Restore (owner only; never straight over production)

Follow `docs/s34/S34-BACKUP-RESTORE-RUNBOOK.md` §5. In short:

1. Copy the chosen `.dump.age` file to your computer:
   `scp ovh-sign:/var/backups/lumiere-portal/lumiere-portal-<time>.dump.age .`
   The file is root-only on the VPS, so first run `sudo cp … /tmp/ && sudo chown $USER /tmp/…` there.
2. Decrypt it with your **offline recovery key** (the same key file as for ClientDesk):
   `age -d -i <offline-key-file> -o portal.dump lumiere-portal-<time>.dump.age`
3. Restore into a **new, separate** Supabase project or scratch database first:
   `pg_restore --no-owner -d "<scratch database URL>" portal.dump`
   One message, `schema "public" already exists`, is expected and harmless.
4. Check the records (runbook §6) before anything touches production.

## Rollback

```bash
sudo systemctl disable --now lumiere-backup.timer
```

Existing backup files stay until you delete them.

Tests: `tests/s34-ovh-backup-script.test.ts` runs the script end to end on a real local PostgreSQL. It covers the encrypt and verify steps, a restore with the offline key into a fresh database (identical rows, row-level security kept), retention, and refusing the wrong project, a missing table or a missing offline key.
