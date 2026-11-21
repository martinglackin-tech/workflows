# Channel Fixer

Turns a messy IPTV channel list (Xtream Codes login or M3U) into a clean playlist for TiviMate:

- **Clean names**: `UK: BBC ONE FHD ᴿᴬᵂ` becomes **BBC One**. It removes country prefixes, quality tags, stars, emoji and separator rows like `##### UK BACKUP #####`.
- **Proper logos and categories**. Logos come first from [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos) (about 10,700 high-quality logos on GitHub). Channel details come from the free [iptv-org](https://github.com/iptv-org/database) catalogue (about 32,000 channels with categories and regional versions). Most iptv-org logos are hosted on Imgur, which blocks UK visitors, so Imgur links are only used as a last resort. The **"Logo on Imgur"** filter shows any that are left.
- **Merged duplicates**: SD / HD / FHD / 4K copies become one channel, using the quality you prefer. **Test streams** checks which copy actually plays and switches to it.
- **TV-style order**: main channels first (BBC One, BBC Two, ITV1, Channel 4… for the UK), then Entertainment, Movies, Sports, News, Documentary, Kids and so on. Channel numbers are set.
- **Regional and +1 versions** (BBC One London, ITV1 Granada, E4 +1) go in their own group, straight after the main channel, or are hidden.
- **Pick your countries** in the order you want them. Nothing is deleted, so you can change them at any time.
- **One playlist per country** (or one combined), each numbered from 1, to add to TiviMate separately.
- **Leave out** channels that aren't in English, sports, true crime, religious, kids, channels that don't fit a group ("Other"), regional versions (except for countries you name, UK by default), and any words you list (for example `shopping, quiz`).
- **Popular channels only** for the US, Canada and Australia: keeps just the best-known entertainment, film and news channels (up to 120 each, one local station per network), in TV order. The lists are in `curated.js`, most popular first, and are easy to edit.
- **Always include**: channels to keep even when a filter would drop them, for example `Sky Sports Tennis: FHD, HD` keeps both copies as separate channels, which helps when one copy stops working.
- **Fix anything by hand**: rename, change the group, set a logo, re-match or hide a channel. Your fixes are saved and reapplied every time you rebuild.
- Keeps the **TV guide** (your provider's EPG link and IDs) and **catch-up** information.

## Logos

- Channels keep your provider's logos. A missing or dead one is replaced with a transparent logo from the tv-logos collection.
- **Your own logos:** put a picture named after the channel (for example `TLC.png`) in the `logos` folder. It wins over everything else. Step 4 lists the channels that still have no logo.
- **Serve logos from this computer** (on by default): when you share, the helper saves every logo once and the playlists point TiviMate at this computer, so logos keep working even if the original site goes away. This needs `--lan`.

### Logos stored on the TV (no computer needed)

Set **Where TiviMate gets the logos** to **From a folder on the TV**, then click **Download logos for the TV (.zip)**.
Unzip it and copy the `Logos` folder to the TV's internal storage (USB stick plus a file manager app such as
X-plore or File Commander), so it ends up at `/storage/emulated/0/Logos`. Share or download the playlists again;
their logo links now point at that folder (`file:///storage/emulated/0/Logos/…`). TiviMate needs permission to read
storage (Android TV Settings → Apps → TiviMate → Permissions). Repeat the zip and copy when channels change.

## Running it

You need Python 3 (free from python.org; it's already on Mac and Linux). No extra packages are needed.

```
cd channel-fixer
python3 server.py            # Windows: py server.py
```

Then open **http://localhost:8765** in a browser.

To let your TV load the playlist straight from your computer, start the helper with `--lan` instead:

```
python3 server.py --lan
```

After you click **Share all on my home network**, the page shows a link for each playlist, such as `http://192.168.1.20:8765/playlists/uk.m3u` and `.../playlists/tennis.m3u`, to add in TiviMate. The computer has to stay on for TiviMate to refresh the playlist.

Without the helper, you can still open `index.html` (or a hosted copy of it) and use the **M3U file** tab. Logging in with your Xtream details needs the helper because browsers block direct requests to IPTV servers.

## Adding it to TiviMate

1. Settings → Playlists → **Add playlist** → **M3U playlist**, then enter the link or pick the downloaded file.
2. The playlist already points TiviMate at your provider's EPG. If the guide stays empty, add the EPG link shown on the page under Settings → EPG.
3. For films and series, keep your normal Xtream login as a second playlist and hide its live channels.

## Good to know

- The output is a snapshot. When your provider adds or renames channels, reload and click **Share** (or download) again. Your fixes carry over.
- TiviMate can't nest channels, so regional versions sit in a group or straight after the main channel rather than "inside" it.
- Channels the catalogue doesn't know are kept with a cleaned name and your provider's logo, unless you turn that off.
- Your login stays on your computer. It goes only to your provider, and into the playlist's stream links, which is how every IPTV playlist works. **Don't share the playlist file.** The `data/` folder holds your saved fixes, the shared playlist and a cached copy of the catalogue.
- Stream testing runs one stream at a time on purpose, because many providers allow only one or two connections.
