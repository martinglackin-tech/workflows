/* Popular channel lists, used by "Popular channels only".
 *
 * For each country: the channels to keep, most popular first, under the group they go in.
 * When a country is curated, only channels on its list are kept (up to the maximum you set),
 * in this order. Edit freely: add, remove or move lines.
 *
 * Names match the cleaned channel name, ignoring spaces and capitals, and may be followed by
 * East/West/HD/a number etc. A * at the end means "anything may follow", used for networks with
 * many local stations (ABC 7 New York, Nine Sydney…); only one station per line is kept,
 * preferring East / New York / Toronto / Sydney.
 * Separate different spellings of the same channel with | ("Seven* | Channel 7*"); only one is kept.
 */
(function (root) {
  const CURATED = {
    US: {
      'Main Channels': ['ABC*', 'CBS*', 'NBC*', 'FOX*', 'PBS*', 'The CW* | CW* | WPIX', 'ION*'],
      'News': ['CNN', 'Fox News', 'MSNBC | MS NOW', 'CNBC', 'NewsNation', 'Fox Business', 'HLN', 'Bloomberg TV',
        'CBS News', 'ABC News Live | ABC News', 'NBC News Now', 'TODAY All Day', 'NBC News*', 'NBCLX | NBC LX', 'Newsmax', 'The Weather Channel', 'Fox Weather', 'C-SPAN | C-SPAN 1',
        'One America News | OAN', 'Scripps News | Newsy', 'WGN*', 'BBC News'],
      'Entertainment': ['TNT', 'TBS', 'USA Network', 'FX', 'AMC', 'A&E', 'HGTV', 'TLC', 'Food Network', 'Discovery Channel | Discovery',
        'History', 'Bravo', 'E!', 'Comedy Central', 'Paramount Network', 'Lifetime', 'Hallmark Channel', 'Freeform',
        'Syfy', 'FXX', 'BBC America', 'National Geographic', 'Nat Geo Wild', 'Animal Planet', 'Travel Channel',
        'Smithsonian Channel', 'Science Channel | Science', 'Magnolia Network', 'OWN', 'WE tv', 'BET', 'VH1', 'MTV', 'CMT',
        'TV Land', 'truTV', 'Game Show Network', 'Cooking Channel', 'Reelz', 'Motor Trend', 'Destination America',
        'Hallmark Family | Hallmark Drama', 'Ovation', 'Pop', 'Nick at Nite', 'Adult Swim',
        'Discovery Life', 'FYI', 'AXS TV', 'Great American Family', 'Cozi TV', 'Laff', 'Buzzr', 'TV One',
        // streaming channels some providers carry (Peacock, Pluto…)
        'SNL Vault', 'Fallon Tonight', 'LOL Network', 'This Old House', 'Rotten Tomatoes'],
      'Movies': ['HBO', 'Showtime', 'Starz', 'Cinemax', 'TCM | Turner Classic Movies', 'MGM+ | Epix',
        'Hallmark Movies & Mysteries | Hallmark Movies & Mystery', 'FXM | FX Movie Channel', 'Sundance TV', 'IFC',
        'Lifetime Movie Network | LMN | Lifetime Movies', 'Sony Movie Channel', 'HBO 2', 'HBO Signature', 'HBO Comedy',
        'HBO Family', 'HBO Zone', 'HBO Hits', 'HBO Drama', 'Showtime 2', 'Starz Edge', 'Starz Comedy', 'Starz Encore',
        'MoreMax | Cinemax MoreMax', 'ActionMax | Cinemax Action', 'MGM+ Hits | Epix Hits | Epix 2', 'Showtime Showcase',
        'Showtime Extreme', 'ThrillerMax | Cinemax ThrillerMax', 'Starz Cinema', 'Starz Encore Action',
        'Starz Encore Classic', 'Paramount+ with Showtime', 'Flix', 'The Movie Channel', 'MoviePlex',
        'MovieMax | Cinemax MovieMax', '5StarMax | Cinemax 5StarMax', 'Showtime Next', 'Showtime Women', 'Showtime Beyond',
        'Starz In Black', 'Starz Encore Suspense', 'Starz Encore Westerns', 'Starz Encore Black'],
    },
    CA: {
      'Main Channels': ['CBC*', 'CTV*', 'Global*', 'Citytv*', 'CTV 2*', 'CHCH*'],
      'News': ['CBC News Network', 'CTV News Channel', 'CP24', 'Global News', 'BNN Bloomberg', 'CPAC', 'CNN', 'CNN International'],
      'Entertainment': ['CTV Drama Channel', 'CTV Comedy Channel', 'CTV Sci-Fi Channel', 'CTV Life Channel', 'HGTV',
        'Food Network', 'History', 'Discovery', 'W Network', 'Showcase', 'Slice', 'National Geographic', 'Magnolia Network',
        'CMT', 'Much', 'Makeful', 'Cottage Life', 'T+E', 'Gusto', 'OWN', 'Animal Planet', 'Adult Swim', 'Lifetime',
        'A&E', 'AMC', 'Bravo', 'E!', 'Crave 1', 'Crave 2', 'Crave 3', 'Crave 4', 'HBO', 'HBO 2'],
      'Movies': ['Super Channel Fuse', 'Super Channel Heart & Home', 'Super Channel Vault', 'Starz', 'Hollywood Suite*',
        'MovieTime', 'TCM | Turner Classic Movies', 'Crave Movies*'],
    },
    AU: {
      'Main Channels': ['ABC TV | ABC', 'Seven* | Channel 7* | 7 Network*', 'Nine* | Channel 9* | 9 Network*', 'Channel 10* | 10* | Network 10*',
        'SBS*', '7two', '7mate', '7flix', '9Gem', '9Go! | 9Go', '9Life', '9Rush', '10 Peach', '10 Bold', '10 Drama',
        '10 Comedy', 'SBS Viceland', 'ABC Entertains', 'ABC Family'],
      'News': ['ABC News', 'Sky News Australia | Sky News', 'Sky News Extra', 'CNN', 'BBC News', 'Fox News',
        'SBS WorldWatch'],
      'Entertainment': ['Fox8', 'Fox Showcase', 'Fox Comedy', 'Fox Arena', 'Fox One', 'Fox Classics', 'BBC First',
        'BBC UKTV | UKTV', 'Lifestyle', 'Lifestyle Home', 'Lifestyle Food', 'Discovery | Discovery Channel', 'Animal Planet',
        'National Geographic', 'History', 'A&E', 'Comedy Central', 'MTV', 'Universal TV', 'Syfy', 'E!', 'TLC',
        'Foxtel Arena', 'Hallmark', 'SBS Food'],
      'Movies': ['Foxtel Movies Premiere', 'Foxtel Movies Comedy', 'Foxtel Movies Family', 'Foxtel Movies Action',
        'Foxtel Movies Thriller', 'Foxtel Movies Drama', 'Foxtel Movies Romance', 'Foxtel Movies Masterpiece',
        'Foxtel Movies Greats', 'Foxtel Movies Hits', 'SBS World Movies', '7flix'],
    },
  };
  if (typeof module !== 'undefined') module.exports = CURATED;
  else root.CURATED_CHANNELS = CURATED;
})(typeof window !== 'undefined' ? window : globalThis);
