#!/usr/bin/env python3
"""
Enhanced Local HTTP Server for SolarVision
Includes proxies for Overpass API and Groq AI
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error
import json
import os
import logging
import re
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("solarvision")

PORT = 8000
REQUEST_TIMEOUT = 15  # seconds

# Regex to validate bbox format
BBOX_PATTERN = re.compile(
    r'^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$'
)

# Load .env file if it exists
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    logger.info("Loading environment variables from .env file...")
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip()
    logger.info("Environment variables loaded")
else:
    logger.warning("No .env file found — using environment variables")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY or GROQ_API_KEY in ("YOUR_GROQ_API_KEY_HERE", "your_groq_api_key_here"):
    logger.error("GROQ_API_KEY not found or not set!")
    logger.error("Create a .env file with: GROQ_API_KEY=your_key_here")
    exit(1)
else:
    logger.info("Groq API Key loaded: %s...", GROQ_API_KEY[:8])

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

class ProxyRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()
    
    def do_GET(self):
        # Proxy endpoint for Overpass API
        if self.path.startswith('/api/overpass'):
            try:
                query = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(query)
                
                bbox = params.get('bbox', [''])[0]
                
                if not bbox:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    error_data = json.dumps({'error': 'Missing bbox parameter'})
                    self.wfile.write(error_data.encode())
                    return

                # Validate bbox format
                if not BBOX_PATTERN.match(bbox):
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Invalid bbox format. Expected: south_lat,west_lon,north_lat,east_lon'
                    }).encode())
                    return
                
                overpass_query = f"""
                [out:json][timeout:25];
                (
                    way["building"]({bbox});
                    relation["building"]({bbox});
                );
                out geom;
                """
                
                logger.info("Overpass request: bbox=%s", bbox)
                
                overpass_url = "https://overpass-api.de/api/interpreter"
                data = overpass_query.encode()
                
                req = urllib.request.Request(overpass_url, data=data, method='POST')
                req.add_header('User-Agent', 'Mozilla/5.0')
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')
                
                with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
                    result = response.read()
                
                logger.info("Overpass response: %d bytes", len(result))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(result)
                
            except urllib.error.HTTPError as e:
                logger.error("Overpass API HTTP %d", e.code)
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': 'Building data service unavailable. Please try again.'
                }).encode())
            except urllib.error.URLError as e:
                logger.error("Overpass network error: %s", e.reason)
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': 'Network error. Please try again.'
                }).encode())
            except Exception as e:
                logger.exception("Overpass proxy error")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': 'Internal server error'
                }).encode())
        
        else:
            # Serve static files normally
            super().do_GET()
    
    def do_POST(self):
        # Proxy endpoint for Groq AI API
        if self.path.startswith('/api/groq'):
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                
                logger.info("Groq request: %d bytes", content_length)
                
                # Parse the request to validate
                try:
                    request_data = json.loads(body.decode('utf-8'))
                    logger.info("Groq model: %s", request_data.get('model', 'N/A'))
                except Exception as parse_err:
                    logger.warning("Could not parse request: %s", parse_err)
                    request_data = {}
                
                # Create request with proper headers to avoid Cloudflare blocking
                req = urllib.request.Request(GROQ_ENDPOINT, data=body, method='POST')
                req.add_header('Content-Type', 'application/json')
                req.add_header('Authorization', f'Bearer {GROQ_API_KEY}')
                req.add_header('User-Agent', 'curl/8.4.0')  # Cloudflare-friendly User-Agent
                req.add_header('Accept', '*/*')
                req.add_header('Connection', 'keep-alive')
                
                try:
                    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
                        result = response.read()
                        status = response.getcode()
                    
                    logger.info("Groq response: status=%d", status)
                    self.send_response(status)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(result)
                    
                except urllib.error.HTTPError as http_err:
                    error_body = http_err.read().decode('utf-8') if http_err.fp else str(http_err)
                    logger.error("Groq API HTTP %d: %s", http_err.code, error_body[:200])
                    
                    if http_err.code == 403:
                        logger.warning("Possible Cloudflare blocking detected")
                    
                    # Return error to frontend
                    self.send_response(http_err.code)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    
                    error_response = {
                        "error": {
                            "message": f"Groq API Error: {error_body}",
                            "type": "api_error",
                            "code": http_err.code
                        }
                    }
                    self.wfile.write(json.dumps(error_response).encode())
                
            except Exception as e:
                logger.exception("Groq proxy error")
                
                # Return error response
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                
                error_response = {
                    "error": {
                        "message": str(e),
                        "type": "server_error"
                    }
                }
                self.wfile.write(json.dumps(error_response).encode())
        else:
            self.send_response(405)
            self.end_headers()

if __name__ == '__main__':
    Handler = ProxyRequestHandler
    
    # Change to the project directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        logger.info("=" * 55)
        logger.info("SolarVision Local Server Running!")
        logger.info("=" * 55)
        logger.info("Main App:      http://localhost:%d/solar_advanced.html", PORT)
        logger.info("Landing Page:  http://localhost:%d/index.html", PORT)
        logger.info("Overpass Proxy: http://localhost:%d/api/overpass", PORT)
        logger.info("Groq AI Proxy:  http://localhost:%d/api/groq", PORT)
        logger.info("=" * 55)
        logger.info("Press Ctrl+C to stop the server")
        httpd.serve_forever()
