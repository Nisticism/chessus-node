/*
 * The site's own account.
 *
 * GridGrove publishes work under a system account rather than under a person:
 * the generated daily puzzles, and the games that shipped with the site -
 * Chess, Go - which nobody invented here and which should not sit in one
 * person's "My Games" as though they had.
 *
 * The name is mirrored from PLATFORM_ACCOUNT_USERNAME in server/index.js. It is
 * the name and not an id on purpose: the account's id is a different number on
 * every database, so anything the client hard-codes has to be the name.
 */
export const PLATFORM_ACCOUNT_USERNAME = 'GridGrove';

/**
 * Is this game one the platform owns?
 *
 * Takes whatever shape the caller has - a game row with creator_username, or
 * just the name - because the two listings that ask hold different objects.
 */
export const isPlatformGame = (game) =>
  !!game && String(game.creator_username || game.creatorUsername || '') === PLATFORM_ACCOUNT_USERNAME;

export default PLATFORM_ACCOUNT_USERNAME;
