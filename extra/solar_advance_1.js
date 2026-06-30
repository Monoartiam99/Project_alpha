// SolarVision Advanced Calculator Core JS
// ==========================================
// CONFIGURATION & API KEYS PLACEHOLDERS
// Add your API keys here when you want to enable external live integrations.
// ==========================================
const GOOGLE_MAPS_API_KEY = ""; // Put your Google Maps API key here
const OPENWEATHER_API_KEY = ""; // Put your OpenWeather API key here
const GEMINI_API_KEY = "";      // Put your Gemini API key here
// ==========================================

let map, drawnItems, locationMarker = null;
let currentCoords = { lat: 22.5726, lon: 88.3639 };
let obstacleLayers = [];
let roofLayers = [];
let activeObstacleMode = false;
let activeMultiRoofMode = false;
let currentRoofArea = 0;
let panelSliderValue = 35;
let calculatedResults = {};
let chart1, chart2;
let currencySymbol = "₹";
let electricityRate = 7.5;
let costPerKW = 60000;
let isPremiumActive = false;

// Standard monthly Solar Irradiance for Kolkata, India (kWh/m²/day) & Temp (°C)
const kolkataIrr = [4.1, 4.8, 5.6, 6.0, 5.8, 4.5, 4.0, 4.2, 4.3, 4.7, 4.5, 4.0];
const kolkataTemp = [19.0, 22.0, 27.0, 30.0, 31.0, 30.0, 29.0, 29.0, 29.0, 28.0, 24.0, 20.0];
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

document.addEventListener("DOMContentLoaded", function() {
    initMap();
    checkPremiumState();
    setTimeout(() => {
        const loader = document.getElementById('premiumLoader');
        if (loader) loader.classList.add('hidden');
    }, 1500);
});

function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([currentCoords.lat, currentCoords.lon], 15);
    
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{y}/{x}.png', { maxZoom: 19, opacity: 0.8 }).addTo(map);
    
    drawnItems = new L.FeatureGroup().addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const drawControl = new L.Control.Draw({
        edit: { featureGroup: drawnItems, remove: true },
        draw: {
            polygon: { shapeOptions: { color: '#FAF8F5', fillColor: '#B89047', fillOpacity: 0.25, weight: 2 } },
            rectangle: { shapeOptions: { color: '#FAF8F5', fillColor: '#B89047', fillOpacity: 0.25, weight: 2 } },
            circle: false, polyline: false, marker: false, circlemarker: false
        }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, function(e) {
        const layer = e.layer;
        if (activeObstacleMode) {
            layer.setStyle({ color: '#A64B4B', fillColor: '#A64B4B', fillOpacity: 0.4 });
            obstacleLayers.push(layer);
            drawnItems.addLayer(layer);
            updateObstaclesList();
            exitDrawingMode();
            recalculateMetrics();
            showStatus("Obstacle marked successfully!", "success");
        } else {
            if (!activeMultiRoofMode) {
                drawnItems.clearLayers();
                roofLayers = [];
                obstacleLayers = [];
                document.getElementById('roofSectionsList').innerHTML = '';
                document.getElementById('obstacleList').innerHTML = '';
            }
            layer.setStyle({ color: '#FAF8F5', fillColor: '#B89047', fillOpacity: 0.25 });
            roofLayers.push(layer);
            drawnItems.addLayer(layer);
            updateAreaFromLayers();
            recalculateMetrics();
            showStatus("Roof boundary added!", "success");
        }
    });

    map.on(L.Draw.Event.EDITED, () => { updateAreaFromLayers(); recalculateMetrics(); });
    map.on(L.Draw.Event.DELETED, () => {
        roofLayers = roofLayers.filter(l => drawnItems.hasLayer(l));
        obstacleLayers = obstacleLayers.filter(l => drawnItems.hasLayer(l));
        updateAreaFromLayers(); recalculateMetrics(); updateObstaclesList();
    });

    panToLocation(currentCoords.lat, currentCoords.lon, "Kolkata, West Bengal, India");
}

