BEGIN;

-- Invitation uses are cumulative statistics, not a participation quota.
ALTER TABLE app_private.invites
  ALTER COLUMN max_uses DROP NOT NULL,
  DROP CONSTRAINT invites_max_uses_check,
  DROP CONSTRAINT invites_check,
  ADD CONSTRAINT invites_uses_check CHECK (uses >= 0);

-- Retain old max_uses values as legacy metadata so the previous app version
-- can still read existing invitations while the new version is deployed.
-- The new app ignores these values and creates invitations with max_uses NULL.

COMMIT;
