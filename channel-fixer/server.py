#!/usr/bin/env python3
"""Channel Fixer local helper.

Serves the Channel Fixer web page and relays the few requests a browser
cannot make on its own (your provider's server rarely allows direct
browser access). Uses only the Python standard library.

    python3 server.py            # open http://localhost:8765
    python3 server.py --lan      # also reachable from your TV / phone
"""
import argparse
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
PLAYLIST_DIR = os.path.join(DATA_DIR, "playlists")
MY_LOGOS_DIR = os.path.join(HERE, "logos")            # logos you add yourself, named after the channel
LOGO_CACHE_DIR = os.path.join(DATA_DIR, "logo-cache")  # logos downloaded so TiviMate loads them from here
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
               ".svg": "image/svg+xml", ".gif": "image/gif"}
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/curated.js": ("curated.js", "text/javascript; charset=utf-8"),
}
IPTV_ORG_API = "https://iptv-org.github.io/api/"
IPTV_FILES = {"channels", "logos", "feeds", "countries"}
TVLOGOS_TREE = "https://api.github.com/repos/tv-logo/tv-logos/git/trees/main?recursive=1"
TVLOGOS_MAX_AGE = 7 * 24 * 3600
CATALOG_MAX_AGE = 24 * 3600
USER_AGENT = "Mozilla/5.0 (Linux; Android 12) ChannelFixer/1.0"
XTREAM_ACTIONS = {"get_live_categories", "get_live_streams", None}


def normalise_server(server):
    server = (server or "").strip()
    if not server:
        raise ValueError("Server address is missing")
    if "://" not in server:
        server = "http://" + server
    parts = urllib.parse.urlsplit(server)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("Server address doesn't look like a web address")
    return f"{parts.scheme}://{parts.netloc}"


def fetch(url, timeout=60, user_agent=USER_AGENT, limit=None):
    req = urllib.request.Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read(limit) if limit else resp.read()
        return resp.status, resp.headers.get("Content-Type", ""), body


def lan_addresses():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


LOGO_CACHE = {}
LOGO_CACHE_FILE = os.path.join(DATA_DIR, "logocheck.json")
LOGO_MAX_AGE = 7 * 24 * 3600
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
IMAGE_MAGIC = (b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"RIFF", b"<svg", b"<?xml", b"\x00\x00\x01\x00")


def logo_works(url):
    if not url.lower().startswith(("http://", "https://")):
        return False
    try:
        status, ctype, body = fetch(url, timeout=8, user_agent=BROWSER_UA, limit=512)
        if status != 200 or not body:
            return False
        head = body.lstrip()[:16]
        return ctype.startswith("image/") or head.startswith(IMAGE_MAGIC)
    except Exception:  # noqa: BLE001
        return False


def check_logos(urls):
    """{url: True/False}; each link is tried once a week, 16 at a time."""
    from concurrent.futures import ThreadPoolExecutor
    if not LOGO_CACHE and os.path.exists(LOGO_CACHE_FILE):
        try:
            with open(LOGO_CACHE_FILE) as fh:
                LOGO_CACHE.update(json.load(fh))
        except (OSError, ValueError):
            pass
    now = time.time()
    todo = [u for u in set(urls) if u not in LOGO_CACHE or now - LOGO_CACHE[u][1] > LOGO_MAX_AGE]
    if todo:
        with ThreadPoolExecutor(16) as pool:
            for u, ok in zip(todo, pool.map(logo_works, todo)):
                LOGO_CACHE[u] = [ok, now]
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(LOGO_CACHE_FILE + ".tmp", "w") as fh:
            json.dump(LOGO_CACHE, fh)
        os.replace(LOGO_CACHE_FILE + ".tmp", LOGO_CACHE_FILE)
    return {u: LOGO_CACHE[u][0] for u in urls}