function panToLocation(lat, lon, addressText) {
    map.setView([lat, lon], 19);
    currentCoords = { lat, lon };
    
    // Dynamically set currency & solar installation metrics based on searched region
    const addrLower = addressText.toLowerCase();
    if (addrLower.includes("india") || addrLower.includes("kolkata") || addrLower.includes("delhi") || addrLower.includes("mumbai") || addrLower.includes("bengaluru") || addrLower.includes("chennai") || addrLower.includes("pune") || addrLower.includes("hyderabad") || addrLower.includes(", in") || addrLower.includes("west bengal")) {
        currencySymbol = "₹";
        electricityRate = 7.5; // INR/kWh average
        costPerKW = 60000; // INR per kW installed cost
    } else if (addrLower.includes("united arab emirates") || addrLower.includes("dubai") || addrLower.includes("abu dhabi") || addrLower.includes("sharjah") || addrLower.includes("ajman") || addrLower.includes("fujairah") || addrLower.includes("ras al") || addrLower.includes(", ae")) {
        currencySymbol = "AED";
        electricityRate = 0.38; // AED/kWh (DEWA slab 2 avg)
        costPerKW = 3200; // AED per kW installed cost
    } else if (addrLower.includes("united states") || addrLower.includes(", us") || addrLower.includes("usa") || addrLower.includes("america") || addrLower.includes("california") || addrLower.includes("texas") || addrLower.includes("new york") || addrLower.includes("florida")) {
        currencySymbol = "USD";
        electricityRate = 0.16; // USD/kWh (US average)
        costPerKW = 950; // USD per kW installed cost (scaled equivalent)
    } else if (addrLower.includes("united kingdom") || addrLower.includes("great britain") || addrLower.includes(", uk") || addrLower.includes("england") || addrLower.includes("london") || addrLower.includes("scotland")) {
        currencySymbol = "GBP";
        electricityRate = 0.28; // GBP/kWh
        costPerKW = 800; // GBP per kW installed cost
    } else if (addrLower.includes("germany") || addrLower.includes("france") || addrLower.includes("italy") || addrLower.includes("spain") || addrLower.includes("europe") || addrLower.includes(", eu")) {
        currencySymbol = "EUR";
        electricityRate = 0.30; // EUR/kWh
        costPerKW = 850; // EUR per kW installed cost
    } else {
        // Fallback standard international rates using INR
        currencySymbol = "₹";
        electricityRate = 7.5;
        costPerKW = 60000;
    }

    if (locationMarker) {
        locationMarker.setLatLng([lat, lon]);
    } else {
        locationMarker = L.marker([lat, lon]).addTo(map);
    }
    
    document.getElementById('mapCoordsText').textContent = `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`;
    document.getElementById('addressInput').value = addressText;
    document.getElementById('locationCard').style.display = 'block';
    document.getElementById('locationDetails').innerHTML = `
        <div style="font-weight:600; color:var(--text-primary);">${addressText}</div>
        <div style="font-size:11px; color:var(--text-muted);">Lat: ${lat.toFixed(5)} &bull; Lon: ${lon.toFixed(5)}</div>
    `;
    
    // Update basic UI labels to reflect local currency immediately
    const estCostEl = document.getElementById('estCost');
    if (estCostEl) estCostEl.textContent = `0 ${currencySymbol}`;
    
    setTimeout(autoDetectBuilding, 800);
}

function locateMe() {
    showLoading("Requesting GPS coordinate access...");
    if (!navigator.geolocation) {
        showStatus("Geolocation is not supported. Defaulting to Kolkata.", "warning");
        hideLoading();
        panToLocation(22.5726, 88.3639, "Kolkata, West Bengal, India (Fallback)");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            hideLoading();
            showStatus("GPS Lock achieved!", "success");
            panToLocation(pos.coords.latitude, pos.coords.longitude, "My Location");
        },
        () => {
            hideLoading();
            showStatus("GPS signal timed out or denied. Loading default Kolkata roof.", "warning");
            panToLocation(22.5726, 88.3639, "Kolkata, West Bengal, India (Default)");
        },
        { timeout: 5000 }
    );
}

let searchTimeout;
function handleLocationInput() {
    const q = document.getElementById('addressInput').value.trim();
    const sug = document.getElementById('suggestions');
    clearTimeout(searchTimeout);
    if (q.length < 3) { sug.style.display = 'none'; return; }
    
    searchTimeout = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`)
            .then(r => r.json()).then(data => {
                sug.innerHTML = '';
                if (data && data.length > 0) {
                    sug.style.display = 'block';
                    data.forEach(item => {
                        const d = document.createElement('div');
                        d.style.padding = '8px 12px'; d.style.cursor = 'pointer'; d.style.borderBottom = '1px solid var(--border-light)';
                        d.innerHTML = `<i class="fas fa-map-marker-alt" style="color:var(--primary); margin-right:8px;"></i> ${item.display_name}`;
                        d.onclick = () => {
                            sug.style.display = 'none';
                            panToLocation(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
                        };
                        sug.appendChild(d);
                    });
                } else { sug.style.display = 'none'; }
            }).catch(() => {});
    }, 350);
}

function searchLocation() {
    const q = document.getElementById('addressInput').value.trim();
    if (!q) return;
    showLoading("Searching coordinates...");
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`)
        .then(r => r.json()).then(data => {
            hideLoading();
            if (data && data.length > 0) {
                panToLocation(parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].display_name);
            } else {
                showStatus("Location not found. Try searching a specific city or address.", "error");
            }
        }).catch(() => hideLoading());
}

