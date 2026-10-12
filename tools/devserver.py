"""A local dev server that behaves like Netlify does, instead of like 1995.

`python -m http.server` sends every byte uncompressed and handles one request at a time. For this
repo that means nexus-core.js goes down the wire as 2.1MB, measured at about two seconds, on every
single page load - which is why localhost felt slower than the live site even though the live site
is on the other side of the country.

This serves the same folder with two differences, both matching what Netlify already does:

  * gzip for text (js, css, html, json, svg), which takes nexus-core.js from 2.1MB to roughly 600KB
  * the same caching rules as the _headers file: html revalidates, versioned assets do not

It is a dev convenience and nothing more - no routing, no TLS, no production use.

    python tools/devserver.py 8010
"""
import gzip
import io
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

GZIP_TYPES = (
    "text/", "application/javascript", "application/json",
    "image/svg+xml", "application/xml",
)
MIN_GZIP_BYTES = 1024

# Compressing 2.1MB on every request costs more than it saves on a machine talking to itself, so
# the result is kept and reused until the file changes on disk. Level 1 rather than 6 for the same
# reason: it gets most of the size reduction for a fraction of the work, and nobody is paying for
# bandwidth to localhost.
GZIP_LEVEL = 1
_cache = {}


def gzipped(path):
    """Gzip `path`, remembering the result against the file's size and modified time so an edit
    is always picked up and an unchanged file is never compressed twice."""
    stat = os.stat(path)
    key = (path, stat.st_mtime_ns, stat.st_size)
    hit = _cache.get(key)
    if hit is not None:
        return hit
    with open(path, "rb") as f:
        raw = f.read()
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=GZIP_LEVEL) as gz:
        gz.write(raw)
    body = buf.getvalue()
    _cache.clear()          # one entry per file is plenty; this keeps memory flat across edits
    _cache[key] = body
    return body


class DevHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # keep-alive, so 40 assets are not 40 connections

    def _wants_gzip(self):
        return "gzip" in self.headers.get("Accept-Encoding", "")

    def end_headers(self):
        path = self.path.split("?")[0]
        # Mirrors _headers: the HTML carries the ?v= and must always be fresh; what it points at
        # is versioned, so it never needs revalidating.
        if path.endswith(".html") or path.endswith("/"):
            self.send_header("Cache-Control", "no-cache")
        elif path.endswith((".js", ".css")):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        SimpleHTTPRequestHandler.end_headers(self)

    def send_head(self):
        """Compress on the way out. SimpleHTTPRequestHandler writes the body from the file object
        it returns here, so returning a BytesIO of gzipped bytes is all it takes - as long as
        Content-Length is corrected to match, or the browser waits forever for bytes that are
        never coming."""
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return SimpleHTTPRequestHandler.send_head(self)
        if not os.path.isfile(path):
            return SimpleHTTPRequestHandler.send_head(self)

        ctype = self.guess_type(path)
        size = os.path.getsize(path)
        if not (self._wants_gzip() and size >= MIN_GZIP_BYTES
                and any(ctype.startswith(t) for t in GZIP_TYPES)):
            return SimpleHTTPRequestHandler.send_head(self)

        try:
            body = gzipped(path)
        except OSError:
            self.send_error(404)
            return None

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        return io.BytesIO(body)

    def log_message(self, fmt, *args):
        # One line per request is noise when a page pulls forty files; errors still surface.
        if args and str(args[1]).startswith(("4", "5")):
            SimpleHTTPRequestHandler.log_message(self, fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    handler = partial(DevHandler, directory=root)
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("JAIN-E dev server (gzip + caching) on http://127.0.0.1:%d  serving %s" % (port, root))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