def download_logo(url):
    """Save one logo into logo-cache (once); returns the file name or None."""
    import hashlib
    ext = os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower()
    name = hashlib.sha1(url.encode()).hexdigest()[:20] + (ext if ext in IMAGE_TYPES else ".png")
    fpath = os.path.join(LOGO_CACHE_DIR, name)
    if os.path.exists(fpath):
        return name
    try:
        status, ctype, body = fetch(url, timeout=15, user_agent=BROWSER_UA, limit=3 * 1024 * 1024)
        head = body.lstrip()[:16]
        if status != 200 or not (ctype.startswith("image/") or head.startswith(IMAGE_MAGIC)):
            return None
        if not os.path.splitext(name)[1] == ".svg" and ctype.startswith("image/svg"):
            name = name.rsplit(".", 1)[0] + ".svg"
            fpath = os.path.join(LOGO_CACHE_DIR, name)
        with open(fpath + ".tmp", "wb") as fh:
            fh.write(body)
        os.replace(fpath + ".tmp", fpath)
        return name
    except Exception:  # noqa: BLE001
        return None


def bundle_logos(urls):
    """{url: cached file name or None}, downloading 16 at a time."""
    from concurrent.futures import ThreadPoolExecutor
    os.makedirs(LOGO_CACHE_DIR, exist_ok=True)
    urls = [u for u in dict.fromkeys(urls) if u.lower().startswith(("http://", "https://"))]
    with ThreadPoolExecutor(16) as pool:
        return dict(zip(urls, pool.map(download_logo, urls)))


# ---------------------------------------------------------------- TV guide gaps
# Free guides from epgshare01 (updated daily). TiviMate downloads them itself, so the computer isn't needed.
FREE_EPG = {
    "UK": ["https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz"],
    "US": ["https://epgshare01.online/epgshare01/epg_ripper_US2.xml.gz",
           "https://epgshare01.online/epgshare01/epg_ripper_US_LOCALS1.xml.gz"],
    "CA": ["https://epgshare01.online/epgshare01/epg_ripper_CA2.xml.gz"],
    "AU": ["https://epgshare01.online/epgshare01/epg_ripper_AU1.xml.gz"],
}
EPG_DIR = os.path.join(DATA_DIR, "epg")
EPG_MAX_AGE = 12 * 3600
# New York stations for the networks, so "CBS (New York)" finds WCBS in the locals guide
NY_CALL_SIGNS = {"abc": "WABC", "cbs": "WCBS", "nbc": "WNBC", "fox": "WNYW", "thecw": "WPIX", "cw": "WPIX",
                 "pbs": "WNET", "ion": "WPXN", "mynetworktv": "WWOR"}
# our name -> the free guide's name for the same channel
EPG_ALIASES = {"hgtv": "homeandgardentelevision", "e": "eentertainmenttelevision", "fxm": "fxmovie",
               "tcm": "turnerclassicmovies", "foxnews": "foxnewschannel", "cnnnews": "cnn",
               "showtime": "paramountpluswithshowtime", "epix": "mgmplus", "epix2": "mgmplushits",
               "mgmplusmarquee": "mgmplusmarquee", "hallmarkdrama": "hallmarkfamily",
               "hallmarkmoviesandmysteries": "hallmarkmystery", "cspan1": "cspan", "cbsnews": "cbsnewsnationalstream",
               "abcnews": "abcnewslive", "wgn": "wgndt", "travelchannel": "thetravelchannel", "travel": "thetravel",
               "mtv": "mtvmusictelevision", "skycinemaselectfeelgood": "skycinemaselect", "skycinemagreats": "skygreats",
               "talktv": "talkradiotalktv", "virginfour": "virginmediafour", "cnbceurope": "cnbc",
               "rteone": "rte1", "kisstv": "kiss", "bbcone": "bbconelon",
               # GREAT! xmas is a seasonal takeover of GREAT! romance's slot
               "greatxmas": "greatromance", "greatchristmas": "greatromance"}
