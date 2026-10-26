-- 0002: member address commitments and a member-list version.
--
-- address_commitment: SHA-256 fingerprint of the address a member registered (see packages/crypto addressCommitment).
-- Givers compare it with the address inside their sealed assignment, so a host who authors assignments cannot
-- silently substitute an address. It is written by the member's browser at joining and never changes.
--
-- members_version: bumped whenever the set of members or any member's public key changes (join, leave, removal,
-- credential rotation). The draw's compare-and-swap requires the version the host's browser read, so a draw cannot
-- be sealed to a key that has since been replaced, and a member joining mid-draw is detected atomically.

ALTER TABLE members ADD COLUMN address_commitment TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN members_version INTEGER NOT NULL DEFAULT 0;
