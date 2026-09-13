# Genie: reach and first-trial audit

Observed on 2026-09-14 JST. Goal: genuine GitHub adoption and useful tester feedback, with a path to business use. This work does **not** establish that the star-growth goal has been achieved.

## Baseline and what it means

[Metric snapshot](metrics.json): **0 stars**, 0 forks, 13 repository views / 12 unique visitors in the returned 14-day window. The daily series ends September 12 UTC, before the new Zenn article was published. Owner checks may be included. Clones and release downloads include automation and verification; they are not tester counts. No external open issue report was present.

TikTok Studio's Genie row displayed 0 views, likes and comments. Its aggregate dashboard displayed `--` and an earlier chart period. This does not establish a restriction, rejection, or content-quality diagnosis. Zenn's dashboard explicitly says statistics normally appear the following day; the Genie article was not yet listed. Views for other FORIFOR articles were excluded.

**Working hypothesis:** reach is currently too small to judge the positioning. The setup burden is independently observable: several prerequisite tools, local infrastructure and three running processes precede the first task. Improve that path while seeking readers who already use Mac + Ollama.

## Actions

- Added a standalone, read-only [local preview diagnostic](../../../scripts/doctor-local-preview.mjs) and a [single-page Japanese first-start guide](../../LOCAL_PREVIEW.ja.md). The diagnostic also works outside the v0.1.4 checkout; it does not change the version of the app or backend. Worker/Host operation and task completion remain explicit unchecked items.
- Updated README and website tester wording around one concrete trial: notes → plan → reopen in Work → Markdown export. The Japanese website links directly to the first-start guide. This is an audience hypothesis, not a measured conversion win.
- Corrected the TikTok `@foriforapps` bio from `FORIFOR/astra` to `FORIFOR/genie`, verified in the rendered profile. Corrected the Facebook page's Genie website link to the new domain. Both remain multi-product FORIFOR accounts.
- Published [a technical Zenn introduction on the FORIFOR Facebook page](https://www.facebook.com/permalink.php?story_fbid=pfbid0EQKVof1iAKkxPauws4KasVooTuZ9TwfQ7K428f8b2rEGcZ5SKwHgEDb2QAruyS3Nl&id=61593966556275). Verified public visibility and Page ID `61593966556275`; promotion and story sharing were off.
- Submitted [Ollama integration PR #18428](https://github.com/ollama/ollama/pull/18428). One Desktop-list entry, with developer-preview and local-service requirements. **Submission is not acceptance.** The PR cites existing real Ollama evidence and discloses AI assistance.

The existing TikTok video description still contains the old repository name. Its edit control was disabled in Studio; the updated profile gives the current path. No duplicate upload, deletion, or account restriction workaround was attempted.

## Validation

The diagnostic's 10 regression tests passed, as did the existing helper's 2 tests, formatting and whitespace checks. An independent review found and verified fixes for a missing loopback binding and package-manager version probes that could otherwise provision software. The diagnostic suite now runs in CI. On this Mac, the diagnostic correctly reported missing checkout configuration and PATH/version prerequisites while reading the already-running local services; it did not change that environment. This is not a fresh full-app acceptance run.

Website changes preserve the existing media and layout. Both language entrypoints, local asset references, fragment links, JavaScript syntax, and the first-start link's aggregate event classification were checked. No new tracking identifiers or model requests were added.

## Why these channels

[Ollama's README](https://github.com/ollama/ollama#community-integrations) invites integration PRs; its [contribution guide](https://github.com/ollama/ollama/blob/main/CONTRIBUTING.md) allows small documentation updates without a prior proposal. Searches for Genie, FORIFOR, and the old/new repository URL found no existing matching PR.

The [Zenn guidelines](https://zenn.dev/guideline) favor useful technical knowledge over promotional volume. The existing article already includes reproducible examples and failed attempts, so the next action was distribution, not another promotional article.

[HN's guidelines](https://news.ycombinator.com/newsguidelines.html) prohibit generated or AI-edited text. No autonomous HN post was made. The [September r/macapps App Pile](https://www.reddit.com/r/macapps/comments/1w4brkd/megathread_the_app_pile_september_2026/) and its [moderator policy](https://www.reddit.com/r/macapps/comments/1ryaeex/rmacapps_mods_went_too_far_whats_changing_phase_3/) have participation and frequency conditions; no qualified account was verified, so no Reddit post was made.

## Next decision rules

1. Compare time windows that actually include these publications. Keep stars, article views, site actions, and concrete trial reports separate; exclude known owner/test activity where possible.
2. If qualified readers arrive but report setup blockers, fix the common first blocker before adding more features or widening the audience. The next substantial product improvement is consolidating local service startup.
3. If readers reach a saved result, ask which real workflow they would repeat. Use that evidence for the next demonstration and, where they request it, a scoped business conversation.
4. If reach remains low after statistics catch up, try another relevant, rules-compatible integration directory or community with a verified brand identity. Do not repeat the same post across unrelated groups.

A useful intermediate checkpoint is three independent first-trial reports. It is not a substitute for the star-growth goal, and stars are never required in exchange for support. No personal-account posts, paid promotion, unsolicited DMs, fake engagement, new model generations, or new background monitoring were part of this round. Project-wide licensing remains a separate owner decision; Genie is described as a public-source developer preview, not as an open-source-licensed project.
