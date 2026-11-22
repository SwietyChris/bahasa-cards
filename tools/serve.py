"""Serve the web app and optional Apple Vision handwriting recognition locally."""

from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json
import platform
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_ARCHIVE_BYTES = 2 * MAX_IMAGE_BYTES + 65536
DEFAULT_PHOTO_FOLDER = Path.home() / "Documents" / "Codex" / "Bahasa Studio Photos"


def recognition_binary():
    source = ROOT / "tools" / "read-card.swift"
    with tempfile.TemporaryDirectory(prefix="bahasa-vision-") as directory:
        cache = Path(directory)
        # The lifetime of this generator keeps the compiled helper available.
        binary = cache / "read-card"
        try:
            subprocess.run(
                ["xcrun", "swiftc", "-module-cache-path", str(cache / "modules"),
                 str(source), "-o", str(binary)],
                check=True, timeout=120, capture_output=True,
            )
        except (OSError, subprocess.SubprocessError):
            print("Apple Vision is unavailable. Enter the text beside each photo.", flush=True)
            yield None
        else:
            print("Apple Vision handwriting recognition is available.", flush=True)
            yield binary


class LocalApp(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Permissions-Policy", "camera=(self), microphone=()")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def json_response(self, status, payload):
        response = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def is_local_request(self):
        port = self.server.server_port
        host = self.headers.get("Host")
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        return host in allowed and self.headers.get("Origin", f"http://{host}") == f"http://{host}"

    def do_GET(self):
        request = urlsplit(self.path)
        if request.path in {"/api/recognition", "/api/archive"}:
            if not self.is_local_request():
                self.json_response(403, {"error": "Open Bahasa Studio on this Mac."})
                return
            if request.path == "/api/recognition":
                self.json_response(200, {"available": self.server.reader is not None, "archive": True})
            else:
                self.read_archive(parse_qs(request.query))
            return
        super().do_GET()

    def do_POST(self):
        request = urlsplit(self.path)
        if request.path not in {"/api/recognize", "/api/archive"}:
            self.json_response(404, {"error": "This action is unavailable."})
            return
        if not self.is_local_request():
            self.json_response(403, {"error": "Open Bahasa Studio on this Mac."})
            return
        self.connection.settimeout(10)
        parameters = parse_qs(request.query)
        if request.path == "/api/archive":
            self.archive_photos(parameters)
        else:
            self.recognize(parameters)

    def read_body(self, max_length, mime_type):
        length = self.headers.get("Content-Length", "")
        if not re.fullmatch(r"[0-9]{1,8}", length) or not 1 <= int(length) <= max_length:
            self.json_response(413, {"error": "The photo file is too large."})
            return None
        if self.headers.get_content_type() != mime_type:
            self.json_response(415, {"error": "Unexpected photo file type."})
            return None
        return self.rfile.read(int(length))

    def recognize(self, parameters):
        side = parameters.get("side", [""])[0]
        if side not in {"id", "en"} or self.server.reader is None:
            self.json_response(400, {"error": "Local handwriting recognition is unavailable."})
            return
        image = self.read_body(MAX_IMAGE_BYTES, "image/jpeg")
        if image is None:
            return
        try:
            result = subprocess.run(
                [str(self.server.reader), side], input=image,
                capture_output=True, check=True, timeout=30,
            )
            lines = json.loads(result.stdout)
        except (OSError, subprocess.SubprocessError, ValueError):
            self.json_response(422, {"error": "This photo could not be read. Enter the text beside it."})
            return
        self.json_response(200, {"lines": lines})

    def archive_path(self, parameters):
        card_id = parameters.get("id", [""])[0]
        deck = parameters.get("deck", [""])[0]
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}", card_id) or not re.fullmatch(r"[1-9][0-9]{0,15}", deck):
            raise ValueError("Invalid card key")
        return self.server.photo_folder / f"Deck {deck}" / f"{card_id}-photos.zip"

    def read_archive(self, parameters):
        try:
            source = self.archive_path(parameters)
            if not source.is_file():
                source = next(self.server.photo_folder.glob(f"Deck */{source.name}"), source)
            if source.stat().st_size > MAX_ARCHIVE_BYTES:
                raise OSError("Photo archive exceeded the size limit")
            payload = source.read_bytes()
        except ValueError:
            self.json_response(400, {"error": "Check the card ID and deck number."})
            return
        except OSError:
            self.json_response(404, {"error": "No saved photos for this card."})
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def archive_photos(self, parameters):
        try:
            destination = self.archive_path(parameters)
        except ValueError:
            self.json_response(400, {"error": "Check the card ID and deck number."})
            return
        payload = self.read_body(MAX_ARCHIVE_BYTES, "application/zip")
        if payload is None:
            return
        try:
            with zipfile.ZipFile(BytesIO(payload)) as bundle:
                names = bundle.namelist()
                if not names or len(names) != len(set(names)) or not set(names) <= {"indonesian.jpg", "english.jpg"}:
                    raise ValueError("Unexpected photos")
                if any(not 1 <= item.file_size <= MAX_IMAGE_BYTES for item in bundle.infolist()):
                    raise ValueError("Photo exceeds size limit")
        except (ValueError, zipfile.BadZipFile):
            self.json_response(400, {"error": "The photo archive could not be opened."})
            return
        folder = destination.parent
        try:
            folder.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=folder) as staging:
                temporary = Path(staging) / destination.name
                temporary.write_bytes(payload)
                temporary.replace(destination)
        except OSError:
            self.json_response(500, {"error": "The Mac could not save the photo archive."})
            return
        self.json_response(200, {"saved": True})


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the app when it is ready.")
    parser.add_argument("--no-ocr", action="store_true", help="Serve the app without Apple Vision.")
    parser.add_argument("--photo-folder", type=Path, default=DEFAULT_PHOTO_FOLDER, help="Folder for saved photo files.")
    args = parser.parse_args()
    handler = partial(LocalApp, directory=ROOT / "dist")
    compiled_reader = recognition_binary() if not args.no_ocr and platform.system() == "Darwin" else iter([None])
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        if not args.no_ocr and platform.system() == "Darwin":
            print("Preparing handwriting recognition on this Mac…", flush=True)
        server.reader = next(compiled_reader)
        server.photo_folder = args.photo_folder
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Bahasa Studio is ready at {url}", flush=True)
        if args.open and platform.system() == "Darwin":
            subprocess.run(["open", url], check=False)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if hasattr(compiled_reader, "close"):
                compiled_reader.close()


if __name__ == "__main__":
    main()
