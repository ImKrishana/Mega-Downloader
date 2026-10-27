# ==========================================================================
# Standalone Python Server for MEGA Downloader
# ==========================================================================

import os
import sys
import mimetypes
from urllib.parse import urlparse, parse_qs, quote
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import mega_core

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/mega":
            url_param = qs.get("url", [None])[0]
            if not url_param:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error": "invalid_url", "message": "Provide a valid mega link."}')
                return

            try:
                res = mega_core.resolve_mega(url_param)
                formatted_files = []
                for f in res["files"]:
                    formatted_files.append({
                        "name": f["name"],
                        "size": f["size"],
                        "state": "ready",
                        "download_url": f"/api/mega/download?f={f.get('folder_id') or ''}&n={f['node_id']}&fn={quote(f['name'])}"
                    })

                output = {
                    "job_id": "py_" + os.urandom(4).hex(),
                    "state": "completed",
                    "name": res["name"],
                    "total_files": res["total_files"],
                    "total_size": res["total_size"],
                    "completed_files": res["total_files"],
                    "failed_files": 0,
                    "files": formatted_files
                }

                import json
                payload = json.dumps(output).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(f'{{"error": "mega_error", "message": "{str(e)}"}}\n'.encode("utf-8"))
                return

        # Serve static files
        req_path = "/static/index.html" if path in ("/", "/index.html") else path
        if not req_path.startswith("/static/"):
            req_path = "/static" + req_path

        local_file = os.path.normpath(os.path.join(root_dir, req_path.lstrip("/")))
        if not local_file.startswith(root_dir) or not os.path.isfile(local_file):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")
            return

        ctype, _ = mimetypes.guess_type(local_file)
        if not ctype:
            ctype = "text/plain"

        size = os.path.getsize(local_file)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.end_headers()

        with open(local_file, "rb") as f:
            while chunk := f.read(65536):
                self.wfile.write(chunk)

def main():
    port = int(os.environ.get("PORT", 3000))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"\n  MEGA Downloader (Python) running at http://localhost:{port}\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()

if __name__ == "__main__":
    main()
