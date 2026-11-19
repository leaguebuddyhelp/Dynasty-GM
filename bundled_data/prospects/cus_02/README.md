# CUS02 prospect cards

`/prospects` offers a class selector for CUS01 and CUS02. Class 2 currently publishes four quarterbacks, nine halfbacks and seven receivers with complete appearance details in `bundled_data/madden/Madden - CUS02.json`. Other positions stay unpublished until their source details and profiles are ready.

`profiles.json` contains authored 35–45-word scouting bios based on each player's source `bio` notes, simulated final college-season statistics, and portrait filenames keyed by source record ID. These statistics are not imported results and do not affect progression or awards. Cards label them as simulated. The source spelling `Ole MIss` displays as Ole Miss.

The 13 transparent portraits were regenerated using built-in imagegen from the CUS02 source appearance details. Individual prompts are recorded in `qb-hb-portrait-prompts.json`; current assets are stored in `portraits/`. Older roster and prompt files record the earlier selected-portrait workflow and are not the class 2 card source.

The receivers include Michael Oluwafemi's existing early-board portrait and six new transparent portraits generated using the prompts in `wr-portrait-prompts.json`.

`/earlytop10` also offers CUS02. Its preseason rankings and scouting direction come from `bundled_data/madden/Madden - CUS02 - Early Top 10.json`; its separate 35–45-word bios live in `early-top-10-bios.json`. Seven additional portraits use the appearance details in the CUS02 prospect source and are recorded in `early-top-10-portrait-prompts.json`. Players already published in `/prospects` reuse their existing portraits. An early-only portrait does not itself publish a player in the later `/prospects` browser.
