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
