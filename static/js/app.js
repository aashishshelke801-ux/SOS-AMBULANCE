let lat = 18.5204, lng = 73.8567, currentCase = null, driver = null;
let coordMap = null, patientMap = null, sosLocationMap = null, driverMap = null;
let journeyTimers = [], activeScreen = 'landing';

const api = async (path, method = 'GET', body) => {
    let r = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    let type = r.headers.get('content-type') || '';
    let d = type.includes('application/json') ? await r.json() : { success: false, message: 'The server returned an unexpected response. Please try again.' };
    if (!r.ok || d.success === false) throw Error(d.message || d.error || 'Request failed');
    return d;
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

function badge(x) {
    if (!x) return '';
    return `<span class="badge ${x}">${escapeHtml(x).replaceAll('_', ' ')}</span>`;
}

// Landing Page Walkthrough Controller
let currentWalkthroughStep = 0;
let walkthroughTimer = null;
let walkthroughPauseTimeout = null;

const walkthroughData = [
    { pos: '10%', status: 'Request sent' },
    { pos: '50%', status: 'Ambulance on the way' },
    { pos: '90%', status: 'Hospital alerted' }
];

function setWalkthroughStep(index) {
    currentWalkthroughStep = ((index % 3) + 3) % 3;
    const steps = document.querySelectorAll('.step-item');
    steps.forEach((el, i) => {
        el.classList.toggle('active', i === currentWalkthroughStep);
    });

    const ambulance = document.getElementById('trackAmbulance');
    const progress = document.getElementById('trackProgress');
    const statusText = document.getElementById('walkthroughStatusText');

    if (ambulance) ambulance.style.left = walkthroughData[currentWalkthroughStep].pos;
    if (progress) progress.style.width = walkthroughData[currentWalkthroughStep].pos;
    if (statusText) statusText.textContent = walkthroughData[currentWalkthroughStep].status;
}

function startWalkthroughLoop() {
    stopWalkthroughLoop();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    walkthroughTimer = setInterval(() => {
        if (activeScreen === 'landing') {
            setWalkthroughStep(currentWalkthroughStep + 1);
        }
    }, 2500);
}

function stopWalkthroughLoop() {
    if (walkthroughTimer) {
        clearInterval(walkthroughTimer);
        walkthroughTimer = null;
    }
}

function selectWalkthroughStep(index) {
    setWalkthroughStep(index);
    stopWalkthroughLoop();
    if (walkthroughPauseTimeout) clearTimeout(walkthroughPauseTimeout);
    walkthroughPauseTimeout = setTimeout(() => {
        startWalkthroughLoop();
    }, 8000);
}

function renderScreen(id) {
    activeScreen = id;
    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    let target = document.getElementById(id);
    if (target) target.classList.add('active');
    let nav = document.getElementById('flowNav');
    if (nav) {
        nav.innerHTML = id === 'landing' ? '⌂ Home' : '← Back';
        nav.disabled = id === 'landing';
    }
    if (id === 'landing') startWalkthroughLoop();
    else stopWalkthroughLoop();

    if (id === 'coordinator') checkCoord();
    if (id === 'driver') checkDriver();
    if (id === 'patient') refreshPatient();
}

function show(id) {
    if (id === activeScreen) return;
    history.pushState({ screen: id }, '', `#${id}`);
    renderScreen(id);
}

function goBack() {
    if (activeScreen !== 'landing') history.back();
}

window.addEventListener('popstate', event => renderScreen(event.state?.screen || 'landing'));

const initialScreen = location.hash.slice(1);
const validScreens = ['landing', 'registration', 'patient', 'driver', 'coordinator'];
history.replaceState({ screen: validScreens.includes(initialScreen) ? initialScreen : 'landing' }, '', `#${validScreens.includes(initialScreen) ? initialScreen : 'landing'}`);
if (validScreens.includes(initialScreen) && initialScreen !== 'landing') renderScreen(initialScreen);
else startWalkthroughLoop();

function toast(x) {
    let t = document.getElementById('toast');
    if (!t) return;
    t.textContent = x;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3500);
}

function useDemoLocation() {
    lat = 18.5204;
    lng = 73.8567;
    let label = document.getElementById('locText');
    if (label) label.textContent = 'Demo location ready · Pune, Maharashtra';
    toast('Demo Location is ready for your SOS request.');
}

