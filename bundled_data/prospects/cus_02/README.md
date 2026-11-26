# CUS02 prospect cards

`/prospects` offers a class selector for CUS01 and CUS02. Class 2 currently publishes ten quarterbacks, 27 halfbacks, 24 receivers, seven tight ends, one free safety and one right edge defender. Completed entries in `bundled_data/madden/Madden - CUS02 - Big Board.json` supply card details as the class is filled in by position. Existing cards use `bundled_data/madden/Madden - CUS02.json` until their entries are ready. New board entries without a round and pick appear as unranked.

`profiles.json` contains authored 40–50-word scouting bios based on each player's source `bio` notes, portrait filenames keyed by stable profile ID, and simulated final college-season statistics where available. Cards label those statistics as simulated. The source spelling `Ole MIss` displays as Ole Miss.

Simulated totals vary by player and games played. A Heisman mention in the source bio adds the Heisman emoji to a prospect card; the early board only uses its own early notes for that indicator. Stable profile IDs are matched to source records by name and position so source reordering does not reassign portraits.

The 13 transparent portraits were regenerated using built-in imagegen from the CUS02 source appearance details. Individual prompts are recorded in `qb-hb-portrait-prompts.json`; current assets are stored in `portraits/`. Older roster and prompt files record the earlier selected-portrait workflow and are not the class 2 card source.

The receivers include Michael Oluwafemi's existing early-board portrait and six new transparent portraits generated using the prompts in `wr-portrait-prompts.json`.

The seven tight end portraits were generated with the prompts in `te-portrait-prompts.json`.

Fifteen additional players with completed appearance fields have portraits stored for later use. They are listed with their source IDs and prompts in `future-player-portrait-prompts.json`. Their scouting bios are not yet supplied, so these portraits do not publish additional `/prospects` cards.

The four additional published players use portraits generated from `additional-player-portrait-prompts.json`; their bios describe the provided information and their season stats are simulated.

The expanded quarterback group uses Will Hoggard's existing early-board portrait. The four first-time quarterback portrait prompts are recorded in `big-board-portrait-prompts.json`.

The expanded halfback group adds 18 scouting profiles based on the Big Board notes. Their first-time portrait prompts are recorded in `hb-portrait-prompts.json`.

The expanded receiver group adds 16 scouting profiles and updates Derick Soliz’s bio from the Big Board. The 16 new portrait prompts are recorded in `big-board-wr-portrait-prompts.json`.

`/earlybigboard` also offers 32 CUS02 preseason prospects. Its rankings and scouting direction come from `bundled_data/madden/Madden - CUS02 - Early Big Board.json`; its separate 40–50-word bios live in `early-top-10-bios.json`. The board uses portraits from completed prospect cards, `early-top-10-portrait-prompts.json` and `future-player-portrait-prompts.json`. An early-board portrait does not itself publish a player in the later `/prospects` browser.
