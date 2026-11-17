# CUS01 prospect cards

Run `/prospects` in Discord, choose a position, then choose a player. The browser is private to the operator. Six QBs and seven HBs are published; other positions remain available in the menu with an unpublished notice.

Player measurements, school, class year, jersey, archetype and board rank come from `bundled_data/draft_classes/madden/Madden - CUS01.json`. Overall ratings and development traits are excluded from the published data. This command does not change `/bigboard` or its file selection.

`profiles.json` holds authored fictional biographies and portrait filenames, keyed by source record ID. Stories and personalities are fictional; no college statistics, injuries or career achievements were invented. The card footer identifies fictional biographies and AI portraits. Profiles must match the source name and have all seven appearance fields before publication. To add another position, complete its source appearance fields, add an editorial profile and save its portrait in `portraits/`.

Portraits were generated with the built-in imagegen tool, using individual prompts recorded in `portrait-prompts.json`. Each is an independent fictional adult athlete, in the named school's branded jersey and colors. Background removal edits are recorded in `transparent-portrait-prompts.json`; cards use the resulting transparent PNG cutouts. Jaquon Hall's conflicting hair fields were resolved using the explicit `hair_color: black` value. Vague facial descriptions were interpreted naturally without inferring character or athletic ability from ethnicity or appearance.

HB portraits were generated directly with alpha transparency using the prompts in `hb-portrait-prompts.json`. Cards reuse supplied school emoji IDs where available; schools without a supplied emoji use a text label and school color.

The assets are bundled with the bot and attached directly to Discord cards. There are no runtime AI requests or new API keys required. When deploying, register the `/prospects` command using the existing production command deployment script, then restart/deploy the updated bot.