function locate() {
    let label = document.getElementById('locText');
    if (!navigator.geolocation) {
        if (label) label.textContent = 'Unable to detect GPS location. You can use Demo Location.';
        return;
    }
    if (label) label.textContent = 'Detecting location...';
    navigator.geolocation.getCurrentPosition(p => {
        lat = p.coords.latitude;
        lng = p.coords.longitude;
        if (label) label.textContent = 'Location detected · Lat: ' + lat.toFixed(6) + ' · Lng: ' + lng.toFixed(6);
    }, error => {
        if (label) {
            label.textContent = error.code === error.PERMISSION_DENIED ?
                'Location permission denied. Please allow location access in your browser settings.' :
                'Unable to detect GPS location. You can use Demo Location.';
        }
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function clearPhoneError() {
    let input = document.getElementById('sosPhoneInput');
    let err = document.getElementById('phoneError');
    if (input) input.classList.remove('invalid-phone');
    if (err) err.style.display = 'none';
}

const regForm = document.getElementById('regForm');
if (regForm) {
    regForm.onsubmit = async e => {
        e.preventDefault();
        try {
            let d = Object.fromEntries(new FormData(e.target));
            let r = await api('/api/ambulances/register', 'POST', d);
            let msgBox = document.getElementById('regMessage');
            if (msgBox) msgBox.innerHTML = `<p class="badge AVAILABLE" style="margin-top:10px">${r.message}</p>`;
            e.target.reset();
        } catch (x) {
            toast(x.message);
        }
    };
}

let sosPatientCount = 1, pendingDuplicate = null;

function addSosModals() {
    if (document.getElementById('sosModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="sosModal" class="modal" hidden>
            <div class="modal-card sos-modal">
                <div class="eyebrow">EMERGENCY DETAILS · DEMO</div>
                <h3>Confirm emergency assistance</h3>
                <p>Your verified profile is used—no OTP needed for this prototype.</p>
                <input id="sosName" readonly>
                <input id="sosPhone" readonly>
                <label>Patient count</label>
                <div class="count-control">
                    <button type="button" onclick="changePatientCount(-1)">−</button>
                    <b id="patientCount">1</b>
                    <button type="button" onclick="changePatientCount(1)">+</button>
                </div>
                <label>Emergency type</label>
                <select id="sosType">
                    <option>Accident</option>
                    <option>Medical Emergency</option>
                    <option>Pregnancy</option>
                    <option>Other</option>
                </select>
                <label>Severity / Priority</label>
                <select id="sosSeverity">
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH" selected>High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                </select>
                <div class="sos-map-section">
                    <label style="font-weight:600;font-size:12px;display:block;margin-bottom:4px">Map / Current Emergency Location</label>
                    <div class="sos-map-wrap">
                        <div id="sosLocationMap"></div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button type="button" onclick="closeSosModal()">Cancel</button>
                    <button type="button" class="danger" onclick="confirmSos()">CONFIRM SOS</button>
                </div>
            </div>
        </div>
        <div id="processingModal" class="modal" hidden>
            <div class="modal-card processing">
                <div class="eyebrow">DEMO VERIFICATION</div>
                <h3>Detecting & Verifying Emergency…</h3>
                <div id="verificationSteps"></div>
            </div>
        </div>
        <div id="duplicateModal" class="modal" hidden>
            <div class="modal-card">
                <div class="eyebrow">ACTIVE SOS DETECTED</div>
                <h3>An active emergency request already exists.</h3>
                <div class="modal-actions">
                    <button type="button" onclick="closeDuplicate()">Cancel</button>
                    <button type="button" onclick="viewActiveEmergency()">View Active Emergency</button>
                    <button type="button" class="danger" onclick="updateActiveEmergency()">Update Emergency</button>
                </div>
            </div>
        </div>
    `);
}
addSosModals();

function renderSosLocationMap() {
    if (!window.L) return;
    const container = document.getElementById('sosLocationMap');
    if (!container) return;
    if (sosLocationMap) {
        sosLocationMap.remove();
        sosLocationMap = null;
    }
    container.replaceChildren();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        let modal = document.getElementById('sosModal');
        if (!modal || modal.hidden) return;
        sosLocationMap = L.map(container, { zoomControl: true, attributionControl: true }).setView([lat, lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(sosLocationMap);
        L.marker([lat, lng]).addTo(sosLocationMap).bindPopup('Current emergency location');
        sosLocationMap.invalidateSize(true);
        setTimeout(() => {
            if (sosLocationMap) {
                sosLocationMap.setView([lat, lng], 14);
                sosLocationMap.invalidateSize(true);
            }
        }, 180);
    }));
}

const sosForm = document.getElementById('sosForm');
if (sosForm) {
    sosForm.onsubmit = async e => {
        e.preventDefault();
        let phoneInput = document.getElementById('sosPhoneInput');
        let phoneVal = phoneInput ? phoneInput.value.trim() : '';
        let phoneErr = document.getElementById('phoneError');

        // Validation for mandatory 10-digit Indian phone number
        if (!phoneVal || !/^[0-9]{10}$/.test(phoneVal)) {
            if (phoneInput) {
                phoneInput.classList.add('invalid-phone');
                phoneInput.focus();
            }
            if (phoneErr) {
                phoneErr.style.display = 'block';
                phoneErr.textContent = 'Valid 10-digit phone number daalein';
            }
            return;
        }

        clearPhoneError();

        try {
            let profile = await api('/api/patient-profile');
            let nameInput = document.getElementById('sosName');
            let sosPhoneModal = document.getElementById('sosPhone');
            let enteredName = document.querySelector('#sosForm input[name="name"]')?.value?.trim();
            if (nameInput) nameInput.value = enteredName || profile.patient?.name || 'Demo Patient';
            if (sosPhoneModal) sosPhoneModal.value = phoneVal;
            let modal = document.getElementById('sosModal');
            if (modal) modal.hidden = false;
            document.body.classList.add('sos-modal-open');
            renderSosLocationMap();
        } catch (err) {
            toast(err.message);
        }
    };
}

function closeSosModal() {
    let modal = document.getElementById('sosModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('sos-modal-open');
}

function changePatientCount(delta) {
    sosPatientCount = Math.max(1, Math.min(6, sosPatientCount + delta));
    let cnt = document.getElementById('patientCount');
    if (cnt) cnt.textContent = sosPatientCount;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function confirmSos() {
    closeSosModal();
    let procModal = document.getElementById('processingModal');
    if (procModal) procModal.hidden = false;
    let steps = [
        'Verified patient account',
        'Mobile number verified',
        'GPS location detected',
        'Duplicate SOS check completed',
        'Nearby emergency requests checked',
        'Emergency details analyzed'
    ];
    let box = document.getElementById('verificationSteps');
    if (box) {
        box.innerHTML = '';
        for (let step of steps) {
            await wait(300);
            box.insertAdjacentHTML('beforeend', `<div class="verify-step">✓ ${step}</div>`);
        }
    }
    try {
        let nameVal = document.getElementById('sosName')?.value || 'Demo Patient';
        let phoneVal = document.getElementById('sosPhone')?.value || document.getElementById('sosPhoneInput')?.value || '9111111111';
        let typeVal = document.getElementById('sosType')?.value || 'Medical Emergency';
        let sevVal = document.getElementById('sosSeverity')?.value || 'HIGH';
        let notesVal = document.querySelector('#sosForm textarea[name="notes"]')?.value || '';
        let data = {
            name: nameVal,
            phone: phoneVal,
            notes: notesVal,
            patient_count: sosPatientCount,
            emergency_type: typeVal,
            priority: sevVal,
            severity: sevVal,
            latitude: lat,
            longitude: lng
        };
        let result = await api('/api/emergency', 'POST', data);
        currentCase = result.emergency;
        if (procModal) procModal.hidden = true;
        if (currentCase.nearby_count > 1) {
            toast(`${currentCase.incident_patients} patients detected at the same incident location.`);
        }
        renderPatient();
        await matchCase();
    } catch (error) {
        if (procModal) procModal.hidden = true;
        if (error.message && error.message.includes('active emergency')) {
            pendingDuplicate = error;
            let dup = document.getElementById('duplicateModal');
            if (dup) dup.hidden = false;
        } else {
            toast(error.message);
        }
    }
}

function closeDuplicate() {
    let dup = document.getElementById('duplicateModal');
    if (dup) dup.hidden = true;
}

async function viewActiveEmergency() {
    closeDuplicate();
    await refreshPatient();
    renderPatient();
}

function updateActiveEmergency() {
    closeDuplicate();
    toast('Active emergency details are already visible for coordination.');
}

async function matchCase() {
    if (!currentCase) return;
    try {
        let r = await api(`/api/emergency/${currentCase.id}/match`, 'POST');
        currentCase = r.emergency;
        currentCase.candidates = r.candidates;
        toast(`${r.available_count} ambulances analyzed · ${r.message}`);
        renderPatient();
        loadDashboard();
    } catch (x) {
        toast(x.message);
    }
}

function makeMap(id) {
    if (!window.L) return null;
    let container = document.getElementById(id);
    if (!container) return null;
    let m = L.map(id).setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(m);
    return m;
}

function renderPatient() {
    let c = document.getElementById('patientCase');
    if (!c) return;
    if (!currentCase) {
        c.className = 'panel empty';
        c.textContent = 'No active emergency. Use the SOS button to begin the demo.';
        if (patientMap) {
            patientMap.remove();
            patientMap = null;
        }
        return;
    }
    let a = currentCase.ambulance;
    let cards = (currentCase.candidates || []).map(x => `
        <div class="ambulance-match ${x.best_match ? 'best-match' : ''}">
            <b>${x.best_match ? 'BEST MATCH · ' : ''}${escapeHtml(x.registration_number)}</b><br>
            <small>${x.distance_km} km | ${escapeHtml(x.traffic_level)} traffic | ETA ${x.eta_minutes} min | ${escapeHtml(x.ambulance_type)}</small>
        </div>
    `).join('');

    c.className = 'panel case';
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div class="eyebrow" style="margin:0">EMERGENCY STATUS</div>
            <div>${badge(currentCase.priority)} ${badge(currentCase.status)}</div>
        </div>
        <h3 style="margin-bottom:4px">${currentCase.status === 'COMPLETED' ? 'Emergency Case Completed' : a ? 'Ambulance Assigned & En Route' : 'Finding nearest available ambulance…'}</h3>
        <p style="font-size:13px;color:var(--navy)">Incident: <b>${escapeHtml(currentCase.incident_id)}</b> · Phone: <b>${escapeHtml(currentCase.patient_phone || '9111111111')}</b> · Hospital: ${badge(currentCase.hospital_status)}</p>
        ${a ? `
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line);font-size:13px">
                <p><b>${escapeHtml(a.registration_number)}</b> · ${escapeHtml(a.ambulance_type)}</p>
                <p>Driver: <b>${escapeHtml(a.driver_name)}</b> · ETA: <b>${currentCase.eta_minutes} min</b> · ${currentCase.distance_km} km</p>
                <p>Driver status: ${badge(a.ambulance_status)}</p>
            </div>
        ` : ''}
        ${cards}
        <div id="patientMap" class="map small"></div>
    `;

    if (patientMap) {
        patientMap.remove();
        patientMap = null;
    }
    let mapEl = document.getElementById('patientMap');
    if (mapEl) {
        patientMap = makeMap('patientMap');
        if (patientMap) {
            L.marker([currentCase.latitude, currentCase.longitude]).addTo(patientMap).bindPopup('Patient Location').openPopup();
            if (a) {
                L.marker([a.ambulance_latitude, a.ambulance_longitude]).addTo(patientMap).bindPopup('Ambulance');
                L.polyline([[a.ambulance_latitude, a.ambulance_longitude], [currentCase.latitude, currentCase.longitude]], {
                    color: '#dc2626',
                    weight: 4,
                    dashArray: '6, 8'
                }).addTo(patientMap);
                try {
                    patientMap.fitBounds([[a.ambulance_latitude, a.ambulance_longitude], [currentCase.latitude, currentCase.longitude]], { padding: [25, 25] });
                } catch (err) {}
            }
            setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 200);
        }
    }
}

async function refreshPatient() {
    try {
        let r = await api('/api/emergency');
        let active = r.emergencies.find(x => !['COMPLETED', 'CANCELLED'].includes(x.status));
        currentCase = active || null;
        renderPatient();
    } catch (err) {
        renderPatient();
    }
}

async function login(e, role) {
    e.preventDefault();
    try {
        let d = Object.fromEntries(new FormData(e.target));
        let r = await api('/api/login', 'POST', d);
        if (r.user.role !== role) {
            toast('Please use ' + role.toLowerCase() + ' credentials.');
            return;
        }
        toast('Welcome, ' + r.user.name);
        if (role === 'DRIVER') checkDriver();
        else checkCoord();
    } catch (x) {
        toast(x.message);
    }
}

async function checkDriver() {
    try {
        let me = await api('/api/me');
        if (me.user?.role !== 'DRIVER') return;
        let a = (await api('/api/ambulances')).ambulances.find(x => x.driver_name === me.user.name);
        if (!a) return;
        driver = a;
        document.getElementById('driverLogin').hidden = true;
        document.getElementById('driverPanel').hidden = false;
        document.getElementById('driverName').textContent = a.driver_name;
        document.getElementById('driverDetails').textContent = `${a.registration_number} · ${a.ambulance_type} · ${a.verification_status}`;
        setOnline(a.status === 'AVAILABLE');
        loadDriverCase();
    } catch (err) {}
}

function setOnline(on) {
    let b = document.getElementById('onlineBtn');
    if (!b) return;
    b.textContent = on ? 'ONLINE · AVAILABLE' : 'OFFLINE';
    b.classList.toggle('online', on);
}

async function toggleOnline() {
    if (!driver) return;
    try {
        let to = driver.status === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE';
        await api(`/api/ambulances/${driver.id}/status`, 'PATCH', { status: to });
        driver.status = to;
        setOnline(to === 'AVAILABLE');
        toast('Driver is ' + to);
    } catch (x) {
        toast(x.message);
    }
}

async function loadDriverCase() {
    if (!driver) return;
    let emergencies = (await api('/api/emergency')).emergencies;
    let e = emergencies.find(x => x.assigned_ambulance_id === driver.id && x.status !== 'COMPLETED');
    let box = document.getElementById('driverCase');
    if (!box) return;

    if (!e) {
        if (driverMap) {
            driverMap.remove();
            driverMap = null;
        }
        box.className = 'panel empty';
        box.textContent = driver.status === 'AVAILABLE' ?
            'Available for emergency dispatch. Waiting for assigned cases…' :
            'Go online to receive emergency dispatches.';
        return;
    }

    // When ASSIGNED: Driver has NOT accepted yet -> Show only basic request details, exact location hidden
    if (e.status === 'ASSIGNED') {
        if (driverMap) {
            driverMap.remove();
            driverMap = null;
        }
        box.className = 'panel case-card pending-card';
        box.innerHTML = `
            <div class="case-card-header">
                <div class="eyebrow">🚨 NEW EMERGENCY DISPATCH ASSIGNED</div>
                <div>${badge(e.priority)} ${badge(e.status)}</div>
            </div>
            <h3 style="font-size:16px;margin-bottom:4px">${escapeHtml(e.emergency_type)}</h3>
            <div class="case-meta">
                <p><strong>Incident:</strong> ${escapeHtml(e.incident_id)} · <strong>Patients:</strong> ${e.patient_count} · <strong>Traffic:</strong> ${escapeHtml(e.traffic_level || 'Moderate')}</p>
                <p><strong>Distance:</strong> approx. ${e.distance_km || '—'} km · <strong>Estimated ETA:</strong> ${e.eta_minutes || '—'} min</p>
                <p class="loc-protected">🔒 <em>Exact patient location, phone number and live route map will be displayed once you accept the request.</em></p>
            </div>
            <div class="actions">
                <button type="button" class="primary" onclick="driverAction(${e.id},'accept')">✓ ACCEPT REQUEST</button>
                <button type="button" class="danger-outline" onclick="driverAction(${e.id},'reject')">✕ REJECT REQUEST</button>
            </div>
        `;
        return;
    }

    // When ACCEPTED (EN_ROUTE, ARRIVED, PATIENT_PICKED, HOSPITAL_EN_ROUTE):
    let isDemoLoc = (Math.abs(e.latitude - 18.5204) < 0.0001 && Math.abs(e.longitude - 73.8567) < 0.0001);
    let locationLabel = isDemoLoc ? 'Pune, Maharashtra (Demo SOS Location)' : 'GPS Detected Location';
    let navUrl = `https://www.google.com/maps/dir/?api=1&destination=${e.latitude},${e.longitude}`;

    let nextAction = null;
    if (e.status === 'ARRIVED') {
        nextAction = `<button type="button" class="primary" onclick="driverAction(${e.id},'picked-up')">PATIENT PICKED UP</button>`;
    } else if (e.status === 'EN_ROUTE') {
        nextAction = `<span class="status-note">📍 En route to patient (GPS simulation in progress…)</span>`;
    } else if (e.status === 'HOSPITAL_EN_ROUTE') {
        nextAction = `<span class="status-note">🏥 Hospital pre-alert accepted · En route to hospital…</span>`;
    }

    box.className = 'panel case-card';
    box.innerHTML = `
        <div class="case-card-header">
            <div class="eyebrow">🚨 ACTIVE EMERGENCY CASE</div>
            <div>${badge(e.priority)} ${badge(e.status)}</div>
        </div>
        <div class="driver-case-grid">
            <div class="case-info">
                <h3 class="patient-title">Patient: ${escapeHtml(e.patient_name || 'Demo Patient')}</h3>
                <div class="info-list">
                    <div class="info-item">
                        <span class="label">Phone:</span>
                        <b><a href="tel:${escapeHtml(e.patient_phone || '9111111111')}" style="color:var(--navy);text-decoration:none">📞 ${escapeHtml(e.patient_phone || '9111111111')}</a></b>
                    </div>
                    <div class="info-item">
                        <span class="label">Incident ID:</span>
                        <b>${escapeHtml(e.incident_id)}</b>
                    </div>
                    <div class="info-item">
                        <span class="label">Emergency:</span>
                        <b>${escapeHtml(e.emergency_type)}</b>
                    </div>
                    <div class="info-item">
                        <span class="label">Priority:</span>
                        ${badge(e.priority)}
                    </div>
                    <div class="info-item">
                        <span class="label">Location:</span>
                        <b>${escapeHtml(locationLabel)}</b>
                    </div>
                    <div class="info-item">
                        <span class="label">Coordinates:</span>
                        <code>${e.latitude.toFixed(6)}, ${e.longitude.toFixed(6)}</code>
                    </div>
                    ${e.notes ? `
                        <div class="info-item">
                            <span class="label">Notes:</span>
                            <em>${escapeHtml(e.notes)}</em>
                        </div>
                    ` : ''}
                    <div class="info-item">
                        <span class="label">Distance & ETA:</span>
                        <b>${e.distance_km || '—'} km · ~${e.eta_minutes || '—'} min</b>
                    </div>
                </div>
                <div class="driver-nav-bar">
                    <a href="${navUrl}" target="_blank" rel="noopener noreferrer" class="btn-navigate">
                        🧭 Navigate in Google Maps
                    </a>
                </div>
                <div class="actions">
                    ${nextAction || ''}
                </div>
            </div>
            <div class="case-map-col">
                <div class="map-title">Route to Patient Location</div>
                <div id="driverMap" class="map driver-route-map"></div>
            </div>
        </div>
    `;

    renderDriverMap(e);
}

function renderDriverMap(e) {
    if (!window.L) return;
    if (driverMap) {
        driverMap.remove();
        driverMap = null;
    }
    let mapEl = document.getElementById('driverMap');
    if (!mapEl) return;

    let ambLat = (e.ambulance && e.ambulance.ambulance_latitude) || (driver && driver.latitude) || 18.5204;
    let ambLng = (e.ambulance && e.ambulance.ambulance_longitude) || (driver && driver.longitude) || 73.8567;
    let patLat = e.latitude;
    let patLng = e.longitude;

    driverMap = L.map('driverMap').setView([(ambLat + patLat) / 2, (ambLng + patLng) / 2], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(driverMap);

    L.marker([ambLat, ambLng]).addTo(driverMap).bindPopup(`🚑 Ambulance (${escapeHtml(driver?.registration_number || 'Driver')})`);
    L.marker([patLat, patLng]).addTo(driverMap).bindPopup(`🚨 Patient: ${escapeHtml(e.patient_name || 'Emergency Location')}`).openPopup();

    L.polyline([[ambLat, ambLng], [patLat, patLng]], {
        color: '#dc2626',
        weight: 4,
        opacity: 0.85,
        dashArray: '6, 8'
    }).addTo(driverMap);

    try {
        driverMap.fitBounds([[ambLat, ambLng], [patLat, patLng]], { padding: [25, 25] });
    } catch (err) {}

    setTimeout(() => {
        if (driverMap) driverMap.invalidateSize();
    }, 200);
}

function scheduleJourney(action, delay) {
    journeyTimers.push(setTimeout(() => driverAction(action.id, action.step), delay));
}

async function driverAction(id, a) {
    try {
        await api(`/api/emergency/${id}/${a}`, 'POST');
        if (a === 'accept') {
            toast('Accepted · En Route to patient location.');
            scheduleJourney({ id, step: 'arrived' }, 7000);
        } else if (a === 'picked-up') {
            toast('Pickup confirmed · Hospital pre-alert sent.');
            await api(`/api/emergency/${id}/hospital-trip`, 'POST');
            scheduleJourney({ id, step: 'complete' }, 7000);
        } else {
            toast('Case status updated');
        }
        await loadDriverCase();
        await refreshPatient();
        loadDashboard();
    } catch (x) {
        toast(x.message);
    }
}

async function checkCoord() {
    try {
        let me = await api('/api/me');
        if (me.user?.role === 'COORDINATOR') {
            document.getElementById('coordLogin').hidden = true;
            document.getElementById('coordPanel').hidden = false;
            loadDashboard();
        }
    } catch (err) {}
}

async function loadDashboard() {
    let panel = document.getElementById('coordPanel');
    if (!panel || panel.hidden) return;
    try {
        let [s, a, e, h] = await Promise.all([
            api('/api/dashboard/stats'),
            api('/api/ambulances'),
            api('/api/emergency'),
            api('/api/hospital-alerts')
        ]);
        let statsEl = document.getElementById('stats');
        if (statsEl) {
            statsEl.innerHTML = [
                ['Total Ambulances', s.total_ambulances],
                ['Available', s.available],
                ['Busy', s.busy],
                ['Pending', s.pending],
                ['Active SOS', s.active_emergencies]
            ].map(x => `<div class="stat"><b>${x[1]}</b><small>${x[0]}</small></div>`).join('');
        }

        let pending = a.ambulances.filter(x => x.verification_status === 'PENDING');
        let pendingEl = document.getElementById('pending');
        if (pendingEl) {
            pendingEl.innerHTML = pending.length ? pending.map(x => `
                <div>
                    <b>${escapeHtml(x.registration_number)}</b><br>
                    ${escapeHtml(x.driver_name)} · ${escapeHtml(x.ambulance_type)}<br>
                    <div style="margin-top:4px">
                        <button type="button" class="primary" style="padding:3px 8px;font-size:11px;margin:0" onclick="verify(${x.id},'VERIFY')">VERIFY</button>
                        <button type="button" class="danger-outline" style="padding:3px 8px;font-size:11px;margin:0" onclick="verify(${x.id},'REJECT')">REJECT</button>
                    </div>
                </div>
            `).join('') : 'No pending registrations.';
        }

        let alertsEl = document.getElementById('alerts');
        if (alertsEl) {
            alertsEl.innerHTML = h.alerts.length ? h.alerts.map(x => `
                <div class="case-card" style="margin-top:4px;padding:8px 10px">
                    <b>🚨 INCOMING EMERGENCY</b>
                    <p style="margin:2px 0 0;font-size:12px">${escapeHtml(x.hospital_name)} · ETA ${escapeHtml(x.eta)}<br><small style="color:var(--muted)">${escapeHtml(x.status)}</small></p>
                </div>
            `).join('') : 'No incoming patient alerts.';
        }

        let casesEl = document.getElementById('cases');
        if (casesEl) {
            casesEl.innerHTML = e.emergencies.map(x => `
                <tr>
                    <td><b>#${x.id}</b> · ${escapeHtml(x.emergency_type)}<br><small>${escapeHtml(x.patient_name || 'Patient')} · 📞 ${escapeHtml(x.patient_phone || '9111111111')}</small></td>
                    <td>${badge(x.priority)}</td>
                    <td>${x.ambulance ? `<b>${escapeHtml(x.ambulance.registration_number)}</b><br><small>${escapeHtml(x.ambulance.driver_name)}</small>` : 'Unassigned'}</td>
                    <td>${x.eta_minutes || '—'} min</td>
                    <td>${badge(x.status)}</td>
                    <td>${x.status === 'SEARCHING' ? `<button type="button" class="primary" style="padding:3px 8px;font-size:11px;margin:0" onclick="coordinatorMatch(${x.id})">Assign</button>` : x.status === 'HOSPITAL_EN_ROUTE' ? `<button type="button" class="danger-outline" style="padding:3px 8px;font-size:11px;margin:0" onclick="driverAction(${x.id},'complete')">Close</button>` : '—'}</td>
                </tr>
            `).join('');
        }

        renderCoordMap(a.ambulances, e.emergencies);
    } catch (err) {}
}

function renderCoordMap(amb, em) {
    if (coordMap) coordMap.remove();
    coordMap = makeMap('coordMap');
    if (!coordMap) return;
    amb.forEach(x => {
        L.marker([x.latitude, x.longitude]).addTo(coordMap).bindPopup(`🚑 ${escapeHtml(x.registration_number)} · ${escapeHtml(x.status)}`);
    });
    em.filter(x => x.status !== 'COMPLETED').forEach(x => {
        L.circleMarker([x.latitude, x.longitude], { color: '#dc2626', radius: 7, fillOpacity: 0.8 }).addTo(coordMap).bindPopup(`🚨 Emergency #${x.id} (${escapeHtml(x.emergency_type)})`);
    });
    setTimeout(() => { if (coordMap) coordMap.invalidateSize(); }, 200);
}

async function verify(id, decision) {
    try {
        await api(`/api/ambulances/${id}/verify`, 'POST', { decision });
        toast('Registration ' + decision.toLowerCase() + 'ed');
        loadDashboard();
    } catch (x) {
        toast(x.message);
    }
}

async function coordinatorMatch(id) {
    try {
        await api(`/api/emergency/${id}/match`, 'POST');
        loadDashboard();
        refreshPatient();
    } catch (x) {
        toast(x.message);
    }
}

async function resetDemo() {
    if (!confirm('Reset the full demo data?')) return;
    await api('/api/demo/reset', 'POST');
    journeyTimers.forEach(clearTimeout);
    journeyTimers = [];
    currentCase = null;
    driver = null;
    historyRecords = [];
    historySelected.clear();
    if (patientMap) { patientMap.remove(); patientMap = null; }
    if (coordMap) { coordMap.remove(); coordMap = null; }
    if (sosLocationMap) { sosLocationMap.remove(); sosLocationMap = null; }
    if (driverMap) { driverMap.remove(); driverMap = null; }
    document.querySelectorAll('.modal').forEach(modal => modal.hidden = true);
    document.body.classList.remove('sos-modal-open');
    document.getElementById('driverPanel').hidden = true;
    document.getElementById('driverLogin').hidden = false;
    document.getElementById('coordPanel').hidden = true;
    document.getElementById('coordLogin').hidden = false;
    renderPatient();
    toast('Demo reset. Default demo accounts restored.');
}

let historyRecords = [], historySelected = new Set(), historyTimer;
const historyDate = value => value ? value.replace(' ', ' · ') : 'Not recorded';

async function loadHistory() {
    let panel = document.getElementById('coordPanel');
    if (!panel || panel.hidden) return;
    try {
        let search = encodeURIComponent(document.getElementById('historySearch')?.value || '');
        let status = document.getElementById('historyStatus')?.value || 'ALL';
        let result = await api(`/api/history?search=${search}&status=${status}`);
        historyRecords = result.records;
        historySelected = new Set([...historySelected].filter(id => historyRecords.some(record => record.id === id)));
        renderHistory();
    } catch (error) {
        toast(error.message);
    }
}

function queueHistoryLoad() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(loadHistory, 250);
}

function renderHistory() {
    let body = document.getElementById('historyCases'),
        empty = document.getElementById('historyEmpty'),
        all = document.getElementById('historySelectAll'),
        bulk = document.getElementById('bulkDelete');
    if (!body) return;
    body.innerHTML = historyRecords.map(record => `
        <tr>
            <td><input type="checkbox" ${historySelected.has(record.id) ? 'checked' : ''} onchange="toggleHistory(${record.id},this.checked)"></td>
            <td><b>${escapeHtml(record.patient_name || 'Demo Patient')}</b><br><small>#${record.id} · ${escapeHtml(record.emergency_type)} · 📞 ${escapeHtml(record.patient_phone || '9111111111')}</small></td>
            <td><b>${escapeHtml(record.ambulance_number)}</b><br><small>${escapeHtml(record.driver_name)}</small></td>
            <td>${escapeHtml(record.hospital_name)}</td>
            <td>${historyDate(record.created_at)}</td>
            <td>${badge(record.status)}</td>
            <td><button type="button" class="danger-outline" style="padding:2px 6px;font-size:11px;margin:0" onclick="confirmDeleteHistory(${record.id})">Delete</button></td>
        </tr>
    `).join('');
    if (empty) empty.hidden = historyRecords.length > 0;
    if (all) all.checked = historyRecords.length > 0 && historySelected.size === historyRecords.length;
    if (bulk) {
        bulk.disabled = historySelected.size === 0;
        bulk.textContent = historySelected.size ? `Delete (${historySelected.size})` : 'Delete';
    }
}

function toggleHistory(id, checked) {
    checked ? historySelected.add(id) : historySelected.delete(id);
    renderHistory();
}

function toggleAllHistory(checked) {
    historySelected = checked ? new Set(historyRecords.map(record => record.id)) : new Set();
    renderHistory();
}

function openConfirm(title, text, action) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmText').textContent = text;
    let modal = document.getElementById('confirmModal');
    modal.hidden = false;
    document.getElementById('confirmDelete').onclick = async () => {
        try {
            await action();
            closeConfirm();
        } catch (error) {
            toast(error.message);
        }
    };
}

function closeConfirm() {
    let modal = document.getElementById('confirmModal');
    if (modal) modal.hidden = true;
}

function confirmDeleteHistory(id) {
    openConfirm('Delete history record?', 'Are you sure you want to permanently delete this record?', async () => {
        await api(`/api/history/${id}`, 'DELETE');
        historySelected.delete(id);
        await loadHistory();
        toast('History record deleted.');
    });
}

function confirmBulkDelete() {
    let count = historySelected.size;
    if (!count) return;
    openConfirm('Delete selected records?', `Are you sure you want to delete ${count} selected record(s)?`, async () => {
        await Promise.all([...historySelected].map(id => api(`/api/history/${id}`, 'DELETE')));
        historySelected.clear();
        await loadHistory();
        toast('Selected history records deleted.');
    });
}

function confirmClearHistory() {
    openConfirm('Clear all history?', 'Are you sure you want to permanently delete all completed/cancelled history records?', async () => {
        await api('/api/history', 'DELETE');
        historySelected.clear();
        await loadHistory();
        toast('History cleared.');
    });
}

const dashboardWithHistory = loadDashboard;
loadDashboard = async function () {
    await dashboardWithHistory();
    await loadHistory();
};

setInterval(() => {
    let driverP = document.getElementById('driverPanel');
    if (driverP && !driverP.hidden) loadDriverCase();
    let coordP = document.getElementById('coordPanel');
    if (coordP && !coordP.hidden) loadDashboard();
    let patientP = document.getElementById('patient');
    if (patientP && patientP.classList.contains('active')) refreshPatient();
}, 8000);