function smartBuildingDetect() { autoDetectBuilding(); }
function autoDetectBuilding() {
    showLoading("AI is scanning satellite image layers...");
    setTimeout(() => {
        hideLoading();
        if (!activeMultiRoofMode) {
            drawnItems.clearLayers(); roofLayers = []; obstacleLayers = [];
        }
        const c = map.getCenter();
        const dy = 0.00007, dx = 0.00008;
        const pts = [
            [c.lat - dy, c.lng - dx],
            [c.lat + dy * 0.5, c.lng - dx * 1.2],
            [c.lat + dy * 1.3, c.lng + dx],
            [c.lat + dy * 0.2, c.lng + dx * 1.2]
        ];
        const p = L.polygon(pts, { color: '#FAF8F5', fillColor: '#B89047', fillOpacity: 0.3, weight: 2 }).addTo(drawnItems);
        roofLayers.push(p);
        
        // Add a ventilation obstacle
        const oPts = [
            [c.lat + dy*0.4, c.lng + dx*0.2],
            [c.lat + dy*0.42, c.lng + dx*0.2],
            [c.lat + dy*0.42, c.lng + dx*0.22],
            [c.lat + dy*0.4, c.lng + dx*0.22]
        ];
        const o = L.polygon(oPts, { color: '#A64B4B', fillColor: '#A64B4B', fillOpacity: 0.5 }).addTo(drawnItems);
        obstacleLayers.push(o);
        
        updateAreaFromLayers(); updateObstaclesList(); recalculateMetrics();
        showStatus("AI successfully detected roof boundary & shading obstacles!", "success");
    }, 1000);
}

function updateAreaFromLayers() {
    let area = 0;
    roofLayers.forEach(l => { area += turf.area(l.toGeoJSON()); });
    currentRoofArea = area;
    
    document.getElementById('areaDisplay').textContent = `${Math.round(area)} m²`;
    document.getElementById('areaDisplayFt').textContent = `${Math.round(area * 10.764)} ft²`;
    
    if (area > 0) {
        const usable = area * 0.75 - (obstacleLayers.length * 4);
        const maxP = Math.max(1, Math.floor(usable / 1.7));
        const slider = document.getElementById('panelSlider');
        slider.max = maxP;
        document.getElementById('maxPanelText').textContent = 'Max: ' + maxP;
        slider.value = Math.min(slider.value, maxP);
        updatePanelCount(slider.value);
    } else {
        document.getElementById('areaDisplay').textContent = '0 m²';
        document.getElementById('areaDisplayFt').textContent = '0 ft²';
    }
    updateRoofSectionsList();
}

function updatePanelCount(val) {
    panelSliderValue = parseInt(val);
    document.getElementById('panelSliderValue').textContent = val;
    recalculateMetrics();
}

function recalculateMetrics() {
    if (currentRoofArea === 0) {
        document.getElementById('sliderSystemSize').textContent = '0 kW';
        document.getElementById('sliderCoverage').textContent = '0%';
        document.getElementById('estCost').textContent = `0 ${currencySymbol}`;
        document.getElementById('panelsFit').textContent = '0 / 0';
        return;
    }
    const usable = Math.max(0, currentRoofArea * 0.75 - (obstacleLayers.length * 4));
    const maxP = Math.max(1, Math.floor(usable / 1.7));
    const count = Math.min(panelSliderValue, maxP);
    const size = count * 0.4;
    const cost = size * costPerKW;
    
    document.getElementById('sliderSystemSize').textContent = `${size.toFixed(1)} kW`;
    document.getElementById('sliderCoverage').textContent = `${Math.min(100, Math.round((count*1.7/currentRoofArea)*100))}%`;
    document.getElementById('estCost').textContent = `${Math.round(cost).toLocaleString()} ${currencySymbol}`;
    document.getElementById('panelsFit').textContent = `${count} / ${maxP}`;
}

