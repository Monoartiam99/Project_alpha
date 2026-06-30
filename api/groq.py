from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import urllib.error
import urllib.parse
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("solarvision.power")

POWER_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/monthly/regional"
REQUEST_TIMEOUT = 25  # seconds (safe margin for Vercel's 30s limit)

# Fixed bounding box covering India
INDIA_BBOX = {
    "latitude-min": 6,
    "latitude-max": 37,
    "longitude-min": 68,
    "longitude-max": 97,
}

# Sensible defaults; can be overridden via query params
DEFAULT_PARAMS = {
    "parameters": "ALLSKY_SFC_SW_DWN",
    "community": "RE",
    "start": "2020",
    "end": "2026",
    "format": "JSON",
}

ALLOWED_OVERRIDE_KEYS = {"parameters", "community", "start", "end", "format"}


class handler(BaseHTTPRequestHandler):
    def _send_json_response(self, status_code, data):
        """Helper to send a JSON response with CORS headers."""
        self.send_response(status_code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)

            # Start from defaults, only allow whitelisted overrides from the query string
            request_params = dict(DEFAULT_PARAMS)
            for key in ALLOWED_OVERRIDE_KEYS:
                if key in query and query[key]:
                    request_params[key] = query[key][0]

            # Bounding box is fixed to India and cannot be overridden by the client
            request_params.update(INDIA_BBOX)

            query_string = urllib.parse.urlencode(request_params)
            full_url = f"{POWER_ENDPOINT}?{query_string}"

            logger.info("POWER request: %s", full_url)

            req = urllib.request.Request(full_url, method="GET")
            req.add_header("User-Agent", "SolarVision/1.0")

            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                result = resp.read()
                status = resp.getcode()

            logger.info("POWER response: status=%d", status)

            self._send_json_response(status, json.loads(result))

        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode('utf-8')
            except Exception:
                error_body = str(e)

            logger.error("POWER API HTTP %d: %s", e.code, error_body[:300])

            error_messages = {
                400: "Invalid request to NASA POWER API. Check parameters and date range.",
                429: "Rate limit exceeded on NASA POWER API. Please wait a moment and try again.",
                503: "NASA POWER service is temporarily unavailable. Please try again later.",
            }
            message = error_messages.get(e.code, "Upstream NASA POWER service error")

            self._send_json_response(e.code, {"error": message, "status": e.code})

        except urllib.error.URLError as e:
            logger.error("Network error contacting NASA POWER: %s", e.reason)
            self._send_json_response(502, {
                "error": "Network error when contacting NASA POWER service. Please try again."
            })

        except Exception as e:
            logger.exception("Unexpected error in POWER handler")
            self._send_json_response(500, {
                "error": "Internal server error. Please try again later."
            })