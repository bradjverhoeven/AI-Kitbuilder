"""
Single-process server for the garment designer prototype: serves the static
frontend AND holds OPENAI_API_KEY server-side (never sent to the browser),
proxying image-generation requests to OpenAI's Images API.

Run: python server.py
Serves everything on http://localhost:5057 (and on your LAN IP / any tunnel
pointed at this port, since it binds to 0.0.0.0).
"""
import base64
import json
import mimetypes
import os
import uuid
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(ROOT, ".env")  # local dev only -- on Render, OPENAI_API_KEY comes from its dashboard env var
STATIC_FILES = {"/", "/index.html", "/style.css", "/app.js"}


def load_env(path):
    env = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


ENV = load_env(ENV_PATH)
OPENAI_API_KEY = ENV.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")


def call_openai_image(prompt, size="1024x1024"):
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set in .env")
    url = "https://api.openai.com/v1/images/generations"
    body = json.dumps({
        "model": "gpt-image-1",
        "prompt": prompt,
        "size": size,
        "n": 1,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {OPENAI_API_KEY}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["data"][0]["b64_json"]


def call_openai_image_edit(images_b64, prompt, size="1024x1024"):
    """Derives a new image FROM one or more existing ones (img2img), so
    results stay visually consistent with the reference image(s) instead of
    an independent re-roll. Pass multiple images (e.g. the garment shot +
    an uploaded logo file) to have gpt-image-1 composite them together."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set in .env")
    boundary = uuid.uuid4().hex
    parts = []

    def add_field(name, value):
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8")
        )

    def add_file(name, filename, content, content_type):
        header = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f'Content-Type: {content_type}\r\n\r\n'
        ).encode("utf-8")
        parts.append(header + content + b"\r\n")

    add_field("model", "gpt-image-1")
    add_field("prompt", prompt)
    add_field("size", size)
    for idx, img_b64 in enumerate(images_b64):
        add_file("image[]", f"image{idx}.png", base64.b64decode(img_b64), "image/png")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    req = urllib.request.Request("https://api.openai.com/v1/images/edits", data=body, method="POST")
    req.add_header("Authorization", f"Bearer {OPENAI_API_KEY}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["data"][0]["b64_json"]


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, payload):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self._json(200, {"ok": True, "key_configured": bool(OPENAI_API_KEY)})
            return
        if self.path in STATIC_FILES:
            filename = "index.html" if self.path == "/" else self.path.lstrip("/")
            filepath = os.path.join(ROOT, filename)
            content_type, _ = mimetypes.guess_type(filepath)
            with open(filepath, "rb") as f:
                content = f.read()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", content_type or "application/octet-stream")
            self.end_headers()
            self.wfile.write(content)
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/api/generate-image", "/api/edit-image"):
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
            prompt = (payload.get("prompt") or "").strip()
            size = payload.get("size", "1024x1024")
            if not prompt:
                raise ValueError("prompt is required")
            if self.path == "/api/generate-image":
                b64 = call_openai_image(prompt, size)
            else:
                images_b64 = payload.get("images_b64")
                if not images_b64 and payload.get("image_b64"):
                    images_b64 = [payload.get("image_b64")]
                if not images_b64:
                    raise ValueError("images_b64 is required for edit-image")
                b64 = call_openai_image_edit(images_b64, prompt, size)
            self._json(200, {"image_b64": b64})
        except urllib.error.HTTPError as e:
            self._json(502, {"error": e.read().decode("utf-8", errors="replace")})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5057))  # hosts like Render assign their own PORT
    print(f"OPENAI_API_KEY configured: {bool(OPENAI_API_KEY)}")
    print(f"Garment designer running on http://localhost:{port}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