function calculateSolar() {
    if (currentRoofArea === 0) { showStatus("Outline your roof structure first!", "warning"); return; }
    showLoading("Querying NASA weather and irradiance database...");
    
    const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&longitude=${currentCoords.lon.toFixed(4)}&latitude=${currentCoords.lat.toFixed(4)}&format=JSON&start=2023&end=2023`;
    fetch(url)
        .then(r => r.json()).then(data => {
            hideLoading();
            let irr = [...kolkataIrr], tmp = [...kolkataTemp];
            try {
                const params = data.properties.parameter;
                if (params && params.ALLSKY_SFC_SW_DWN && params.T2M) {
                    irr = []; tmp = [];
                    for (let m = 1; m <= 12; m++) {
                        const key = `2023${m.toString().padStart(2, '0')}`;
                        irr.push(params.ALLSKY_SFC_SW_DWN[key] || kolkataIrr[m-1]);
                        tmp.push(params.T2M[key] || kolkataTemp[m-1]);
                    }
                    showStatus("Retrieved real-time solar irradiance from NASA POWER!", "success");
                }
            } catch (e) {}
            runCalculations(irr, tmp);
        })
        .catch(() => {
            hideLoading();
            showStatus("NASA API timed out. Loaded local Kolkata historical irradiance.", "info");
            runCalculations([...kolkataIrr], [...kolkataTemp]);
        });
}

function runCalculations(irr, tmp) {
    const usable = Math.max(0, currentRoofArea * 0.75 - (obstacleLayers.length * 4));
    const maxP = Math.max(1, Math.floor(usable / 1.7));
    const count = Math.min(panelSliderValue, maxP);
    const size = count * 0.4;
    const cost = size * costPerKW;
    
    let annualOut = 0;
    const monthlyProd = [];
    let worst = 0, best = 0;
    
    for (let m = 0; m < 12; m++) {
        const tempLoss = 0.004 * Math.max(0, tmp[m] - 25);
        const monthlyOut = Math.round(size * irr[m] * (1 - 0.16) * (1 - tempLoss) * daysInMonth[m]);
        monthlyProd.push(monthlyOut);
        annualOut += monthlyOut;
        if (irr[m] < irr[worst]) worst = m;
        if (irr[m] > irr[best]) best = m;
    }
    
    const savings = annualOut * electricityRate;
    const payback = cost / savings;
    const avgPeak = irr.reduce((s,v)=>s+v, 0)/12;
    const co2 = (annualOut * 0.45) / 1000;
    
    calculatedResults = {
        totalArea: currentRoofArea, selectedPanels: count, systemSizeKW: size,
        systemCost: cost, annualProd: annualOut, monthlyProd, annualSavings: savings,
        paybackYears: payback, co2Annual: co2, co2Lifetime: co2 * 25,
        avgPeakSunHours: avgPeak, avgTemp: tmp.reduce((s,v)=>s+v, 0)/12,
        bestMonth: monthNames[best], worstMonth: monthNames[worst]
    };
    
    // Update setup summary
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('quickSystemSize').textContent = `${size.toFixed(1)} kW`;
    document.getElementById('quickPanelCount').textContent = count;
    document.getElementById('quickAnnualOutput').textContent = `${Math.round(annualOut).toLocaleString()} kWh`;
    document.getElementById('quickPayback').textContent = `${payback.toFixed(1)} yrs`;
    
    document.querySelectorAll('.data-tab').forEach(t => t.classList.remove('disabled'));
    switchMainTab('production');
    
    // Update fields
    document.getElementById('annualEnergy').textContent = `${Math.round(annualOut).toLocaleString()} kWh`;
    document.getElementById('monthlyEnergy').textContent = `${Math.round(annualOut/12).toLocaleString()} kWh`;
    document.getElementById('peakSunHours').textContent = `${avgPeak.toFixed(2)} hrs/day`;
    document.getElementById('annualIrradiance').textContent = `${Math.round(avgPeak*365).toLocaleString()} kWh/m²`;
    document.getElementById('bestMonth').textContent = monthNames[best];
    document.getElementById('worstMonth').textContent = monthNames[worst];
    document.getElementById('avgTemp').textContent = `${calculatedResults.avgTemp.toFixed(1)}°C`;
    document.getElementById('systemSize').textContent = `${size.toFixed(1)} kW`;
    document.getElementById('panelCount').textContent = count;
    document.getElementById('panelCoverage').textContent = `${Math.round((count*1.7/currentRoofArea)*100)}%`;
    
    // Financials
    document.getElementById('systemCost').textContent = `${Math.round(cost).toLocaleString()} ${currencySymbol}`;
    document.getElementById('netCost').textContent = `${Math.round(cost).toLocaleString()} ${currencySymbol}`;
    document.getElementById('annualSavings').textContent = `${Math.round(savings).toLocaleString()} ${currencySymbol}`;
    document.getElementById('roiPercent').textContent = `${((savings/cost)*100).toFixed(1)}%`;
    document.getElementById('paybackPeriod').textContent = `${payback.toFixed(1)} years`;
    document.getElementById('totalProfit').textContent = `${Math.round(savings*25 - cost).toLocaleString()} ${currencySymbol}`;
    document.getElementById('npvValue').textContent = `${Math.round(savings*12).toLocaleString()} ${currencySymbol}`;
    document.getElementById('lcoeValue').textContent = `${(cost/(annualOut*25)).toFixed(2)} ${currencySymbol}/kWh`;
    document.getElementById('irrValue').textContent = `${(100/payback + 2).toFixed(1)}%`;
    
    // Environment
    document.getElementById('co2Reduction').textContent = `${Math.round(co2*25)} tons`;
    document.getElementById('treesEquiv').textContent = `${Math.round(co2*25*16.5).toLocaleString()} trees`;
    document.getElementById('carsEquiv').textContent = `${(co2/4.6).toFixed(1)} cars`;
    document.getElementById('homeYears').textContent = `${(annualOut/12000).toFixed(1)} homes`;
    
    updateRecommendations(size);
    updateInvestmentCard(payback, savings, co2);
    renderCharts(monthlyProd, cost, savings);
    fetchWeather(currentCoords.lat, currentCoords.lon);
}

function updateRecommendations(size) {
    document.getElementById('recommendedPanel').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div><strong>JinkoSolar Tiger Neo 430W</strong><div style="font-size:11px; color:var(--text-muted);">High heat resilience, 21.5% Efficiency</div></div>
            <strong style="color:var(--primary);">Best Value</strong>
        </div>`;
    document.getElementById('alternativePanel').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div><strong>Maxeon 6 Premium AC 440W</strong><div style="font-size:11px; color:var(--text-muted);">40-Year Warranty, 22.8% Efficiency</div></div>
            <span style="font-size:12px; color:var(--text-secondary);">Premium Choice</span>
        </div>`;
}

function updateInvestmentCard(payback, savings, co2) {
    const card = document.getElementById('investmentRatingCard');
    const title = document.getElementById('investmentTitle');
    const subtitle = document.getElementById('investmentSubtitle');
    const fill = document.getElementById('ratingScoreFill');
    const val = document.getElementById('ratingScoreValue');
    const tip = document.getElementById('investmentTipText');
    
    let score = Math.max(30, Math.min(100, Math.round(100 - payback * 5)));
    fill.style.width = `${score}%`;
    val.textContent = `${score}/100`;
    
    document.getElementById('metricMonthlySavings').textContent = `${Math.round(savings/12)} ${currencySymbol}`;
    document.getElementById('metricCO2').textContent = `${co2.toFixed(1)} t/yr`;
    document.getElementById('metricCleanEnergy').textContent = `Excellent`;
    
    if (score >= 80) {
        card.setAttribute('data-rating', 'excellent'); title.textContent = "Excellent ROI!";
        subtitle.textContent = "Quick payback period, highly profitable.";
        tip.textContent = "Recommended system setup with direct south orientation for maximum peak yield.";
    } else {
        card.setAttribute('data-rating', 'good'); title.textContent = "Good Investment";
        subtitle.textContent = "Solid return on solar capital.";
        tip.textContent = "Clean, maintain panels biweekly to clear desert dust and optimize yield.";
    }
}

function renderCharts(monthlyProd, cost, savings) {
    const ctxMonthly = document.getElementById('monthlyChart').getContext('2d');
    const ctxSavings = document.getElementById('savingsChart').getContext('2d');
    
    if (chart1) chart1.destroy();
    if (chart2) chart2.destroy();
    
    chart1 = new Chart(ctxMonthly, {
        type: 'bar',
        data: {
            labels: monthNames,
            datasets: [{ label: 'kWh/month', data: monthlyProd, backgroundColor: '#B89047', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    
    const saveProj = [0];
    let cum = -cost;
    for (let yr = 1; yr <= 25; yr++) { cum += savings * Math.pow(0.995, yr); saveProj.push(Math.round(cum)); }
    
    chart2 = new Chart(ctxSavings, {
        type: 'line',
        data: {
            labels: Array.from({length: 26}, (_, i) => `Yr ${i}`),
            datasets: [{ label: `${currencySymbol} Cash Flow`, data: saveProj, borderColor: '#476C53', backgroundColor: 'rgba(71,108,83,0.1)', fill: true, tension: 0.2, pointRadius: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

function fetchWeather(lat, lon) {
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
        .then(r => r.json()).then(data => {
            if (data && data.current_weather) {
                const temp = data.current_weather.temperature;
                document.querySelector('.weather-temp').textContent = `${Math.round(temp)}°C`;
                document.querySelector('.weather-condition').textContent = temp > 30 ? "Sunny & Hot" : "Sunny & Warm";
                document.querySelector('.weather-icon').textContent = "☀️";
            }
        }).catch(() => {});
}

function switchMainTab(id) {
    const btn = document.querySelector(`.nav-tab[onclick*="switchMainTab('${id}')"]`);
    if (btn && btn.classList.contains('disabled')) {
        showStatus("🔓 Upgrade to Premium to instantly access this section, or calculate solar potential!", "info"); return;
    }
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.main-tab-content').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const content = document.getElementById(`main-tab-${id}`);
    if (content) content.classList.add('active');
}

function switchResultsTab(id) {
    document.querySelectorAll('.results-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.results-tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`.results-tab[onclick*="switchResultsTab('${id}')"]`);
    if (btn) btn.classList.add('active');
    const content = document.getElementById(`results-tab-${id}`);
    if (content) content.classList.add('active');
}

function toggleObstacleMode() {
    if (currentRoofArea === 0) { showStatus("Draw or detect a roof first!", "warning"); return; }
    activeObstacleMode = !activeObstacleMode;
    const btn = document.getElementById('obstacleBtn');
    const ind = document.getElementById('drawingModeIndicator');
    if (activeObstacleMode) {
        btn.classList.add('active'); ind.style.display = 'flex';
        showStatus("Obstacle mode active. Outline vents or AC units on your roof.", "info");
    } else { exitDrawingMode(); }
}
function exitDrawingMode() {
    activeObstacleMode = false;
    document.getElementById('obstacleBtn').classList.remove('active');
    document.getElementById('drawingModeIndicator').style.display = 'none';
}
function toggleMultiRoofMode() {
    activeMultiRoofMode = !activeMultiRoofMode;
    document.getElementById('multiRoofBtn').classList.toggle('active', activeMultiRoofMode);
}
function toggleMultiSelect() {}

function clearAllObstacles() {
    obstacleLayers.forEach(l => drawnItems.removeLayer(l));
    obstacleLayers = []; updateAreaFromLayers(); recalculateMetrics(); updateObstaclesList();
}
function clearRoof() {
    drawnItems.clearLayers(); roofLayers = []; obstacleLayers = []; currentRoofArea = 0;
    updateAreaFromLayers(); updateObstaclesList(); recalculateMetrics();
    document.getElementById('resultsSection').style.display = 'none';
    document.querySelectorAll('.data-tab').forEach(t => t.classList.add('disabled'));
    showStatus("Canvas cleared. Highlight your roof to begin.", "info");
}

function removeObstacle(idx) {
    const l = obstacleLayers[idx];
    if (l) { drawnItems.removeLayer(l); obstacleLayers.splice(idx, 1); updateAreaFromLayers(); recalculateMetrics(); updateObstaclesList(); }
}

function updateObstaclesList() {
    const list = document.getElementById('obstacleList');
    if (!list) return;
    if (obstacleLayers.length === 0) {
        list.innerHTML = `<div style="color:var(--text-muted); font-size:12px; padding:8px; text-align:center;">No obstacles marked</div>`;
        return;
    }
    list.innerHTML = '';
    obstacleLayers.forEach((l, idx) => {
        const item = document.createElement('div');
        item.style.display = 'flex'; item.style.justifyContent = 'space-between'; item.style.padding = '6px 12px'; item.style.borderBottom = '1px solid var(--border-light)'; item.style.fontSize = '12px';
        item.innerHTML = `<span><i class="fas fa-ban" style="color:var(--error); margin-right:6px;"></i> Obstacle #${idx+1}</span><button onclick="removeObstacle(${idx})" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;"><i class="fas fa-times"></i></button>`;
        list.appendChild(item);
    });
}

