# CUS02 prospect cards

`/prospects` offers a class selector for CUS01 and CUS02. Class 2 currently publishes five quarterbacks, nine halfbacks, eight receivers, seven tight ends, one free safety and one right edge defender with complete appearance details in `bundled_data/madden/Madden - CUS02.json`. Other positions stay unpublished until their source details and profiles are ready. Four newly supplied players are unranked until board positions are provided.

`profiles.json` contains authored 35–45-word scouting bios based on each player's source `bio` notes, simulated final college-season statistics, and portrait filenames keyed by source record ID. These statistics are not imported results and do not affect progression or awards. Cards label them as simulated. The source spelling `Ole MIss` displays as Ole Miss.

The 13 transparent portraits were regenerated using built-in imagegen from the CUS02 source appearance details. Individual prompts are recorded in `qb-hb-portrait-prompts.json`; current assets are stored in `portraits/`. Older roster and prompt files record the earlier selected-portrait workflow and are not the class 2 card source.

The receivers include Michael Oluwafemi's existing early-board portrait and six new transparent portraits generated using the prompts in `wr-portrait-prompts.json`.

The seven tight end portraits were generated with the prompts in `te-portrait-prompts.json`.

Fifteen additional players with completed appearance fields have portraits stored for later use. They are listed with their source IDs and prompts in `future-player-portrait-prompts.json`. Their scouting bios are not yet supplied, so these portraits do not publish additional `/prospects` cards.

The four additional published players use portraits generated from `additional-player-portrait-prompts.json`; their bios describe the provided information and their season stats are simulated.

`/earlybigboard` also offers 32 CUS02 preseason prospects. Its rankings and scouting direction come from `bundled_data/madden/Madden - CUS02 - Early Big Board.json`; its separate 35–45-word bios live in `early-top-10-bios.json`. The board uses portraits from completed prospect cards, `early-top-10-portrait-prompts.json` and `future-player-portrait-prompts.json`. An early-board portrait does not itself publish a player in the later `/prospects` browser.