_STYLE = re.compile(r"\b(hd|uhd|fhd|4k|sd|us|usa|uk|east|eastern|\(?pacific\)?|\(?west\)?|\(us\)|feed|national)\b", re.I)


def _norm(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("+", " plus ")
    return re.sub(r"[^a-z0-9]+", "", s)


def _epg_keys(name):
    base = re.sub(r"[._]", " ", name)
    base = re.sub(r"\.(us2|us_locals1|uk|ca2|au1)$", "", base)
    plain = _STYLE.sub(" ", base)
    keys = [_norm(plain)]
    k = keys[0]
    for suffix in ("channel", "network", "television", "tv"):
        if k.endswith(suffix) and len(k) > len(suffix) + 1:
            keys.append(k[: -len(suffix)])
    return [k for k in keys if k]


def _fetch_epg(url):
    """Download (cached) and return the raw XML bytes, or None."""
    import gzip
    import hashlib
    os.makedirs(EPG_DIR, exist_ok=True)
    path = os.path.join(EPG_DIR, hashlib.sha1(url.encode()).hexdigest()[:16] + ".xml")
    if not (os.path.exists(path) and time.time() - os.path.getmtime(path) < EPG_MAX_AGE):
        try:
            _, _, body = fetch(url, timeout=300, user_agent=BROWSER_UA)
            if body[:2] == b"\x1f\x8b":
                body = gzip.decompress(body)
            with open(path + ".tmp", "wb") as fh:
                fh.write(body)
            os.replace(path + ".tmp", path)
        except Exception:  # noqa: BLE001
            if not os.path.exists(path):
                return None
    return path


def _epg_summary(path):
    """(channels {id: [display names]}, ids that have listings from now on)"""
    import xml.etree.ElementTree as ET
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    chans, live = {}, set()
    try:
        for _, el in ET.iterparse(path, events=("end",)):
            if el.tag == "channel":
                chans[el.get("id")] = [d.text or "" for d in el.findall("display-name")]
                el.clear()
            elif el.tag == "programme":
                stop = (el.get("stop") or "")[:14]
                if stop >= now:
                    live.add(el.get("channel"))
                el.clear()
    except ET.ParseError:
        pass
    return chans, live


def epg_fill(provider_epg, channels, prefer_free=False):
    """Find guide listings for channels the provider's guide has nothing for.
    channels: [{key, epgId, cc, names}] -> {"map": {key: {"id", "url"}}, "sources": [...], counts}"""
    provider_live = set()
    if provider_epg and not prefer_free:
        p = _fetch_epg(provider_epg)
        if p:
            provider_live = _epg_summary(p)[1]
    missing = [c for c in channels if not c.get("epgId") or c.get("epgId") not in provider_live]
    indexes = {}
    def index_for(url):
        if url not in indexes:
            p = _fetch_epg(url)
            idx = {}
            if p:
                chans, live = _epg_summary(p)
                for cid, names in chans.items():
                    if cid not in live:
                        continue
                    west = bool(re.search(r"pacific|west|\+1|plus1", cid, re.I))
                    for n in names + [cid]:
                        for k in _epg_keys(n):
                            if k not in idx or (idx[k][1] and not west):
                                idx[k] = (cid, west)
            indexes[url] = idx
        return indexes[url]
    result, used = {}, []
    for c in missing:
        keys = []
        for n in c.get("names") or []:
            for k in _epg_keys(n):
                keys += [EPG_ALIASES.get(k, k), k]  # a deliberate alias wins over the loose name
                if c.get("cc") == "US" and k in NY_CALL_SIGNS:
                    keys.append(_norm(NY_CALL_SIGNS[k] + "-DT"))
            m = re.search(r"\b([WK][A-Z]{3})\b", n or "")
            if m and c.get("cc") == "US":
                keys.append(_norm(m.group(1) + "-DT"))
        keys = [k for k in dict.fromkeys(keys) if k]
        sources = FREE_EPG.get(c.get("cc"), [])
        if any(k.endswith("dt") and len(k) == 6 for k in keys):  # a network: its New York station's guide first
            keys = [k for k in keys if k.endswith("dt") and len(k) == 6] + keys
            sources = sorted(sources, key=lambda u: "LOCALS" not in u)
        for url in sources:
            idx = index_for(url)
            hit = next((idx[k][0] for k in keys if k in idx), None)
            if hit:
                result[c["key"]] = {"id": hit, "url": url}
                if url not in used:
                    used.append(url)
                break
    return {"map": result, "sources": used, "checked": len(channels), "missing": len(missing),
            "filled": len(result), "providerGuide": bool(provider_live)}


def logo_zip(files):
    """A zip with a Logos/ folder: {name in zip: '/logos/<file>' or '/logo-cache/<file>'}."""
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, src in files.items():
            m = re.fullmatch(r"/(logos|logo-cache)/([^/]+)", str(src))
            if not m or not re.fullmatch(r"[a-z0-9.-]+", name):
                continue
            folder = MY_LOGOS_DIR if m.group(1) == "logos" else LOGO_CACHE_DIR
            fpath = os.path.join(folder, urllib.parse.unquote(m.group(2)))
            if os.path.isfile(fpath) and os.path.dirname(os.path.abspath(fpath)) == os.path.abspath(folder):
                z.write(fpath, "Logos/" + name)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "ChannelFixer/1.0"

    # ---------- helpers ----------
    def log_message(self, fmt, *args):
        # Never print query strings: they contain the provider password.
        path = self.path.split("?", 1)[0]
        sys.stderr.write(f"{self.address_string()} {self.command} {path}\n")

    def send_bytes(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, obj):
        self.send_bytes(status, json.dumps(obj).encode(), "application/json")

    def read_body(self, limit=200 * 1024 * 1024):
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ValueError("Request too large")
        return self.rfile.read(length)

    def query(self):
        return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))

    # ---------- routing ----------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path in STATIC:
                name, ctype = STATIC[path]
                with open(os.path.join(HERE, name), "rb") as fh:
                    return self.send_bytes(200, fh.read(), ctype)
            if path == "/api/info":
                return self.send_json(200, {
                    "ok": True,
                    "lan": self.server.lan,
                    "port": self.server.server_address[1],
                    "ips": lan_addresses() if self.server.lan else [],
                    "published": sorted(os.listdir(PLAYLIST_DIR)) if os.path.isdir(PLAYLIST_DIR) else [],
                })
            if path == "/api/xtream":
                return self.xtream()
            if path == "/api/m3u":
                return self.m3u()
            if path.startswith("/api/iptv/"):
                return self.iptv(path[len("/api/iptv/"):])
            if path == "/api/tvlogos":
                return self.tvlogos()
            if path == "/api/probe":
                return self.probe()
            if path == "/api/overrides":
                return self.send_file_or(os.path.join(DATA_DIR, "overrides.json"), b"{}", "application/json")
            if path == "/api/mylogos":
                files = sorted(f for f in os.listdir(MY_LOGOS_DIR)
                               if os.path.splitext(f)[1].lower() in IMAGE_TYPES) if os.path.isdir(MY_LOGOS_DIR) else []
                return self.send_json(200, files)
            lm = re.fullmatch(r"/(logos|logo-cache)/([^/]+)", path)
            if lm:
                name = urllib.parse.unquote(lm.group(2))
                folder = MY_LOGOS_DIR if lm.group(1) == "logos" else LOGO_CACHE_DIR
                ext = os.path.splitext(name)[1].lower()
                fpath = os.path.join(folder, name)
                if "/" in name or name.startswith(".") or ext not in IMAGE_TYPES or not os.path.isfile(fpath):
                    return self.send_json(404, {"error": "No such logo"})
                with open(fpath, "rb") as fh:
                    return self.send_bytes(200, fh.read(), IMAGE_TYPES[ext], {"Cache-Control": "max-age=604800"})
            m = re.fullmatch(r"/playlists/([a-z0-9-]+\.m3u)", path)
            if m:
                return self.send_file_or(os.path.join(PLAYLIST_DIR, m.group(1)), None, "audio/x-mpegurl")
            return self.send_json(404, {"error": "Not found"})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            return self.send_json(500, {"error": f"{type(e).__name__}: {e}"})

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path == "/api/epgfill":
                req = json.loads(self.read_body(20 * 1024 * 1024))
                return self.send_json(200, epg_fill(req.get("epg") or "", req.get("channels") or [], bool(req.get("preferFree"))))
            if path == "/api/logozip":
                files = json.loads(self.read_body(5 * 1024 * 1024)).get("files") or {}
                return self.send_bytes(200, logo_zip(files), "application/zip",
                                       {"Content-Disposition": 'attachment; filename="Logos.zip"'})
            if path == "/api/logobundle":
                urls = json.loads(self.read_body(5 * 1024 * 1024)).get("urls") or []
                return self.send_json(200, bundle_logos([u for u in urls if isinstance(u, str)][:3000]))
            if path == "/api/logocheck":
                urls = json.loads(self.read_body(5 * 1024 * 1024)).get("urls") or []
                return self.send_json(200, check_logos([u for u in urls if isinstance(u, str)][:2000]))
            if path == "/api/overrides":
                body = self.read_body(20 * 1024 * 1024)
                json.loads(body)  # validate
                self.write_data("overrides.json", body)
                return self.send_json(200, {"ok": True})
            if path == "/api/publish":
                files = json.loads(self.read_body()).get("files") or {}
                for name, text in files.items():
                    if not re.fullmatch(r"[a-z0-9-]+\.m3u", name) or not str(text).startswith("#EXTM3U"):
                        raise ValueError(f"Bad playlist: {name}")
                os.makedirs(PLAYLIST_DIR, exist_ok=True)
                for old in os.listdir(PLAYLIST_DIR):
                    if old not in files:
                        os.remove(os.path.join(PLAYLIST_DIR, old))
                for name, text in files.items():
                    self.write_data(os.path.join("playlists", name), text.encode("utf-8"))
                return self.send_json(200, {"ok": True, "files": sorted(files)})
            return self.send_json(404, {"error": "Not found"})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            return self.send_json(500, {"error": f"{type(e).__name__}: {e}"})

    # ---------- endpoints ----------
    def send_file_or(self, fpath, fallback, ctype):
        if os.path.exists(fpath):
            with open(fpath, "rb") as fh:
                return self.send_bytes(200, fh.read(), ctype)
        if fallback is None:
            return self.send_json(404, {"error": "Nothing published yet"})
        return self.send_bytes(200, fallback, ctype)

    def write_data(self, name, body):
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = os.path.join(DATA_DIR, name + ".tmp")
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, os.path.join(DATA_DIR, name))

    def xtream(self):
        q = self.query()
        action = q.get("action") or None
        if action not in XTREAM_ACTIONS:
            raise ValueError("Unsupported action")
        base = normalise_server(q.get("server"))
        params = {"username": q.get("username", ""), "password": q.get("password", "")}
        if action:
            params["action"] = action
        url = f"{base}/player_api.php?{urllib.parse.urlencode(params)}"
        try:
            status, _, body = fetch(url, timeout=120, user_agent=q.get("ua") or USER_AGENT)
        except urllib.error.HTTPError as e:
            return self.send_json(502, {"error": f"Provider answered HTTP {e.code}"})
        except (urllib.error.URLError, OSError) as e:
            reason = getattr(e, "reason", e)
            return self.send_json(502, {"error": f"Couldn't reach the provider: {reason}"})
        return self.send_bytes(200, body, "application/json")

    def m3u(self):
        q = self.query()
        url = (q.get("url") or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("Playlist link must start with http:// or https://")
        try:
            _, _, body = fetch(url, timeout=180, user_agent=q.get("ua") or USER_AGENT)
        except urllib.error.HTTPError as e:
            return self.send_json(502, {"error": f"Provider answered HTTP {e.code}"})
        except (urllib.error.URLError, OSError) as e:
            reason = getattr(e, "reason", e)
            return self.send_json(502, {"error": f"Couldn't reach the provider: {reason}"})
        return self.send_bytes(200, body, "text/plain; charset=utf-8")

    def iptv(self, filename):
        name = filename[:-5] if filename.endswith(".json") else filename
        if name not in IPTV_FILES:
            raise ValueError("Unknown catalogue file")
        os.makedirs(DATA_DIR, exist_ok=True)
        cached = os.path.join(DATA_DIR, f"catalog-{name}.json")
        fresh = os.path.exists(cached) and time.time() - os.path.getmtime(cached) < CATALOG_MAX_AGE
        if not fresh:
            try:
                _, _, body = fetch(IPTV_ORG_API + name + ".json", timeout=120)
                json.loads(body)
                self.write_data(f"catalog-{name}.json", body)
            except Exception as e:  # noqa: BLE001
                if not os.path.exists(cached):
                    return self.send_json(502, {"error": f"Couldn't download the channel catalogue: {e}"})
        with open(cached, "rb") as fh:
            return self.send_bytes(200, fh.read(), "application/json")

    def tvlogos(self):
        """File list of the tv-logo/tv-logos repo (one GitHub request a week)."""
        cached = os.path.join(DATA_DIR, "tvlogos.json")
        fresh = os.path.exists(cached) and time.time() - os.path.getmtime(cached) < TVLOGOS_MAX_AGE
        if not fresh:
            try:
                _, _, body = fetch(TVLOGOS_TREE, timeout=60)
                tree = json.loads(body)["tree"]
                paths = [t["path"] for t in tree
                         if t["path"].startswith("countries/") and t["path"].lower().endswith(".png")]
                self.write_data("tvlogos.json", json.dumps(paths).encode())
            except Exception as e:  # noqa: BLE001
                if not os.path.exists(cached):
                    return self.send_json(502, {"error": f"Couldn't get the logo list: {e}"})
        with open(cached, "rb") as fh:
            return self.send_bytes(200, fh.read(), "application/json")

    def probe(self):
        q = self.query()
        url = (q.get("url") or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("Stream link must start with http:// or https://")
        started = time.time()
        result = {"ok": False}
        try:
            status, ctype, body = fetch(url, timeout=10, user_agent=q.get("ua") or USER_AGENT, limit=4096)
            looks_like_video = len(body) >= 188 and not body.lstrip().lower().startswith((b"<", b"{"))
            looks_like_hls = body.lstrip().startswith(b"#EXTM3U")
            result = {"ok": status == 200 and (looks_like_video or looks_like_hls),
                      "status": status, "bytes": len(body), "type": ctype}
        except urllib.error.HTTPError as e:
            result = {"ok": False, "status": e.code}
        except Exception as e:  # noqa: BLE001
            result = {"ok": False, "error": str(getattr(e, "reason", e))}
        result["ms"] = int((time.time() - started) * 1000)
        return self.send_json(200, result)


def main():
    parser = argparse.ArgumentParser(description="Channel Fixer local helper")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--lan", action="store_true",
                        help="listen on your home network so a TV/phone can open the page and playlist")
    args = parser.parse_args()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    httpd = ThreadingHTTPServer((host, args.port), Handler)
    httpd.lan = args.lan
    print(f"Channel Fixer running: open http://localhost:{args.port} in your browser")
    if args.lan:
        for ip in lan_addresses():
            print(f"  On your home network: http://{ip}:{args.port}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