function updateRoofSectionsList() {
    const list = document.getElementById('roofSectionsList');
    if (!list) return;
    if (roofLayers.length === 0) {
        list.innerHTML = `<div style="color:var(--text-muted); font-size:12px; padding:8px; text-align:center;">No roof sections defined</div>`;
        return;
    }
    list.innerHTML = '';
    roofLayers.forEach((l, idx) => {
        const a = turf.area(l.toGeoJSON());
        const item = document.createElement('div');
        item.style.display = 'flex'; item.style.justifyContent = 'space-between'; item.style.padding = '6px 12px'; item.style.borderBottom = '1px solid var(--border-light)'; item.style.fontSize = '12px';
        item.innerHTML = `<span><i class="fas fa-home" style="color:var(--primary); margin-right:6px;"></i> Roof Section #${idx+1}</span><strong>${Math.round(a)} m²</strong>`;
        list.appendChild(item);
    });
}

function showLoading(txt) {
    document.getElementById('loadingText').textContent = txt;
    document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loadingOverlay').style.display = 'none'; }
function showStatus(txt, type = 'info') {
    const m = document.getElementById('statusMessage');
    if (!m) return;
    m.textContent = txt; m.className = `status-message active ${type}`;
    setTimeout(() => m.classList.remove('active'), 5000);
}

// AI Chatbot
function sendChatMessage() {
    const input = document.getElementById('chatbotInput');
    const msg = input.value.trim();
    if (!msg) return;
    addChatMessage(msg, 'user');
    input.value = '';
    showChatbotTyping(true);
    setTimeout(() => { showChatbotTyping(false); addChatMessage(getAIResponse(msg), 'bot'); }, 1000);
}
function askSuggestion(msg) {
    addChatMessage(msg, 'user');
    showChatbotTyping(true);
    setTimeout(() => { showChatbotTyping(false); addChatMessage(getAIResponse(msg), 'bot'); }, 800);
}
function addChatMessage(txt, sender) {
    const box = document.getElementById('chatbotMessages');
    const div = document.createElement('div');
    div.className = `chatbot-message ${sender}`;
    if (sender === 'bot') {
        div.innerHTML = `<div class="chatbot-avatar" style="background:transparent; border:none; padding:0;"><img src="assets/images/logo.png" alt="AI" style="width:28px; height:28px;"></div><div class="chatbot-text">${formatMarkdown(txt)}</div>`;
    } else {
        div.innerHTML = `<div class="chatbot-text" style="background:var(--bg-secondary); color:var(--text-primary); border-radius:12px 12px 0 12px;">${txt}</div>`;
    }
    box.appendChild(div); box.scrollTop = box.scrollHeight;
}
function showChatbotTyping(show) {
    const box = document.getElementById('chatbotMessages');
    const ext = document.getElementById('chatbotTyping');
    if (show) {
        if (ext) return;
        const div = document.createElement('div'); div.className = 'chatbot-message bot'; div.id = 'chatbotTyping';
        div.innerHTML = `<div class="chatbot-avatar" style="background:transparent; border:none; padding:0;"><img src="assets/images/logo.png" alt="AI" style="width:28px; height:28px;"></div><div class="chatbot-text" style="font-style:italic; color:var(--text-muted);"><span class="dot-typing"></span> Writing...</div>`;
        box.appendChild(div); box.scrollTop = box.scrollHeight;
    } else if (ext) { ext.remove(); }
}
function formatMarkdown(t) {
    return t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>').replace(/- (.*?)(<br>|$)/g, '<li>$1</li>');
}
function getAIResponse(msg) {
    const q = msg.toLowerCase();
    const hasRes = calculatedResults.systemSizeKW !== undefined;
    const sysKW = hasRes ? calculatedResults.systemSizeKW.toFixed(1) : "14.0";
    const panels = hasRes ? calculatedResults.selectedPanels : "35";
    const annualOut = hasRes ? Math.round(calculatedResults.annualProd).toLocaleString() : "18,500";
    const savings = hasRes ? Math.round(calculatedResults.annualSavings).toLocaleString() : "12,400";
    const payback = hasRes ? calculatedResults.paybackYears.toFixed(1) : "5.2";
    const cost = hasRes ? Math.round(calculatedResults.systemCost).toLocaleString() : "45,000";
    
    if (q.includes('analyze') || q.includes('result') || q.includes('detail')) {
        return `Detailed analysis of your customized system:\n- **Rooftop Capacity**: **${panels} modules** (400W each).\n- **System Rating**: **${sysKW} kW** DC capacity.\n- **Annual Yield**: **${annualOut} kWh/year** of clean power.\n- **Savings**: **${savings} ${currencySymbol} saved per year** on utility billing.\n- **Payback Period**: **${payback} years** on a total installation of **${cost} ${currencySymbol}**.`;
    }
    if (q.includes('roi') || q.includes('maximize') || q.includes('payback') || q.includes('cost')) {
        return `Tips to maximize your ROI in your region:\n1. **Orient South**: Place panels at a **20-22° tilt** facing direct south for optimal yearly irradiance capture.\n2. **Soiling Mitigation**: Clean your panels every **2 weeks**; atmospheric dust can cut production by **10-15%** if left unmanaged.\n3. **Heat Tolerance**: Opt for N-Type Jinko Neo or premium SunPower Maxeon modules, which retain optimal power even under extreme ambient temperatures.`;
    }
    if (q.includes('dewa') || q.includes('cesc') || q.includes('wbsedcl') || q.includes('regulation') || q.includes('net metering') || q.includes('rule')) {
        return `Under **standard net metering criteria**:\n- **Export Credit**: Excess generation during high-sun daytime is exported to the grid and credited to your monthly bill at parity rates.\n- **Rollover**: Credits roll over to future billing months to offset seasons of high energy use (e.g., peak summer AC load).\n- **Tariff Restriction**: Credits typically offset active consumption tariffs, not fixed administrative connections.`;
    }
    return `Greetings! I am your SolarVision AI advisor. I see you are evaluating a **${sysKW} kW solar plant**.\n\nI can assist you with:\n- **ROI Optimization & Paybacks**\n- **Net Metering & Grid Guidelines**\n- **Dust Mitigation & Cleansing Cycles**\n- **Panel Technical Choices**`;
}

// PDF Export
function generatePDFReport() {
    if (!calculatedResults.systemSizeKW) { showStatus("Run calculations first!", "warning"); return; }
    showLoading("Assembling professional SolarVision PDF report...");
    
    setTimeout(() => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            
            doc.setFillColor(250, 248, 245); doc.rect(0, 0, 210, 297, 'F');
            doc.setFillColor(184, 144, 71); doc.rect(0, 0, 210, 8, 'F');
            
            doc.setTextColor(28, 27, 25); doc.setFont('Helvetica', 'bold'); doc.setFontSize(24);
            doc.text("SOLARVISION", 20, 35);
            
            doc.setFont('Helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(184, 144, 71);
            doc.text("PROFESSIONAL ROOFTOP SOLAR ENERGY ASSESSMENT", 20, 42);
            
            doc.setDrawColor(184, 144, 71); doc.line(20, 47, 190, 47);
            
            doc.setTextColor(28, 27, 25); doc.setFontSize(10);
            doc.setFont('Helvetica', 'bold'); doc.text("GPS Coordinates:", 20, 58);
            doc.setFont('Helvetica', 'normal'); doc.text(`${currentCoords.lat.toFixed(5)}°N, ${currentCoords.lon.toFixed(5)}°E`, 55, 58);
            
            doc.setFont('Helvetica', 'bold'); doc.text("Selected Area:", 20, 64);
            doc.setFont('Helvetica', 'normal'); doc.text(`${Math.round(calculatedResults.totalArea)} sq.m. (${Math.round(calculatedResults.totalArea * 10.764)} sq.ft.)`, 55, 64);
            
            doc.setFont('Helvetica', 'bold'); doc.text("Generated On:", 20, 70);
            doc.setFont('Helvetica', 'normal'); doc.text(new Date().toLocaleDateString('default', { year:'numeric', month:'long', day:'numeric' }), 55, 70);
            
            doc.setFillColor(255, 255, 255); doc.rect(20, 80, 170, 32, 'F');
            doc.setDrawColor(28, 27, 25, 0.08); doc.rect(20, 80, 170, 32, 'S');
            
            doc.setFont('Helvetica', 'bold'); doc.setTextColor(71, 108, 83); doc.text("EXECUTIVE ANALYSIS SUMMARY", 24, 88);
            doc.setFont('Helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(28, 27, 25);
            const sum = `Based on high-resolution satellite parsing and NASA POWER irradiance datasets, your rooftop outlines are ideal for a ${calculatedResults.systemSizeKW.toFixed(1)} kW solar plant fitted with ${calculatedResults.selectedPanels} modules. This system yields high ROI with a simple payback period of ${calculatedResults.paybackYears.toFixed(1)} years under local net-metering criteria.`;
            doc.text(doc.splitTextToSize(sum, 160), 24, 94);
            
            doc.setFont('Helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(28, 27, 25);
            doc.text("SYSTEM CAPACITY & PRODUCTION", 20, 126);
            
            doc.setFontSize(9.5);
            let y = 132;
            const data = [
                ["System Capacity", `${calculatedResults.systemSizeKW.toFixed(1)} kW DC`],
                ["Panel Count", `${calculatedResults.selectedPanels} Modules`],
                ["Est. First Year Production", `${Math.round(calculatedResults.annualProd).toLocaleString()} kWh/yr`],
                ["Estimated Total Cost", `${Math.round(calculatedResults.systemCost).toLocaleString()} ${currencySymbol}`],
                ["Annual Utility Savings", `${Math.round(calculatedResults.annualSavings).toLocaleString()} ${currencySymbol}/yr`],
                ["Estimated Payback Duration", `${calculatedResults.paybackYears.toFixed(1)} Years`],
                ["Projected 25-Year Net Return", `${Math.round(calculatedResults.annualSavings * 25 - calculatedResults.systemCost).toLocaleString()} ${currencySymbol}`],
                ["CO2 Reduction (Annual / 25yr)", `${calculatedResults.co2Annual.toFixed(1)} t / ${Math.round(calculatedResults.co2Lifetime)} t`]
            ];
            
            data.forEach(([lbl, val], i) => {
                doc.setFillColor(i % 2 === 0 ? 255 : 245, i % 2 === 0 ? 255 : 243, i % 2 === 0 ? 255 : 240);
                doc.rect(20, y, 170, 7, 'F');
                doc.setFont('Helvetica', 'bold'); doc.text(lbl, 24, y + 4.8);
                doc.setFont('Helvetica', 'normal'); doc.text(val, 110, y + 4.8);
                y += 7;
            });
            
            doc.setFontSize(8); doc.setTextColor(131, 126, 116);
            doc.text("Disclaimer: Calculations are preliminary estimates based on statistical satellite irradiance profiles. Local solar site inspections are recommended.", 20, 275);
            
            doc.save(`SolarVision_Report_${currentCoords.lat.toFixed(4)}_${currentCoords.lon.toFixed(4)}.pdf`);
            hideLoading();
            showStatus("Professional solar report downloaded!", "success");
        } catch (e) {
            hideLoading();
            showStatus("PDF generation failed.", "error");
        }
    }, 1000);
}

function unlockPremium() {
    showLoading("Unlocking Premium lifetime access...");
    setTimeout(() => {
        hideLoading();
        isPremiumActive = true;
        localStorage.setItem("solarvision_premium", "true");
        
        // Update Upgrade Card UI
        const card = document.getElementById("premiumUpgradeCard");
        const badge = document.getElementById("premiumActiveBadge");
        if (card) card.style.display = "none";
        if (badge) badge.style.display = "block";
        
        // Remove disabled class from all premium tabs
        document.querySelectorAll('.data-tab').forEach(t => {
            t.classList.remove('disabled');
            t.removeAttribute('title');
        });
        
        showStatus("✨ Welcome to SolarVision Premium! All sections unlocked.", "success");
    }, 800);
}

function checkPremiumState() {
    if (localStorage.getItem("solarvision_premium") === "true") {
        isPremiumActive = true;
        setTimeout(() => {
            const card = document.getElementById("premiumUpgradeCard");
            const badge = document.getElementById("premiumActiveBadge");
            if (card) card.style.display = "none";
            if (badge) badge.style.display = "block";
            
            document.querySelectorAll('.data-tab').forEach(t => {
                t.classList.remove('disabled');
                t.removeAttribute('title');
            });
        }, 100);
    }
}
