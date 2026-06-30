from http.server import BaseHTTPRequestHandler
import urllib.request
import urllib.error
import urllib.parse
import json
import logging
import re

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("solarvision.overpass")

REQUEST_TIMEOUT = 28  # seconds (safe margin for Vercel's 30s limit)
OVERPASS_QL_TIMEOUT = 25  # must stay below REQUEST_TIMEOUT

# Public Overpass mirrors, tried in order until one succeeds
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

# Regional bounds: India only (south, west, north, east)
INDIA_BOUNDS = {
    "south": 6.0,
    "west": 68.0,
    "north": 37.0,
    "east": 97.0,
}

# Cap query area to keep Overpass requests fast and avoid rate-limit bans.
# ~0.05 deg side ≈ 5.5km — generous for a rooftop/neighbourhood lookup.
MAX_BBOX_SIDE_DEG = 0.05

BBOX_PATTERN = re.compile(
    r'^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$'
)


class handler(BaseHTTPRequestHandler):
    def _send_json_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def _validate_bbox(self, bbox):
        """Returns (south, west, north, east) floats if valid for the India region, else raises ValueError."""
        if not BBOX_PATTERN.match(bbox):
            raise ValueError(
                "Invalid bbox format. Expected: south_lat,west_lon,north_lat,east_lon"
            )

        south, west, north, east = (float(x) for x in bbox.split(','))

        if south >= north:
            raise ValueError("South latitude must be less than north latitude")
        if west >= east:
            raise ValueError("West longitude must be less than east longitude")

        # Must fall fully within the India region
        if not (INDIA_BOUNDS["south"] <= south and north <= INDIA_BOUNDS["north"]
                and INDIA_BOUNDS["west"] <= west and east <= INDIA_BOUNDS["east"]):
            raise ValueError("bbox must be within the India region (lat 6-37, lon 68-97)")

        # Cap the area to avoid huge/slow Overpass queries
        if (north - south) > MAX_BBOX_SIDE_DEG or (east - west) > MAX_BBOX_SIDE_DEG:
            raise ValueError(
                f"bbox too large; max side is {MAX_BBOX_SIDE_DEG} degrees (~5.5km)"
            )

        return south, west, north, east

    def do_GET(self):
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)

            bbox = query_params.get('bbox', [''])[0]
            if not bbox:
                self._send_json_response(400, {'error': 'Missing bbox parameter'})
                return

            try:
                south, west, north, east = self._validate_bbox(bbox)
            except ValueError as ve:
                self._send_json_response(400, {'error': str(ve)})
                return

            normalized_bbox = f"{south},{west},{north},{east}"
            logger.info("Overpass request: bbox=%s", normalized_bbox)

            overpass_query = f"""
            [out:json][timeout:{OVERPASS_QL_TIMEOUT}];
            (
                way["building"]({normalized_bbox});
                relation["building"]({normalized_bbox});
            );
            out geom;
            """
            data = overpass_query.encode()

            last_error = None
            for mirror_url in OVERPASS_MIRRORS:
                try:
                    req = urllib.request.Request(mirror_url, data=data, method='POST')
                    req.add_header('User-Agent', 'Mozilla/5.0 (compatible; SolarVision/1.0)')
                    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

                    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
                        result = response.read()

                    logger.info("Overpass response from %s: %d bytes", mirror_url, len(result))

                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(result)
                    return

                except (urllib.error.HTTPError, urllib.error.URLError) as e:
                    logger.warning("Overpass mirror failed (%s): %s", mirror_url, e)
                    last_error = e
                    continue

            # All mirrors failed
            raise last_error if last_error else RuntimeError("All Overpass mirrors failed")

        except urllib.error.HTTPError as e:
            logger.error("Overpass API HTTP %d", e.code)
            self._send_json_response(502, {
                'error': 'Building data service temporarily unavailable. Please try again.'
            })

        except urllib.error.URLError as e:
            logger.error("Overpass network error: %s", e.reason)
            self._send_json_response(502, {
                'error': 'Network error when fetching building data. Please try again.'
            })

        except Exception:
            logger.exception("Unexpected error in Overpass handler")
            self._send_json_response(500, {
                'error': 'Internal server error. Please try again later.'
            })