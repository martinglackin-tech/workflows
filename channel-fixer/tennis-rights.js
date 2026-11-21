/* Grand Slam TV rights, used to build the Tennis playlist.
 *
 * Rights change, so edit this list whenever you like. Each line says:
 *   in these countries (cc), these channels show this tournament.
 * Country codes are the ones shown on the country chips (UK, US, DE, …).
 * "EU" means the European countries listed in EUROPE below.
 * Channel names match the cleaned name, ignoring spaces and capitals:
 *   "Eurosport"  matches Eurosport, Eurosport 1, Eurosport 2 (a number may follow)
 *   "beIN Sports*"  the * means anything may follow (beIN Sports 3 Premium, …)
 *
 * Based on 2026 broadcaster guides; double-check before relying on it.
 */
(function (root) {
  const EUROPE = ['AT', 'BE', 'BG', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IT', 'LT',
    'LV', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'TR', 'EXYU'];
  const ARAB = ['ARAB', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'EG', 'MA', 'DZ', 'TN', 'JO', 'LB', 'IQ'];
  const AFRICA = ['AFR', 'ZA', 'NG', 'KE', 'GH'];
  const LATAM = ['LATAM', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'UY', 'PY', 'BO', 'CR', 'PA', 'DO', 'GT', 'CARIB'];
  const NINE = ['Nine*', 'Channel 9*', '9 Network*', '9Gem', '9Go', 'Stan Sport*'];

  const rights = [
    // ---------------- Australian Open (January)
    { slam: 'Australian Open', cc: ['AU'], channels: NINE },
    { slam: 'Australian Open', cc: ['UK', 'IE'], channels: ['TNT Sports', 'Eurosport'] },
    { slam: 'Australian Open', cc: ['US'], channels: ['ESPN', 'ESPN Deportes', 'Tennis Channel*'] },
    { slam: 'Australian Open', cc: ['CA'], channels: ['TSN', 'RDS'] },
    { slam: 'Australian Open', cc: ['EU'], channels: ['Eurosport'] },
    { slam: 'Australian Open', cc: ['NZ'], channels: ['Sky Sport*'] },
    { slam: 'Australian Open', cc: ['JP'], channels: ['WOWOW*'] },
    { slam: 'Australian Open', cc: ['IN'], channels: ['Sony Sports*', 'Sony Ten*'] },
    { slam: 'Australian Open', cc: ['CN'], channels: ['CCTV 5', 'CCTV 5+'] },
    { slam: 'Australian Open', cc: ARAB, channels: ['beIN Sports*'] },
    { slam: 'Australian Open', cc: AFRICA, channels: ['SuperSport*', 'beIN Sports*'] },
    { slam: 'Australian Open', cc: LATAM, channels: ['ESPN*'] },

    // ---------------- Roland Garros / French Open (May–June)
    { slam: 'Roland Garros', cc: ['FR'], channels: ['France 2', 'France 3', 'France 4', 'Eurosport'] },
    { slam: 'Roland Garros', cc: ['UK', 'IE'], channels: ['TNT Sports'] },
    { slam: 'Roland Garros', cc: ['US'], channels: ['TNT', 'truTV'] },
    { slam: 'Roland Garros', cc: ['CA'], channels: ['TSN', 'RDS'] },
    { slam: 'Roland Garros', cc: ['EU'], channels: ['Eurosport'] },
    { slam: 'Roland Garros', cc: ['CH'], channels: ['SRF*', 'RTS*', 'RSI*'] },
    { slam: 'Roland Garros', cc: ['AU'], channels: NINE },
    { slam: 'Roland Garros', cc: ['JP'], channels: ['WOWOW*'] },
    { slam: 'Roland Garros', cc: ['IN'], channels: ['Sony Sports*', 'Sony Ten*'] },
    { slam: 'Roland Garros', cc: ARAB, channels: ['beIN Sports*'] },
    { slam: 'Roland Garros', cc: AFRICA, channels: ['SuperSport*'] },
    { slam: 'Roland Garros', cc: LATAM, channels: ['ESPN*'] },

    // ---------------- Wimbledon (June–July)
    { slam: 'Wimbledon', cc: ['UK'], channels: ['BBC One', 'BBC Two', 'BBC Red Button*'] },
    { slam: 'Wimbledon', cc: ['US'], channels: ['ESPN', 'ABC'] },
    { slam: 'Wimbledon', cc: ['CA'], channels: ['TSN', 'RDS'] },
    { slam: 'Wimbledon', cc: ['FR'], channels: ['beIN Sports*'] },
    { slam: 'Wimbledon', cc: ['ES'], channels: ['Movistar*', 'M+*'] },
    { slam: 'Wimbledon', cc: ['IT'], channels: ['Sky Sport*'] },
    { slam: 'Wimbledon', cc: ['PT'], channels: ['Sport TV*'] },
    { slam: 'Wimbledon', cc: ['BE', 'BG', 'CZ', 'HU', 'NL', 'PL', 'RO', 'SK', 'SE', 'NO', 'DK', 'FI', 'GR', 'HR', 'RS', 'SI', 'EXYU'], channels: ['Eurosport'] },
    { slam: 'Wimbledon', cc: ['AU'], channels: NINE },
    { slam: 'Wimbledon', cc: ['JP'], channels: ['WOWOW*', 'NHK*'] },
    { slam: 'Wimbledon', cc: ['IN'], channels: ['Star Sports*'] },
    { slam: 'Wimbledon', cc: ARAB, channels: ['beIN Sports*'] },
    { slam: 'Wimbledon', cc: AFRICA, channels: ['SuperSport*'] },
    { slam: 'Wimbledon', cc: LATAM.concat(['BR']), channels: ['ESPN*'] },

    // ---------------- US Open (August–September)
    { slam: 'US Open', cc: ['UK', 'IE'], channels: ['Sky Sports Tennis', 'Sky Sports Main Event', 'Sky Sports+', 'Sky Sports Plus'] },
    { slam: 'US Open', cc: ['IE'], channels: ['TG4'] },
    { slam: 'US Open', cc: ['US'], channels: ['ESPN', 'ABC'] },
    { slam: 'US Open', cc: ['CA'], channels: ['TSN', 'RDS'] },
    { slam: 'US Open', cc: ['EU'], channels: ['Eurosport'] },
    { slam: 'US Open', cc: ['ES'], channels: ['Movistar*', 'M+*'] },
    { slam: 'US Open', cc: ['AU'], channels: NINE },
    { slam: 'US Open', cc: ['JP'], channels: ['WOWOW*'] },
    { slam: 'US Open', cc: ['IN'], channels: ['Sony Sports*', 'Sony Ten*'] },
    { slam: 'US Open', cc: ['BR'], channels: ['ESPN*', 'SporTV*'] },
    { slam: 'US Open', cc: LATAM, channels: ['ESPN*'] },
    { slam: 'US Open', cc: ARAB, channels: ['beIN Sports*'] },
    { slam: 'US Open', cc: AFRICA, channels: ['SuperSport*'] },
  ];
  for (const r of rights) r.cc = r.cc.flatMap(c => (c === 'EU' ? EUROPE : [c]));

  const TENNIS_RIGHTS = {
    slams: ['Australian Open', 'Roland Garros', 'Wimbledon', 'US Open'],
    rights,
    // Words in a channel's name or group that mark it as a tennis channel or tennis event feed.
    // "us open" counts only when golf isn't mentioned.
    slamWords: {
      'Australian Open': /australian\s*open|\bao\s*20\d\d\b/i,
      'Roland Garros': /roland\s*garros|french\s*open/i,
      'Wimbledon': /wimbledon/i,
      'US Open': /\bus\s*open\b/i,
    },
    tennisWords: /tennis|\batp\b|\bwta\b|davis\s*cup|laver\s*cup|united\s*cup|billie\s*jean|bjk\s*cup|\bitf\b/i,
  };
  if (typeof module !== 'undefined') module.exports = TENNIS_RIGHTS;
  else root.TENNIS_RIGHTS = TENNIS_RIGHTS;
})(typeof window !== 'undefined' ? window : globalThis);
