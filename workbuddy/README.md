# WorkBuddy

An optional Sailry model provider package. Sign-in, refresh, HTTP, cancellation
and credentials stay on the execution Node. The translation module receives
conversation content, but not credentials. A separate, explicitly consented
authentication transform normalizes token response fields.

The package offers China, WorkBuddy International and CodeBuddy International
routes. Select the route for the account being signed in. Model discovery reads
that route's real configuration catalog; it does not infer capabilities from
model names or invent fallback model limits.

The package does not read another application's profile, import its credentials,
manage an account pool, inspect billing, or replace the Agent engine. Sign-in
uses the service's browser challenge. Account-profile metadata is not fetched;
requests use the upstream's supported missing-user and missing-enterprise headers.

Protocol rules come from the reviewed third-party revision in NOTICE. Synthetic
package fixtures cover wire behavior; they do not prove live account access.
There is no automatic account switching, request replay or DSML tool recovery.
