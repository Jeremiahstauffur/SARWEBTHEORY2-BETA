const ROWS = 1;
const COLS = 5;
const DEFAULT_DYNAMIC_COLS = 3;
const BUNDLE_STORAGE_KEY = 'pill-table-bundle-v1';
const FILE_LIST_STORAGE_KEY = 'sar-saved-files-v1';
const DEFAULT_FILE_NAME = 'us-pill-data.json';
const SYNC_URL_STORAGE_KEY = 'sar-sync-url-v1';
const SYNC_BUCKET_STORAGE_KEY = 'sar-sync-bucket-v1';
const CALTOPO_PROXY_STORAGE_KEY = 'sar-caltopo-proxy-v1';
const CALTOPO_CREDS_STORAGE_KEY = 'sar-caltopo-creds-v1';
const DEVICE_ID_STORAGE_KEY = 'sar-device-id-v1';
// const DEFAULT_BUCKET = 'MNSAR14';
const SAVE_BUTTON_MIN_LOADING_MS = 1000;
const SAVE_BUTTON_SUCCESS_MS = 3000;
const MAP_PSRC_OVERLAY_STORAGE_KEY = 'sar-map-psrc-overlay-v1';
const CALTOPO_ASSIGNMENT_OVERLAY_STORAGE_KEY = 'sar-caltopo-assignment-overlay-v1';

function getMapSegmentUtils() {
    return (typeof window !== 'undefined' && window.SARMapSegmentUtils) ? window.SARMapSegmentUtils : {};
}

function ensureSegmentsPageRows(bundle) {
    const utils = getMapSegmentUtils();
    if (typeof utils.ensureSegmentsPageRows === 'function') {
        return utils.ensureSegmentsPageRows(bundle, defaultSegmentsData);
    }
    if (!bundle.pages) bundle.pages = {};
    if (Array.isArray(bundle.pages.page2)) return bundle.pages.page2;
    bundle.pages.page2 = defaultSegmentsData();
    return bundle.pages.page2;
}

function getCalTopoFeatureTypeKey(feature) {
    const utils = getMapSegmentUtils();
    return typeof utils.getFeatureTypeKey === 'function' ? utils.getFeatureTypeKey(feature) : 'other';
}

function getCalTopoFeatureTypeLabel(feature) {
    const utils = getMapSegmentUtils();
    return typeof utils.getFeatureTypeLabel === 'function' ? utils.getFeatureTypeLabel(feature) : 'Graphic';
}

function getFilteredSegmentImports(items, typeKey) {
    const utils = getMapSegmentUtils();
    if (typeof utils.filterSegmentImportsByType === 'function') {
        return utils.filterSegmentImportsByType(items, typeKey);
    }
    if (!typeKey || typeKey === 'all') return items.slice();
    return items.filter(item => item.typeKey === typeKey);
}

function buildSegmentPsrcLookup(rows, options = {}) {
    const utils = getMapSegmentUtils();
    return typeof utils.buildSegmentPsrcLookup === 'function'
        ? utils.buildSegmentPsrcLookup(rows, options)
        : {values: new Map(), maxValue: 0};
}

function getFeaturePsrcColor(feature, lookup, options = {}) {
    const utils = getMapSegmentUtils();
    return typeof utils.getFeaturePsrcColor === 'function' ? utils.getFeaturePsrcColor(feature, lookup, options) : null;
}

function getFeaturePsrcAssignmentStyle(feature, lookup, options = {}) {
    const utils = getMapSegmentUtils();
    if (typeof utils.getFeaturePsrcAssignmentStyle === 'function') {
        return utils.getFeaturePsrcAssignmentStyle(feature, lookup, options);
    }
    const color = getFeaturePsrcColor(feature, lookup, options);
    return color ? {stroke: color.css, fill: color.css, color} : null;
}

function normalizeSegmentNameForMatch(value) {
    const utils = getMapSegmentUtils();
    return typeof utils.normalizeSegmentName === 'function'
        ? utils.normalizeSegmentName(value)
        : String(value || '').trim().toLowerCase();
}

function getSegmentDisplaySettings(bundle) {
    const utils = getMapSegmentUtils();
    if (typeof utils.normalizeSegmentDisplaySettings === 'function') {
        return utils.normalizeSegmentDisplaySettings(bundle || {});
    }

    const normalizeColor = (value, fallback) => {
        const raw = String(value || '').trim();
        const stripped = raw.replace(/^#/, '').toLowerCase();
        if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(stripped)) {
            return fallback;
        }
        const expanded = stripped.length === 3
            ? stripped.split('').map(char => char + char).join('')
            : stripped;
        return `#${expanded}`;
    };
    const normalizeOpacity = value => {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 50;
    };
    const activeSearchOpacityPercent = normalizeOpacity(bundle?.segmentActiveSearchOpacityPercent);

    return {
        usePsriMax: bundle?.segmentColorScaleUsePsriMax === true,
        lowColor: normalizeColor(bundle?.segmentColorScaleLowColor, '#40c057'),
        midColor: normalizeColor(bundle?.segmentColorScaleMidColor, '#ffd43b'),
        highColor: normalizeColor(bundle?.segmentColorScaleHighColor, '#fa5252'),
        activeSearchOpacityPercent,
        activeSearchOpacity: activeSearchOpacityPercent / 100
    };
}

function formatSegmentAssignmentLabel(region, segment) {
    const utils = getMapSegmentUtils();
    if (typeof utils.formatSegmentAssignmentLabel === 'function') {
        return utils.formatSegmentAssignmentLabel(region, segment);
    }

    const trimmedSegment = String(segment || '').trim();
    const trimmedRegion = String(region || '').trim();
    if (!trimmedSegment) return '';
    return trimmedRegion ? `${trimmedRegion} - ${trimmedSegment}` : trimmedSegment;
}

function buildActiveSearchSegmentNameSet(bundle, rows) {
    const utils = getMapSegmentUtils();
    if (typeof utils.buildActiveSearchSegmentNameSet === 'function') {
        return utils.buildActiveSearchSegmentNameSet(
            rows || ensureSegmentsPageRows(bundle),
            bundle?.currentAssignments || {},
            bundle?.teamStatuses || {}
        );
    }

    const names = new Set();
    const currentAssignments = bundle?.currentAssignments || {};
    const teamStatuses = bundle?.teamStatuses || {};
    (rows || ensureSegmentsPageRows(bundle)).forEach(row => {
        const fullName = formatSegmentAssignmentLabel(row?.[0], row?.[1]);
        if (!fullName) return;
        const isSearching = Object.entries(currentAssignments).some(([teamName, assignment]) => {
            const status = String(teamStatuses[teamName] || '').trim().toLowerCase();
            return String(assignment || '').includes(fullName) && status && !status.includes('finished segment') && !status.startsWith('at base');
        });
        if (!isSearching) return;
        names.add(normalizeSegmentNameForMatch(row?.[1]));
        names.add(normalizeSegmentNameForMatch(fullName));
    });
    return names;
}

function isFeatureActivelyBeingSearched(feature, activeSearchNames) {
    const utils = getMapSegmentUtils();
    if (typeof utils.isFeatureActivelyBeingSearched === 'function') {
        return utils.isFeatureActivelyBeingSearched(feature, activeSearchNames);
    }

    const attributes = feature?.attributes || feature?.properties || {};
    const keys = [attributes.name, feature?.name, attributes.label, attributes.title]
        .map(normalizeSegmentNameForMatch)
        .filter(Boolean);
    return keys.some(key => activeSearchNames instanceof Set && activeSearchNames.has(key));
}

function resolveDisplayedSegmentOpacity(isActiveSearch, settings, baseOpacity = 0.2) {
    const utils = getMapSegmentUtils();
    if (typeof utils.resolveDisplayedSegmentOpacity === 'function') {
        return utils.resolveDisplayedSegmentOpacity(isActiveSearch, settings, baseOpacity);
    }

    const safeBaseOpacity = Number.isFinite(baseOpacity) ? Math.min(1, Math.max(0, baseOpacity)) : 0.2;
    return isActiveSearch ? getSegmentDisplaySettings(settings).activeSearchOpacity : safeBaseOpacity;
}

function buildSegmentNameSet(rows) {
    const utils = getMapSegmentUtils();
    if (typeof utils.buildSegmentNameSet === 'function') {
        return utils.buildSegmentNameSet(rows);
    }
    const names = new Set();
    (rows || []).forEach(row => {
        const nameKey = normalizeSegmentNameForMatch(row?.[1]);
        if (nameKey) names.add(nameKey);
    });
    return names;
}

function isMapPsrcOverlayEnabled() {
    return localStorage.getItem(MAP_PSRC_OVERLAY_STORAGE_KEY) === 'true';
}

function setMapPsrcOverlayEnabled(enabled) {
    localStorage.setItem(MAP_PSRC_OVERLAY_STORAGE_KEY, enabled ? 'true' : 'false');
}

function isCalTopoAssignmentOverlayEnabled() {
    return localStorage.getItem(CALTOPO_ASSIGNMENT_OVERLAY_STORAGE_KEY) === 'true';
}

function setCalTopoAssignmentOverlayEnabled(enabled) {
    localStorage.setItem(CALTOPO_ASSIGNMENT_OVERLAY_STORAGE_KEY, enabled ? 'true' : 'false');
}

function captureCalTopoFeatureStyle(attributes = {}) {
    return {
        stroke: Object.prototype.hasOwnProperty.call(attributes, 'stroke') ? attributes.stroke : null,
        fill: Object.prototype.hasOwnProperty.call(attributes, 'fill') ? attributes.fill : null,
        'fill-opacity': Object.prototype.hasOwnProperty.call(attributes, 'fill-opacity') ? attributes['fill-opacity'] : null,
        opacity: Object.prototype.hasOwnProperty.call(attributes, 'opacity') ? attributes.opacity : null
    };
}

function resolveOverlayOpacity(value, fallback = 1) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function applyCapturedCalTopoFeatureStyle(attributes, style = {}) {
    ['stroke', 'fill', 'fill-opacity', 'opacity'].forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(style, key)) {
            return;
        }
        const value = style[key];
        if (value === null || value === undefined || value === '') {
            delete attributes[key];
        } else {
            attributes[key] = value;
        }
    });
}

function buildCalTopoFeatureUpdatePayload(feature, styleOverrides = {}) {
    const attributes = {...(feature?.attributes || {})};
    const geometry = feature?.geometry ? JSON.parse(JSON.stringify(feature.geometry)) : null;

    delete attributes.ObjectID;
    delete attributes.id;

    applyCapturedCalTopoFeatureStyle(attributes, styleOverrides);

    return {
        id: feature?.attributes?.id || null,
        type: 'Feature',
        geometry,
        properties: attributes
    };
}

async function updateCalTopoAssignmentOverlay(enabled, options = {}) {
    const {ensureFeaturesLoaded = false} = options;
    let bundle = loadBundle();
    let map = bundle.maps && bundle.maps[0] ? bundle.maps[0] : null;

    if (!map || !map.id) {
        throw new Error('Please add a CalTopo map first.');
    }

    if ((!Array.isArray(map.features) || map.features.length === 0) && ensureFeaturesLoaded) {
        await caltopo_request(null, {silent: true});
        bundle = loadBundle();
        map = bundle.maps && bundle.maps[0] ? bundle.maps[0] : null;
    }

    const features = Array.isArray(map?.features) ? map.features : [];
    if (!features.length) {
        throw new Error('Fetch Shapes first so the app knows which CalTopo assignments to update.');
    }

    if (!map.caltopoAssignmentOverlayState || typeof map.caltopoAssignmentOverlayState !== 'object') {
        map.caltopoAssignmentOverlayState = {originals: {}};
    }
    if (!map.caltopoAssignmentOverlayState.originals || typeof map.caltopoAssignmentOverlayState.originals !== 'object') {
        map.caltopoAssignmentOverlayState.originals = {};
    }

    const originals = map.caltopoAssignmentOverlayState.originals;
    const segmentRows = ensureSegmentsPageRows(bundle);
    const segmentDisplaySettings = getSegmentDisplaySettings(bundle);
    const psrcLookup = buildSegmentPsrcLookup(segmentRows, segmentDisplaySettings);
    const activeSearchNames = buildActiveSearchSegmentNameSet(bundle, segmentRows);
    const matchingAssignments = features.filter(feature => {
        const featureId = feature?.attributes?.id;
        if (!featureId || getCalTopoFeatureTypeKey(feature) !== 'assignment') {
            return false;
        }
        if (!enabled) {
            return !!originals[featureId];
        }
        return !!getFeaturePsrcAssignmentStyle(feature, psrcLookup, segmentDisplaySettings);
    });

    if (!matchingAssignments.length) {
        if (!enabled) {
            delete map.caltopoAssignmentOverlayState;
            saveBundle(bundle);
            return {updatedCount: 0};
        }
        throw new Error('No matching assignment shapes were found for your current segments.');
    }

    for (const feature of matchingAssignments) {
        const featureId = feature.attributes.id;
        const featureName = feature.attributes.name || featureId;
        const originalStyle = originals[featureId] || captureCalTopoFeatureStyle(feature.attributes);
        const style = enabled
            ? getFeaturePsrcAssignmentStyle(feature, psrcLookup, segmentDisplaySettings)
            : originals[featureId];

        if (!style) {
            continue;
        }

        if (enabled && !Object.prototype.hasOwnProperty.call(originals, featureId)) {
            originals[featureId] = originalStyle;
        }

        const isActiveSearch = enabled && isFeatureActivelyBeingSearched(feature, activeSearchNames);
        const opacityFactor = isActiveSearch ? segmentDisplaySettings.activeSearchOpacity : 1;
        const overlayStyle = enabled
            ? {
                stroke: style.stroke,
                fill: style.fill,
                'fill-opacity': Number((resolveOverlayOpacity(originalStyle['fill-opacity'], resolveOverlayOpacity(feature.attributes['fill-opacity'], 0.35)) * opacityFactor).toFixed(4)),
                opacity: Number((resolveOverlayOpacity(originalStyle.opacity, resolveOverlayOpacity(feature.attributes.opacity, 1)) * opacityFactor).toFixed(4))
            }
            : style;

        const payload = buildCalTopoFeatureUpdatePayload(feature, overlayStyle);
        const endpoint = `/api/v1/map/${encodeURIComponent(map.id)}/Shape/${encodeURIComponent(featureId)}`;
        const result = await caltopo_api_call('POST', endpoint, payload, map.domain || 'caltopo.com');
        if (!result) {
            throw new Error(`CalTopo could not update assignment "${featureName}".`);
        }

        applyCapturedCalTopoFeatureStyle(feature.attributes, overlayStyle);
    }

    if (enabled) {
        map.caltopoAssignmentOverlayState.updatedAt = Date.now();
    } else {
        delete map.caltopoAssignmentOverlayState;
    }

    saveBundle(bundle);
    return {updatedCount: matchingAssignments.length};
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withSaveButtonFeedback(button, saveAction, options = {}) {
    if (!button || button.dataset.saveFeedbackBusy === 'true') {
        return;
    }

    const loadingLabel = options.loadingLabel || 'Saving';
    const originalHtml = button.dataset.saveFeedbackOriginalHtml || button.innerHTML;
    const originallyDisabled = button.disabled;
    button.dataset.saveFeedbackOriginalHtml = originalHtml;
    button.dataset.saveFeedbackBusy = 'true';
    button.disabled = true;
    button.classList.remove('save-feedback-success');
    button.classList.add('save-feedback-loading');
    button.innerHTML = `<span class="save-feedback-spinner" aria-hidden="true"></span><span>${loadingLabel}</span>`;

    const startedAt = Date.now();

    try {
        const result = await Promise.resolve(saveAction());
        const remainingLoadingTime = SAVE_BUTTON_MIN_LOADING_MS - (Date.now() - startedAt);
        if (remainingLoadingTime > 0) {
            await wait(remainingLoadingTime);
        }

        button.classList.remove('save-feedback-loading');
        button.classList.add('save-feedback-success');
        await wait(SAVE_BUTTON_SUCCESS_MS);
        return result;
    } catch (error) {
        const remainingLoadingTime = SAVE_BUTTON_MIN_LOADING_MS - (Date.now() - startedAt);
        if (remainingLoadingTime > 0) {
            await wait(remainingLoadingTime);
        }
        throw error;
    } finally {
        button.classList.remove('save-feedback-loading', 'save-feedback-success');
        button.innerHTML = originalHtml;
        button.disabled = originallyDisabled;
        delete button.dataset.saveFeedbackBusy;
    }
}

function getSyncServerUrl() {
    let url = localStorage.getItem(SYNC_URL_STORAGE_KEY);
    return url || 'https://sarwebtheory2-production.up.railway.app';
}

function getSyncBucket() {
    return localStorage.getItem(SYNC_BUCKET_STORAGE_KEY) || '';
}

function showBucketPromptPopup() {
    const onCancel = () => {
        if (!getSyncBucket()) {
            // We need a slight delay because createPopup handles its own close which might conflict with immediate reshhow
            setTimeout(() => {
                if (!getSyncBucket()) {
                    alert('A Bucket ID is required to synchronize data.');
                    showBucketPromptPopup();
                }
            }, 300);
        }
    };
    const popup = createPopup('Set Bucket ID', null, onCancel);
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');

    // Override the default flex-direction: column for popup-buttons to make them side-by-side if we want,
    // but the issue said "very short and wide", and standard popup-buttons are column.
    // Given they are "popup-btn", they will have good padding now.
    
    const inputs = document.createElement('div');
    inputs.className = 'popup-input-container';
    inputs.style.flexDirection = 'column';
    inputs.style.gap = '15px';

    const promptText = document.createElement('p');
    promptText.textContent = 'Please enter a unique Bucket ID to synchronize your data across devices.';
    promptText.style.textAlign = 'center';
    promptText.style.marginBottom = '10px';
    inputs.appendChild(promptText);

    const bucketInput = document.createElement('input');
    bucketInput.type = 'text';
    bucketInput.placeholder = 'e.g., my-team-bucket';
    bucketInput.className = 'pill-input';
    bucketInput.style.textAlign = 'center';
    bucketInput.style.width = '100%';
    bucketInput.style.padding = '16px';
    bucketInput.style.fontSize = '1.1rem';
    bucketInput.style.marginTop = '10px';
    inputs.appendChild(bucketInput);

    content.insertBefore(inputs, btnContainer);

    const setBtn = document.createElement('button');
    setBtn.className = 'popup-btn primary';
    setBtn.style.padding = '16px'; // Extra padding for emphasis
    setBtn.textContent = 'Set Bucket ID & Reload';
    setBtn.onclick = () => {
        const val = bucketInput.value.trim();
        if (val) {
            localStorage.setItem(SYNC_BUCKET_STORAGE_KEY, val);
            closePopup(popup);
            window.location.reload();
        } else {
            alert('Please enter a valid Bucket ID');
        }
    };
    btnContainer.appendChild(setBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'popup-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
        onCancel();
        closePopup(popup);
    };
    btnContainer.appendChild(cancelBtn);

    bucketInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            setBtn.click();
        }
    };

    setTimeout(() => bucketInput.focus(), 100);
}

function normalizeCalTopoProxyUrl(url) {
    const trimmedUrl = typeof url === 'string' ? url.trim() : '';
    if (!trimmedUrl) {
        return '';
    }

    let normalizedUrl = trimmedUrl;
    if (normalizedUrl.includes(':5050')) {
        normalizedUrl = normalizedUrl.replace('http://', 'https://').replace(':5050', '');
    }

    if (normalizedUrl.includes('.php')) {
        return normalizedUrl;
    }

    const [baseUrl, queryString = ''] = normalizedUrl.split('?');
    let resolvedBaseUrl = baseUrl.replace(/\/fetch-map\/?$/, '/api/proxy');
    resolvedBaseUrl = resolvedBaseUrl.replace(/\/api\/health\/?$/, '/api/proxy');
    if (!/\/(api\/proxy|fetch-map)\/?$/i.test(resolvedBaseUrl)) {
        resolvedBaseUrl = resolvedBaseUrl.replace(/\/$/, '') + '/api/proxy';
    }

    return queryString ? `${resolvedBaseUrl}?${queryString}` : resolvedBaseUrl;
}

function getCalTopoProxyHealthUrl(url) {
    const normalizedProxyUrl = normalizeCalTopoProxyUrl(url);
    if (!normalizedProxyUrl) {
        return '';
    }

    if (normalizedProxyUrl.includes('.php')) {
        return normalizedProxyUrl.split('?')[0] + (normalizedProxyUrl.includes('?') ? '&' : '?') + 'health=1';
    }

    const [baseUrl] = normalizedProxyUrl.split('?');
    return baseUrl.replace(/\/fetch-map\/?$/, '/api/health').replace(/\/api\/proxy\/?$/, '/api/health');
}

function getCalTopoProxy() {
    let proxy = localStorage.getItem(CALTOPO_PROXY_STORAGE_KEY);
    // Migration: Migrate from old SARTopo key if needed
    if (!proxy) {
        const oldProxy = localStorage.getItem('sar-sartopo-proxy-v1');
        if (oldProxy) {
            proxy = oldProxy;
            localStorage.setItem(CALTOPO_PROXY_STORAGE_KEY, proxy);
            localStorage.removeItem('sar-sartopo-proxy-v1');
        }
    }
    const normalizedProxy = normalizeCalTopoProxyUrl(proxy);
    if (proxy && normalizedProxy && proxy !== normalizedProxy) {
        proxy = normalizedProxy;
        localStorage.setItem(CALTOPO_PROXY_STORAGE_KEY, proxy);
    }
    return proxy || 'https://sarwebtheory2-production.up.railway.app/api/proxy';
}

const checkProxyHealth = async (timeoutMs = 5000) => {
    const dot = document.getElementById('proxy-status-dot');
    const text = document.getElementById('proxy-status-text');
    if (!dot || !text) return;


    const proxyUrl = getCalTopoProxy();

    // Immediate feedback
    dot.style.background = '#ffd43b'; // Yellow for checking
    text.textContent = 'Checking...';

    if (!proxyUrl) {
        dot.style.background = '#ff6b6b';
        text.textContent = 'Not Configured';
        return;
    }

    // Derived health endpoint from proxyUrl
    const healthUrl = getCalTopoProxyHealthUrl(proxyUrl);

    try {
    // console.log('[PROXY] Checking health:', healthUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const healthUrlWithBuster = healthUrl.includes('?') ? `${healthUrl}&_=${Date.now()}` : `${healthUrl}?_=${Date.now()}`;
        const resp = await fetch(healthUrlWithBuster, {signal: controller.signal});
        clearTimeout(timeoutId);

        if (resp.ok) {
            const data = await resp.json().catch(() => ({}));
            if (data.caltopoSigningConfigured) {
                dot.style.background = '#40c057';
                text.textContent = 'Ready' + (data.version ? ` (${data.version})` : '');
                text.title = `Connected to proxy ${data.version || ''} at ${healthUrl}. Proxy has CalTopo signing credentials ready on the backend.`;
            } else if (data.supportsClientSuppliedCredentials === false) {
                dot.style.background = '#ffd43b';
                text.textContent = 'Needs CalTopo Credentials';
                text.title = data.credentialConfigPaths && data.credentialConfigPaths.length
                    ? `Connected to proxy ${data.version || ''} at ${healthUrl}, but you still need to configure CALTOPO_CREDENTIAL_ID and CALTOPO_CREDENTIAL_SECRET on the proxy server in ${data.credentialConfigPaths.join(' or ')} or as deployed environment variables.`
                    : `Connected to proxy ${data.version || ''} at ${healthUrl}, but you still need to configure CALTOPO_CREDENTIAL_ID and CALTOPO_CREDENTIAL_SECRET on the proxy server.`;
            } else {
                dot.style.background = '#40c057';
                text.textContent = 'Online' + (data.version ? ` (${data.version})` : '');
                text.title = `Connected to proxy ${data.version || ''} at ${healthUrl}`;
            }
        } else {
            console.warn('[PROXY] Health check returned error:', resp.status);
            dot.style.background = '#ff6b6b';
            text.textContent = 'Error ' + resp.status;
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn('[PROXY] Health check timed out');
            dot.style.background = '#ff6b6b';
            text.textContent = 'Timeout';
            return;
        }
        console.error('[PROXY] Health check failed:', err);
        dot.style.background = '#ff6b6b';
        text.textContent = 'Offline';

        // Helpful tip for mixed content or unreachable
        if (window.location.protocol === 'https:' && healthUrl.startsWith('http:')) {
            console.error('[PROXY] Mixed content detected! Site is HTTPS but proxy is HTTP.');
            text.textContent = 'Offline (Security)';
        } else if (healthUrl.includes(':5050')) {
            console.info('[PROXY] Using port 5050. Ensure the proxy is listening on this port and it is publicly accessible.');
        }
    }
};

function setCalTopoProxy(url) {
    if (url) localStorage.setItem(CALTOPO_PROXY_STORAGE_KEY, url);
    else localStorage.removeItem(CALTOPO_PROXY_STORAGE_KEY);
}

function getCalTopoCredentials() {
    return JSON.parse(localStorage.getItem(CALTOPO_CREDS_STORAGE_KEY) || '{}');
}

function setCalTopoCredentials(creds) {
    localStorage.setItem(CALTOPO_CREDS_STORAGE_KEY, JSON.stringify(creds));
}

function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id) {
        id = 'device-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
}

const PAGE_DEFS = [
  { key: 'index', title: 'Regions', href: 'index.html' },
  { key: 'page2', title: 'Segments', href: 'page2.html' },
  { key: 'page3', title: 'Personnel', href: 'page3.html' },
  { key: 'page4', title: 'Search Log', href: 'page4.html' },
  { key: 'page5', title: 'Forms', href: 'page5.html' },
  { key: 'page6', title: 'Incident', href: 'page6.html' },
  { key: 'page7', title: 'Uploads', href: 'page7.html' },
  { key: 'page8', title: 'User Account', href: 'page8.html' },
  { key: 'page10', title: 'Maps', href: 'page10.html' },
  { key: 'settings', title: 'Settings', href: 'settings.html' }
];

const MOBILE_NAV_PAGE_DEFS = [
    {key: 'home', title: 'Home', href: 'home.html'},
    ...PAGE_DEFS
];

const MOBILE_NAV_ITEMS = [
    {
        key: 'home',
        title: 'Home',
        href: 'home.html',
        label: 'Home',
        icon: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>'
    },
    {
        key: 'index',
        title: 'Regions',
        href: 'index.html',
        label: 'Regions',
        icon: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><polyline points="12 2 2 7 12 12 22 7 12 2"></polyline><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>'
    },
    {
        key: 'pages',
        title: 'Pages',
        label: 'Pages',
        icon: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="7" rx="1.5"></rect><rect x="14" y="4" width="7" height="7" rx="1.5"></rect><rect x="3" y="13" width="7" height="7" rx="1.5"></rect><rect x="14" y="13" width="7" height="7" rx="1.5"></rect></svg>'
    },
    {
        key: 'page10',
        title: 'Maps',
        href: 'page10.html',
        label: 'Maps',
        icon: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" x2="8" y1="2" y2="18"></line><line x1="16" x2="16" y1="6" y2="22"></line></svg>'
    }
];

const BRAND_NAME = 'Search & Rescue Theory Software';

let newlyImportedSegments = new Set();

const HIGHLIGHT_COLORS = {
    orange: '#ffa500',
    yellow: '#ffff00',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
    purple: '#800080',
    brown: '#a52a2a',
    black: '#000000',
    white: '#ffffff',
    grey: '#808080',
    maroon: '#800000'
};

function pageKey() {
  return document.body.dataset.page || 'index';
}

function isHomePage() {
  return pageKey() === 'home';
}

function isRegionsPage() {
  return pageKey() === 'index';
}

function isSettingsPage() {
  return pageKey() === 'settings';
}

function isSegmentsPage() {
  const pk = pageKey();
  return pk === 'page2' || pk === 'index';
}

function isPersonnelPage() {
  return pageKey() === 'page3';
}

function isSearchLogPage() {
  return pageKey() === 'page4';
}

function isUploadsPage() {
  const pk = pageKey();
  return pk === 'page7' || pk === 'uploads';
}

function isFormsPage() {
  return pageKey() === 'page5';
}

function isProfilePage() {
  return pageKey() === 'page6';
}

function isPage8() {
  return pageKey() === 'page8';
}

function isPage9() {
  return pageKey() === 'page9';
}

function isMapsPage() {
  return pageKey() === 'page10';
}

function isMobileStatusPage() {
  return pageKey() === 'mobile-status';
}

function getCurrentUser() {
  const userJson = sessionStorage.getItem('sar-current-user');
  if (!userJson) return null;
  return JSON.parse(userJson);
}

function isUserAdmin(user) {
    return !!user;
}

function getAccountName(user) {
    if (!user) return '';
    if (user.pin === '1976') return 'Super-Admin';
    return (user.firstName + (user.lastName ? ' ' + (user.lastName || '') : '')).trim();
}

function getVisibleMobileNavPages(user = getCurrentUser()) {
    const visibleKeys = Array.isArray(user?.visiblePages) && user.visiblePages.length
        ? new Set(user.visiblePages)
        : null;
    const currentPage = pageKey();
    const pages = MOBILE_NAV_PAGE_DEFS.filter(def => {
        if (!visibleKeys) return true;
        return visibleKeys.has(def.key) || def.key === 'home' || def.key === currentPage;
    });

    if (currentPage === 'more' && !pages.some(def => def.key === 'more')) {
        pages.push({key: 'more', title: 'Navigation', href: 'more.html'});
    }

    return pages;
}

function isMobilePagesActionActive(currentPage = pageKey()) {
    return !['home', 'index', 'page10'].includes(currentPage);
}

function getMobileNavSheet() {
    let overlay = document.getElementById('mobile-nav-sheet-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'mobile-nav-sheet-overlay';
    overlay.className = 'mobile-nav-sheet-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="mobile-nav-sheet-backdrop"></div>
      <div class="mobile-nav-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-sheet-title">
        <div class="mobile-nav-sheet-handle" aria-hidden="true"></div>
        <div class="mobile-nav-sheet-header">
          <div>
            <div class="mobile-nav-sheet-eyebrow">Quick navigation</div>
            <h2 class="mobile-nav-sheet-title" id="mobile-nav-sheet-title">Choose a page</h2>
          </div>
          <div class="mobile-nav-sheet-subtitle" id="mobile-nav-sheet-subtitle"></div>
        </div>
        <div class="mobile-nav-sheet-options" id="mobile-nav-sheet-options"></div>
        <button type="button" class="mobile-nav-sheet-cancel" id="mobile-nav-sheet-cancel">Cancel</button>
      </div>
    `;

    overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.classList.contains('mobile-nav-sheet-backdrop')) {
            closeMobileNavSheet();
        }
    });

    overlay.querySelector('#mobile-nav-sheet-cancel').addEventListener('click', closeMobileNavSheet);

    if (!document.body.dataset.mobileNavSheetBound) {
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMobileNavSheet();
        });
        document.body.dataset.mobileNavSheetBound = 'true';
    }

    document.body.appendChild(overlay);
    return overlay;
}

function closeMobileNavSheet() {
    const overlay = document.getElementById('mobile-nav-sheet-overlay');
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('is-open');
    document.body.classList.remove('mobile-nav-sheet-open');
    window.setTimeout(() => {
        overlay.hidden = true;
    }, 180);
}

function openMobileNavSheet() {
    const overlay = getMobileNavSheet();
    overlay.hidden = false;
    window.requestAnimationFrame(() => {
        overlay.classList.add('is-open');
    });
    document.body.classList.add('mobile-nav-sheet-open');
}

function syncMobileBottomNav() {
    if (typeof document === 'undefined') return;

    const navs = document.querySelectorAll('.bottom-nav');
    if (!navs.length) return;

    const currentPage = pageKey();
    const visiblePages = getVisibleMobileNavPages();
    const overlay = getMobileNavSheet();
    const options = overlay.querySelector('#mobile-nav-sheet-options');
    const subtitle = overlay.querySelector('#mobile-nav-sheet-subtitle');
    const currentUser = getCurrentUser();

    subtitle.textContent = currentUser ? `Signed in as ${getAccountName(currentUser) || 'Current User'}` : 'Available pages';

    options.replaceChildren();
    visiblePages.forEach(def => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `mobile-nav-option${currentPage === def.key ? ' active' : ''}`;
        option.textContent = def.title;
        option.addEventListener('click', () => {
            closeMobileNavSheet();
            navigateToPage(def.href);
        });
        options.appendChild(option);
    });

    navs.forEach(nav => {
        nav.classList.add('bottom-nav--enhanced');
        nav.replaceChildren();

        MOBILE_NAV_ITEMS.forEach(item => {
            const isActive = item.key === 'pages'
                ? isMobilePagesActionActive(currentPage)
                : currentPage === item.key;
            const element = document.createElement(item.href ? 'a' : 'button');
            if (item.href) {
                element.href = item.href;
            } else {
                element.type = 'button';
            }
            element.className = `bottom-nav-action${isActive ? ' active' : ''}`;
            element.setAttribute('aria-label', item.title);
            element.innerHTML = `${item.icon}<span>${item.label}</span>`;

            if (!item.href) {
                element.addEventListener('click', openMobileNavSheet);
            }

            nav.appendChild(element);
        });
    });
}

function applyResponsiveTableLabels(table) {
    if (!table) return;
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    if (!headers.length) return;

    table.querySelectorAll('tbody tr').forEach(row => {
        Array.from(row.children).forEach((cell, index) => {
            if (!cell || cell.nodeType !== 1) return;
            const label = headers[index] || '';
            if (label) {
                cell.dataset.label = label;
            }
        });
    });
}

function refreshTaskAssignmentMobileLayout(container = document.getElementById('interactive-form-container')) {
    if (!container) return;
    container.querySelectorAll('.form-grid-table').forEach(applyResponsiveTableLabels);
}

function initTaskAssignmentMobileLayout() {
    const container = document.getElementById('interactive-form-container');
    if (!container || container.dataset.mobileLayoutReady === 'true') return;

    refreshTaskAssignmentMobileLayout(container);

    const observer = new MutationObserver(() => {
        refreshTaskAssignmentMobileLayout(container);
    });
    observer.observe(container, {childList: true, subtree: true});
    container.dataset.mobileLayoutReady = 'true';
}

function setupAutoFormatDate(input) {
  input.oninput = () => {
      let val = input.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    let formatted = val;
    if (val.length > 4) {
      formatted = val.slice(0, 2) + '-' + val.slice(2, 4) + '-' + val.slice(4);
    } else if (val.length > 2) {
      formatted = val.slice(0, 2) + '-' + val.slice(2);
    }
    input.value = formatted;
  };
}

function setupAutoFormatTime(input) {
  input.oninput = () => {
      let val = input.value.replace(/\D/g, '');
    if (val.length > 4) val = val.slice(0, 4);
    let formatted = val;
    if (val.length > 2) {
      formatted = val.slice(0, 2) + ':' + val.slice(2);
    }
    input.value = formatted;
  };
}

function showStatusPicker(currentStatus, onSelect) {
    const statuses = ['Enroute', 'On-Scene', 'Hotel', 'Returning Home', 'Arrived Home', 'Off Duty'];
    const popup = createPopup('Select Status');
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');
    
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '10px';
    list.style.marginBottom = '20px';
    
    statuses.forEach(status => {
        const btn = document.createElement('button');
        btn.className = 'popup-btn';
        btn.style.width = '100%';
        btn.style.textAlign = 'center';
        btn.textContent = status;
        if (currentStatus === status || (currentStatus === 'true' && status === 'On-Scene') || (currentStatus === 'false' && status === 'Off Duty')) {
            btn.classList.add('primary');
        }
        btn.onclick = () => {
            onSelect(status);
            popup.remove();
        };
        list.appendChild(btn);
    });
    
    content.insertBefore(list, btnContainer);
}

function showTimePrompt(title, onConfirm, onCancel, initialTime = null, onPopupCreated = null) {
    const popup = createPopup(title, null, onCancel);
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');

    const inputs = document.createElement('div');
    inputs.className = 'popup-input-container';

    const now = new Date();
    const defaultDate = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()}`;
    const defaultTime = initialTime || `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const dateInput = document.createElement('input');
    dateInput.className = 'pill-input';
    dateInput.placeholder = 'MM-DD-YYYY';
    dateInput.value = defaultDate;
    setupAutoFormatDate(dateInput);
    inputs.appendChild(dateInput);

    const timeInput = document.createElement('input');
    timeInput.className = 'pill-input';
    timeInput.placeholder = 'hh:mm';
    timeInput.value = defaultTime;
    setupAutoFormatTime(timeInput);
    inputs.appendChild(timeInput);

    content.insertBefore(inputs, btnContainer);

    if (onPopupCreated) onPopupCreated(popup);

    const updateBtn = document.createElement('button');
    updateBtn.className = 'popup-btn primary';
    updateBtn.textContent = 'Update';
    updateBtn.onclick = () => {
        onConfirm(dateInput.value, timeInput.value);
        popup.remove();
    };
    btnContainer.appendChild(updateBtn);
}

function setCurrentUser(user) {
  if (user) {
    sessionStorage.setItem('sar-current-user', JSON.stringify(user));
    notifyActiveUser(user);
  } else {
    sessionStorage.removeItem('sar-current-user');
  }
    syncMobileBottomNav();
}

function checkAccess() {
  const user = getCurrentUser();
  const page = pageKey();
  const bundle = loadBundle();

  if (!user) {
    const superAdmin = (bundle.accounts || []).find(a => a.pin === '1976');
    if (superAdmin) {
        setCurrentUser(superAdmin);
        return;
    }
    if (page !== 'index') navigateToPage('index.html');
    return;
  }

  // Refresh user data from bundle to ensure visiblePages are up to date
  const actualUser = (bundle.accounts || []).find(a => a.pin === user.pin);
  if (actualUser) {
      setCurrentUser(actualUser);
      if (isUserAdmin(actualUser)) return; // Admin has access to everything
  }

  if (page === 'page9') {
      // Everyone is an admin now
      return;
  }

    if (actualUser && actualUser.visiblePages) {
        // Everyone is allowed access to everything now
    }
}

function defaultSearchLogData() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: 10 }, () => '')
  );
}

function defaultPersonnelData() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: 14 }, () => '')
  );
}

function defaultSegmentsData() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: 10 }, () => '')
  );
}

function defaultData() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => '')
  );
}

function defaultRegionsData() {
  const dynamicCount = typeof DEFAULT_DYNAMIC_COLS !== 'undefined' ? DEFAULT_DYNAMIC_COLS : 3;
  return {
    headers: ['Region', ...Array.from({ length: dynamicCount }, (_, i) => `Voter ${i + 1}`), 'Consensus'],
    rows: Array.from({ length: typeof ROWS !== 'undefined' ? ROWS : 10 }, () => Array.from({ length: dynamicCount + 2 }, () => '')),
    voterVisibility: Array.from({ length: dynamicCount }, () => false)
  };
}

function defaultBundle() {
  return {
    fileName: DEFAULT_FILE_NAME,
    lastModified: new Date(0).toISOString(),
    deleteMode: false,
    theme: 'dark',
    showTips: true,
      segmentColorScaleUsePsriMax: false,
      segmentColorScaleLowColor: '#40c057',
      segmentColorScaleMidColor: '#ffd43b',
      segmentColorScaleHighColor: '#fa5252',
      segmentActiveSearchOpacityPercent: 50,
    background: 'assets/us-night.jpg',
    activityLog: [],
    currentAssignments: {},
    teamStatuses: {},
    parChecks: {},
    teamLeaveTimes: {},
    teamAssignmentTimes: {},
    parCheckFrequency: 20,
    dismissedNotifications: [],
    arrivedTeams: [],
    forms: {},
    uploads: [],
    maps: [],
    accounts: [
      { firstName: 'Super', lastName: 'Admin', pin: '1976', color: 'none', handle: 'Super-Admin', isFileManager: true, theme: 'dark', visiblePages: ['index', 'page2', 'page3', 'page4', 'page5', 'page6', 'page7', 'settings', 'home', 'page8', 'page9', 'page10'] }
    ],
    profile: {
      incidentNumber: '',
      lostPersonName: '',
      lostPersonAge: '',
      lostPersonGender: '',
      lostPersonDescription: '',
      lostPersonClothing: '',
      lostPersonPhysical: ''
    },
    pages: {
      index: defaultRegionsData(),
      page2: defaultSegmentsData(),
      page3: defaultPersonnelData(),
      page4: defaultSearchLogData(),
      page5: defaultData(),
      page6: defaultData(),
      page7: defaultData()
    }
  };
}

function sanitizeStandardData(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return defaultData();
  return parsed.map(row =>
    Array.from({ length: COLS }, (_, c) => (row?.[c] ?? '').toString())
  );
}

function sanitizeRegionsData(parsed) {
  const fallback = defaultRegionsData();
  if (!parsed || typeof parsed !== 'object') return fallback;

  const headers = Array.isArray(parsed.headers) ? parsed.headers.slice() : fallback.headers.slice();
  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : fallback.rows;
  const rowCount = Math.max(1, rawRows.length);
  const dynamicCount = Math.max(1, headers.length - 2 || (typeof DEFAULT_DYNAMIC_COLS !== 'undefined' ? DEFAULT_DYNAMIC_COLS : 3));

  const safeHeaders = ['Region'];
  for (let i = 0; i < dynamicCount; i++) {
    safeHeaders.push((headers[i + 1] ?? `Voter ${i + 1}`).toString());
  }
  safeHeaders.push('Consensus');

  const safeRows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const sourceRow = Array.isArray(rawRows[rowIndex]) ? rawRows[rowIndex] : [];
    // Ensure row has enough columns (Region + dynamicCount + Consensus)
    return Array.from({ length: dynamicCount + 2 }, (_, colIndex) => (sourceRow[colIndex] ?? '').toString());
  });

  const voterVisibility = Array.isArray(parsed.voterVisibility) 
    ? parsed.voterVisibility.slice(0, dynamicCount) 
    : Array.from({ length: dynamicCount }, () => false);
  
  while (voterVisibility.length < dynamicCount) {
    voterVisibility.push(false);
  }

  return { headers: safeHeaders, rows: safeRows, voterVisibility };
}

function sanitizeSegmentsData(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return defaultSegmentsData();
  return parsed.map(row => {
    const sourceLen = row.length;
    const targetRow = Array.from({ length: 10 }, (_, c) => (row?.[c] ?? '').toString());
    if (sourceLen === 7) {
       // Old index 6 was PSR. Now it's PSRi and we initialize PSRc with it.
       targetRow[7] = targetRow[6];
    }
    return targetRow;
  });
}

function sanitizePersonnelData(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return defaultPersonnelData();
  return parsed.map(row => {
    // Ensure we have at least 14 columns to include incident times (9, 10, 11, 12) and JSON history (13)
    const r = Array.from({ length: Math.max(14, row?.length || 0) }, (_, c) => (row?.[c] ?? '').toString());
    return r;
  });
}

function sanitizeSearchLogData(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return defaultSearchLogData();
  return parsed.map(row =>
    Array.from({ length: 10 }, (_, c) => (row?.[c] ?? '').toString())
  );
}

function sanitizeBundle(bundle) {
  const fallback = defaultBundle();
  if (!bundle || typeof bundle !== 'object') return fallback;

  const fileName = typeof bundle.fileName === 'string' && bundle.fileName.trim()
    ? bundle.fileName.trim()
    : DEFAULT_FILE_NAME;

  const deleteMode = typeof bundle.deleteMode === 'boolean' ? bundle.deleteMode : false;
  const background = typeof bundle.background === 'string' && bundle.background.trim()
    ? bundle.background.trim()
    : 'assets/us-night.jpg';

  const activityLog = Array.isArray(bundle.activityLog) ? bundle.activityLog : [];
  const currentAssignments = (bundle.currentAssignments && typeof bundle.currentAssignments === 'object')
    ? bundle.currentAssignments
    : {};

  const teamStatuses = (bundle.teamStatuses && typeof bundle.teamStatuses === 'object')
    ? bundle.teamStatuses
    : {};

  const parChecks = (bundle.parChecks && typeof bundle.parChecks === 'object')
    ? bundle.parChecks
    : {};

  const teamLeaveTimes = (bundle.teamLeaveTimes && typeof bundle.teamLeaveTimes === 'object')
    ? bundle.teamLeaveTimes
    : {};

  const teamAssignmentTimes = (bundle.teamAssignmentTimes && typeof bundle.teamAssignmentTimes === 'object')
    ? bundle.teamAssignmentTimes
    : {};

  const arrivedTeams = Array.isArray(bundle.arrivedTeams) ? bundle.arrivedTeams : [];
  const dismissedNotifications = Array.isArray(bundle.dismissedNotifications) ? bundle.dismissedNotifications : [];

  const pages = {};
  for (const page of PAGE_DEFS) {
    const rawPage = bundle.pages?.[page.key];
    if (page.key === 'index') {
      pages[page.key] = sanitizeRegionsData(rawPage);
    } else if (page.key === 'page2') {
      pages[page.key] = sanitizeSegmentsData(rawPage);
    } else if (page.key === 'page3') {
      pages[page.key] = sanitizePersonnelData(rawPage);
    } else if (page.key === 'page4') {
      pages[page.key] = sanitizeSearchLogData(rawPage);
    } else {
      pages[page.key] = sanitizeStandardData(rawPage);
    }
  }

  // Ensure all teams in Personnel (page3) have a status of "at base" if not already set
  const personnelData = pages.page3 || [];
  personnelData.forEach(row => {
    const team = (row[1] || '').trim();
    const onScene = isActiveMemberStatus(row[6]);
    if (team && onScene && !teamStatuses[team]) {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        teamStatuses[team] = `at base (${timeStr})`;
    }
  });

  const parCheckFrequency = (bundle.parCheckFrequency !== undefined) ? bundle.parCheckFrequency : 20;
  const showTips = (bundle.showTips !== undefined) ? bundle.showTips : true;
  const theme = bundle.theme || 'dark';
  const lastModified = bundle.lastModified || new Date().toISOString();
  const forms = bundle.forms || {};
  const profile = bundle.profile || fallback.profile;
  const uploads = Array.isArray(bundle.uploads) ? bundle.uploads : [];
  const maps = Array.isArray(bundle.maps) ? bundle.maps : [];

  let accounts = Array.isArray(bundle.accounts) ? bundle.accounts : fallback.accounts;

  // 1. Ensure only one Super Admin exists
  const superAdmin = accounts.find(a => a.pin === '1976') || fallback.accounts[0];
  superAdmin.firstName = 'Super';
  superAdmin.lastName = 'Admin';
  superAdmin.handle = 'Super-Admin';
  superAdmin.pin = '1976';
  
  if (superAdmin.visiblePages && !superAdmin.visiblePages.includes('page10')) {
    superAdmin.visiblePages.push('page10');
  }

  // 2. Filter out any other accounts that might be pretending to be super admin
  accounts = accounts.filter(a => a.pin !== '1976');
  
  // 3. Sync with Personnel (page3)
  const personnel = pages.page3 || [];

  const syncedAccounts = [];
  syncedAccounts.push(superAdmin);

  // Helper to find next available PIN starting from 1400
  const getNextPin = (currentSynced) => {
    let next = 1400;
    while (currentSynced.some(a => a.pin === next.toString())) {
      next++;
    }
    return next.toString();
  };

  personnel.forEach(row => {
    const name = (row[0] || '').trim();
    if (!name) return;

    // Try to find by PIN link first (column 8)
    const rowPin = (row[8] || '').trim();
    let existing = null;
    
    if (rowPin) {
        existing = accounts.find(a => a.pin === rowPin);
    }

    // Fallback to name match
    if (!existing) {
        existing = accounts.find(a => a.handle === name || (a.firstName + ' ' + (a.lastName || '')).trim() === name);
    }

    if (existing) {
      // Update account name from Personnel list (Personnel is source of truth for name unless changed via User Account page which also updates Personnel)
      const parts = name.split(' ');
      existing.firstName = parts[0];
      existing.lastName = parts.slice(1).join(' ');
      existing.handle = name;
      
      // Ensure PIN link is established in Personnel list
      row[8] = existing.pin;
      
      syncedAccounts.push(existing);
      // Remove from accounts to avoid double-processing
      accounts = accounts.filter(a => a !== existing);
    } else {
      // Create new account
      const newPin = rowPin || getNextPin(syncedAccounts);
      const parts = name.split(' ');
      const newAcc = {
        firstName: parts[0],
        lastName: parts.slice(1).join(' '),
        pin: newPin,
        color: 'none',
        handle: name,
        isFileManager: false,
        theme: 'dark',
        visiblePages: ['index', 'page2', 'page3', 'page4', 'page5', 'page6', 'page7', 'settings', 'home', 'page8', 'page10']
      };
      syncedAccounts.push(newAcc);
      row[8] = newPin; // Establish link
    }
  });

  // Also keep any other accounts that are Admins or were not matched (to prevent accidental loss)
  // This prevents accidental loss of the currently logged-in user or admins not yet in Personnel list
  const currentU = getCurrentUser();
  accounts.forEach(a => {
      const isAlreadySynced = syncedAccounts.some(sa => sa.pin === a.pin);
      const isCurrUser = currentU && a.pin === currentU.pin;
      const isAdmin = isUserAdmin(a) || a.isFileManager;

      if (!isAlreadySynced && (isAdmin || isCurrUser)) {
          syncedAccounts.push(a);
      }
  });

  return { 
    fileName, 
    lastModified,
    deleteMode, 
    theme, 
    background, 
    activityLog, 
    currentAssignments, 
    teamStatuses, 
    parChecks, 
    teamLeaveTimes, 
    teamAssignmentTimes, 
    arrivedTeams, 
    dismissedNotifications,
    parCheckFrequency, 
    showTips, 
    pages, 
    forms, 
    profile, 
    uploads, 
    maps,
    accounts: syncedAccounts 
  };
}

function loadBundle() {
  try {
    const raw = localStorage.getItem(BUNDLE_STORAGE_KEY);
    if (!raw) return defaultBundle();
    return sanitizeBundle(JSON.parse(raw));
  } catch {
    return defaultBundle();
  }
}

function saveBundle(bundle, skipSync = false) {
  bundle.lastModified = new Date().toISOString();
  const sanitized = sanitizeBundle(bundle);

  localStorage.setItem(BUNDLE_STORAGE_KEY, JSON.stringify(sanitized));
  
  if (!skipSync) {
      pushBundleToServer(sanitized);
      // Ensure the current file is always in the saved files list
      saveFileToList(sanitized.fileName, sanitized);
  }
  
  updateFileNameDisplay();
}

function getSavedFiles() {
    const raw = localStorage.getItem(FILE_LIST_STORAGE_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function saveFileToList(fileName, bundle) {
    const files = getSavedFiles();
    if (!files[fileName]) {
        logCreation('File', fileName, bundle);
    }
    files[fileName] = {
        bundle: sanitizeBundle(bundle),
        lastModified: new Date().toISOString()
    };
    localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(files));
    // No longer push to server immediately to prevent race conditions during sync.
    // Background sync loop will handle pushing merged updates.
}

function deleteFileFromList(fileName) {
    const files = getSavedFiles();
    logDeletion('File', fileName);
    delete files[fileName];
    localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(files));
    // No longer push to server immediately to prevent race conditions during sync.
}

function confirmDeleteRow(rowElement, onConfirm) {
  const bundle = loadBundle();
  if (bundle.deleteMode) {
    onConfirm();
    return;
  }

  rowElement.classList.add('delete-highlight');
  
  const onCancel = () => {
    rowElement.classList.remove('delete-highlight');
  };

  const overlay = createPopup("Are you sure you want to delete this row?", rowElement, onCancel);
  const content = overlay.querySelector('.popup-content');
  const btnContainer = overlay.querySelector('.popup-buttons');
  
  // Apply slide-in animation
  content.classList.remove('expanding');
  content.classList.add('slide-in-top');

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'popup-btn primary';
  deleteBtn.style.background = '#ff4444';
  deleteBtn.style.borderColor = '#ff4444';
  deleteBtn.textContent = 'Delete';
  deleteBtn.onclick = () => {
    overlay.classList.add('fade-out-slow');
    setTimeout(() => {
      onConfirm();
      overlay.remove();
    }, 1000);
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'popup-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    onCancel();
    closePopup(overlay);
  };

  btnContainer.appendChild(deleteBtn);
  btnContainer.appendChild(cancelBtn);
}

const PERMANENT_PERSONNEL_KEY = 'permanent_personnel_global';

function getPermanentPersonnel() {
  const stored = localStorage.getItem(PERMANENT_PERSONNEL_KEY);
  return stored ? JSON.parse(stored) : {};
}

function setPermanentPersonnel(data) {
  localStorage.setItem(PERMANENT_PERSONNEL_KEY, JSON.stringify(data));
}

function syncPersonnelData(fileData) {
  const global = getPermanentPersonnel();
  const merged = [];
  const processedNames = new Set();

  // 1. Process data from the file
  fileData.forEach(row => {
    const name = row[0];
    if (!name) {
      merged.push([...row]);
      return;
    }
    processedNames.add(name);
    
    if (global[name]) {
      const mergedRow = [...row];
      // Ensure it has enough columns if it came from an older file
      while (mergedRow.length < 14) mergedRow.push('');
      
      mergedRow[3] = global[name].gps || row[3] || '';
      mergedRow[4] = global[name].radio || row[4] || '';
      mergedRow[5] = global[name].medic || row[5] || '';
      merged.push(mergedRow);
    } else {
      global[name] = {
        gps: row[3] || '',
        radio: row[4] || '',
        medic: row[5] || ''
      };
      const mergedRow = [...row];
      while (mergedRow.length < 14) mergedRow.push('');
      merged.push(mergedRow);
    }
  });

  // 2. Add members from global that were NOT in the file
  for (const name in global) {
    if (!processedNames.has(name)) {
      const newRow = Array.from({ length: 14 }, () => '');
      newRow[0] = name;
      newRow[3] = global[name].gps || '';
      newRow[4] = global[name].radio || '';
      newRow[5] = global[name].medic || '';
      newRow[6] = 'false';
      merged.push(newRow);
    }
  }

  setPermanentPersonnel(global);
  return merged;
}

function splitPersonnelData(mergedData) {
  const global = getPermanentPersonnel();
  const filePart = [];

  mergedData.forEach(row => {
    const name = row[0];
    if (!name) {
      filePart.push([...row]);
      return;
    }

    global[name] = {
      gps: row[3] || '',
      radio: row[4] || '',
      medic: row[5] || ''
    };

    const rowForFile = [...row];
    rowForFile[3] = ''; // GPS is stored globally
    rowForFile[4] = ''; // Radio is stored globally
    rowForFile[5] = ''; // Medic is stored globally
    filePart.push(rowForFile);
  });

  setPermanentPersonnel(global);
  return filePart;
}

function loadData() {
  const bundle = loadBundle();
  const key = pageKey();
  if (bundle.pages[key]) {
    if (key === 'page3') return syncPersonnelData(bundle.pages[key]);
    return bundle.pages[key];
  }
  if (isRegionsPage()) return defaultRegionsData();
  if (isSegmentsPage()) return defaultSegmentsData();
  if (isPersonnelPage()) return syncPersonnelData(defaultPersonnelData());
  if (isSearchLogPage()) return defaultSearchLogData();
  return defaultData();
}

function saveCurrentPageData(data) {
  const bundle = loadBundle();
  const key = pageKey();
  if (key === 'page3') {
    bundle.pages[key] = splitPersonnelData(data);
  } else {
    bundle.pages[key] = data;
  }
  saveBundle(bundle);
  const status = document.getElementById('save-status');
  if (status) {
    const now = new Date();
    status.textContent = `Saved automatically at ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
}

function updateFileNameDisplay() {
  const brandEl = document.querySelector('.brand');
  if (brandEl) brandEl.textContent = BRAND_NAME;

  const bundle = loadBundle();
  document.querySelectorAll('[data-file-name]').forEach((el) => {
    el.textContent = bundle.fileName;
  });
}

function downloadTextFile(filename, content, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function placeCaretAtEnd(el) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function focusSelector(selector) {
  const next = document.querySelector(selector);
  if (!next) return;
  next.focus();
  placeCaretAtEnd(next);
}

function focusCell(row, col) {
  focusSelector(`.pill-cell[data-row="${row}"][data-col="${col}"]`);
}


let highlightedRowIndex = -1;

function animateNewRow(tr, index) {
  if (index === highlightedRowIndex) {
    tr.classList.add('new-row-highlight');
    // We don't need to remove it here as it's an animation that finishes on its own
    // But we should reset the index for the next table build
    setTimeout(() => {
      highlightedRowIndex = -1;
    }, 100);
  }
}

function animateArrivedRow(tr, teamName) {
  const bundle = loadBundle();
  if (bundle.arrivedTeams && bundle.arrivedTeams.includes(teamName)) {
    tr.classList.add('new-row-highlight');
    // Remove from arrivedTeams after highlighting
    bundle.arrivedTeams = bundle.arrivedTeams.filter(t => t !== teamName);
    saveBundle(bundle);
  }
}

function buildStandardTable() {
  const tableBody = document.getElementById('table-body');
  const clearBtn = document.getElementById('clear-table');
  const data = loadData();

  if (!tableBody) return;
  tableBody.innerHTML = '';

  for (let r = 0; r < data.length; r++) {
    const tr = document.createElement('tr');
    animateNewRow(tr, r);

    for (let c = 0; c < COLS; c++) {
      const td = document.createElement('td');
      td.dataset.label = `Column ${c + 1}`;
      const cellContainer = document.createElement('div');
      cellContainer.className = 'pill-cell-container';

      const cell = document.createElement('div');
      cell.className = 'pill-cell';
      cell.contentEditable = 'true';
      cell.spellcheck = false;
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.textContent = data[r]?.[c] ?? '';
      cell.setAttribute('role', 'textbox');
      cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}`);

      cell.addEventListener('blur', () => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        data[row][col] = cell.textContent.trim();
        saveCurrentPageData(data);
      });

      cell.addEventListener('keydown', (event) => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);

        if (event.key === 'Enter') {
          event.preventDefault();
          cell.blur();
          focusCell(Math.min(row + 1, data.length - 1), col);
          return;
        }

        if (event.key === 'Tab') {
          event.preventDefault();
          cell.blur();
          const nextCol = event.shiftKey ? Math.max(col - 1, 0) : Math.min(col + 1, COLS - 1);
          focusCell(row, nextCol);
        }
      });

      cellContainer.appendChild(cell);
      td.appendChild(cellContainer);
      tr.appendChild(td);
    }

    // New Delete Column
    const deleteTd = document.createElement('td');
    deleteTd.dataset.label = 'Delete';
    const deleteContainer = document.createElement('div');
    const delBtn = document.createElement('button');
    delBtn.className = 'row-delete-btn';
    delBtn.textContent = 'Delete';
    delBtn.type = 'button';
    delBtn.onclick = () => {
      confirmDeleteRow(tr, () => {
        const rowContent = (data[r] || []).filter(Boolean).join(', ') || 'empty row';
        data.splice(r, 1);
        logDeletion('row', rowContent);
        if (data.length === 0) data.push(Array.from({ length: COLS }, () => ''));
        saveCurrentPageData(data);
        buildStandardTable();
      });
    };
    deleteContainer.appendChild(delBtn);
    deleteTd.appendChild(deleteContainer);
    tr.appendChild(deleteTd);

    tableBody.appendChild(tr);
  }

  // Add Row button
  const addRowContainer = document.createElement('div');
  addRowContainer.className = 'add-row-container';
  const addRowBtn = document.createElement('button');
  addRowBtn.className = 'add-row-btn';
  addRowBtn.textContent = '+ Add new row';
  addRowBtn.onclick = () => {
    data.push(Array.from({ length: COLS }, () => ''));
    logCreation('row', 'new empty row');
    saveCurrentPageData(data);
    highlightedRowIndex = data.length - 1;
    buildStandardTable();
    focusCell(data.length - 1, 0);
  };
  addRowContainer.appendChild(addRowBtn);

  const existing = document.querySelector('.add-row-container');
  if (existing) existing.remove();
  tableBody.parentElement.after(addRowContainer);

  if (clearBtn) {
    clearBtn.remove();
  }
}

function parseVote(value) {
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

function parseNumeric(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  // Remove commas and handle units like "ac", "mi", "ft", "hr"
  // parseFloat handles trailing text, but not commas in the middle
  const cleaned = String(val).replace(/,/g, '');
  const num = parseFloat(cleaned);
  return isFinite(num) ? num : 0;
}

function formatUnit(val, unit) {
  if (!val) return '';
  const cleaned = String(val).replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return val;
  return `${num} ${unit}`;
}

function computeConsensus(data, rowIndex) {
  const dynamicCount = data.headers.length - 2;
  if (dynamicCount <= 0) return '';

  let totalNormalized = 0;
  let usedColumns = 0;

  for (let voteCol = 0; voteCol < dynamicCount; voteCol++) {
    let columnSum = 0;
    for (let r = 0; r < data.rows.length; r++) {
      const value = parseVote(data.rows[r][voteCol + 1]);
      if (value !== null) columnSum += value;
    }

    const rowValue = parseVote(data.rows[rowIndex][voteCol + 1]);
    if (rowValue === null || columnSum === 0) continue;

    totalNormalized += rowValue / columnSum;
    usedColumns += 1;
  }

  if (!usedColumns) return '';
  return (totalNormalized / usedColumns).toFixed(4);
}

function updateConsensusCells(data) {
  // Update data in memory first for all rows
  for (let r = 0; r < data.rows.length; r++) {
    data.rows[r][data.headers.length - 1] = computeConsensus(data, r);
  }
  // Then update DOM if present
  document.querySelectorAll('.consensus-cell').forEach((cell) => {
    const row = Number(cell.dataset.row);
    if (data.rows[row]) {
      cell.textContent = data.rows[row][data.headers.length - 1];
    }
  });
}

function saveRegionsAndRefresh(data) {
  updateConsensusCells(data);
  saveCurrentPageData(data);
  recalculateEverything();
}

function recalculateEverything() {
  const bundle = loadBundle();
  const segmentsData = bundle.pages.page2 || [];
  const searchLogData = bundle.pages.page4 || [];
  const regionsData = bundle.pages.index;

  // 1. Recalculate Regions Consensus
  updateConsensusCells(regionsData);

  // Helper for share calculation
  const getInitialShare = (region, area) => {
    const regionRowIndex = (regionsData.rows || []).findIndex(r => r[0] === region);
    if (regionRowIndex === -1) return 0;
    const consensus = parseFloat(computeConsensus(regionsData, regionRowIndex)) || 0;
    
    let sumOfAreas = 0;
    segmentsData.forEach(r => {
      if (r[0] === region) {
        sumOfAreas += parseNumeric(r[2]);
      }
    });
    if (sumOfAreas <= 0) return 0;
    return (consensus * area / sumOfAreas);
  };

  const segInfoMap = new Map();

  // 2. Recalculate Segments PSRi and Initialize Shares
  for (let r = 0; r < segmentsData.length; r++) {
    if (segmentsData[r][0] && segmentsData[r][1]) {
       const length = parseNumeric(segmentsData[r][3]);
       const manualTime = parseNumeric(segmentsData[r][8]);
       if (manualTime > 0) {
          segmentsData[r][5] = segmentsData[r][8];
       } else if (length > 0) {
          segmentsData[r][5] = (length / 0.5).toFixed(2) + ' hr';
       } else {
          segmentsData[r][5] = '';
       }
       segmentsData[r][6] = calculatePSR(segmentsData, r, bundle);
       
       const share = getInitialShare(segmentsData[r][0], parseNumeric(segmentsData[r][2]));
       segInfoMap.set(`${segmentsData[r][0]}|${segmentsData[r][1]}`, { share });
    }
  }

  // 3. Recalculate Search Log row by row, smallest task # first
  const sortedSearchLog = [...searchLogData].filter(row => row[0]).sort((a, b) => {
    const taskA = parseInt(a[0].replace('#', '')) || 0;
    const taskB = parseInt(b[0].replace('#', '')) || 0;
    return taskA - taskB;
  });

  sortedSearchLog.forEach(logRow => {
    const region = logRow[3];
    const segment = logRow[4];
    const key = `${region}|${segment}`;
    const info = segInfoMap.get(key);
    
    const segRow = segmentsData.find(s => s[0] === region && s[1] === segment);
    if (info && segRow) {
      const area = parseNumeric(segRow[2]);
      const length = parseNumeric(segRow[3]);
      const timePerSweep = parseNumeric(segRow[5]);
      const sweepWidth = parseNumeric(logRow[8]);
      const numSweeps = parseNumeric(logRow[9]);
      const teamInfo = logRow[7] || '';
      const match = teamInfo.match(/\((\d+)\)/);
      const numMembers = match ? parseInt(match[1]) : 0;

      // PSR Before using search sweep
      const psrBefore = (length / timePerSweep * sweepWidth * info.share) / (area / 640);
      logRow[5] = isFinite(psrBefore) ? psrBefore.toFixed(4) : '';

      if (sweepWidth > 0 && numSweeps > 0 && numMembers > 0 && area > 0 && length > 0) {
        const z = sweepWidth / ((area / 640 / length / numSweeps / numMembers) * 5280);
        info.share *= Math.exp(-z);
      }

      // PSR After using search sweep
      const psrAfter = (length / timePerSweep * sweepWidth * info.share) / (area / 640);
      logRow[6] = isFinite(psrAfter) ? psrAfter.toFixed(4) : '';
    }
  });

  // 4. Update segment's PSRc with final share using segment's default sweep
  for (let r = 0; r < segmentsData.length; r++) {
    const region = segmentsData[r][0];
    const segment = segmentsData[r][1];
    const info = segInfoMap.get(`${region}|${segment}`);
    if (info) {
      const length = parseNumeric(segmentsData[r][3]);
      const timePerSweep = parseNumeric(segmentsData[r][5]);
      const sweep = parseNumeric(segmentsData[r][4]);
      const area = parseNumeric(segmentsData[r][2]);
      
      const psrc = (length / timePerSweep * sweep * info.share) / (area / 640);
      segmentsData[r][7] = isFinite(psrc) ? psrc.toFixed(4) : '';
    }
  }

  // Map back to original searchLogData
  searchLogData.forEach(row => {
     const sortedRow = sortedSearchLog.find(sr => sr[0] === row[0]);
     if (sortedRow) {
       row[5] = sortedRow[5];
       row[6] = sortedRow[6];
     }
  });

  saveBundle(bundle);
}

function buildRegionsTable() {
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  const tableContainer = document.querySelector('.table-card');
  const clearBtn = document.getElementById('clear-table');
  const addBtn = document.getElementById('add-column');
  const data = loadData();
  const dynamicCount = data.headers.length - 2;

  if (tableContainer) {
    if (data.headers.length > 5) {
      tableContainer.classList.add('force-mobile-layout');
    } else {
      tableContainer.classList.remove('force-mobile-layout');
    }
    // Also remove horizontal overflow from table-card when in card layout
    if (data.headers.length > 5) {
      tableContainer.style.overflowX = 'hidden';
    } else {
      tableContainer.style.overflowX = '';
    }
  }

  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  const headerRow = document.createElement('tr');
  for (let c = 0; c < data.headers.length; c++) {
    const th = document.createElement('th');
    const isFixed = c === 0 || c === data.headers.length - 1;

    if (isFixed) {
      if (c === data.headers.length - 1) {
        // Consensus column
        const headerContainer = document.createElement('div');
        headerContainer.className = 'pill-cell-container';

        const plusBtn = document.createElement('button');
        plusBtn.className = 'add-col-btn-inline';
        plusBtn.textContent = '+';
        plusBtn.title = 'Add Voter Column';
        plusBtn.onclick = (e) => {
          e.stopPropagation();
          const insertAt = data.headers.length - 1;
          const newHeaderName = `Voter ${data.headers.length - 1}`;
          data.headers.splice(insertAt, 0, newHeaderName);
          data.rows.forEach(row => row.splice(insertAt, 0, ''));
          if (data.voterVisibility) {
            data.voterVisibility.splice(insertAt - 1, 0, true);
          }
          logCreation('Voter Column', newHeaderName);
          saveCurrentPageData(data);
          buildRegionsTable();
        };

        const consensusLabel = document.createElement('span');
        consensusLabel.textContent = data.headers[c];

        headerContainer.appendChild(plusBtn);
        headerContainer.appendChild(consensusLabel);
        th.appendChild(headerContainer);
      } else {
        th.textContent = data.headers[c];
      }
      th.className = 'fixed-header';
    } else {
      const headerContainer = document.createElement('div');
      headerContainer.className = 'pill-cell-container';

      const headerPill = document.createElement('div');
      headerPill.className = 'pill-cell header-pill';
      headerPill.contentEditable = 'true';
      headerPill.spellcheck = false;
      headerPill.dataset.headerCol = String(c);
      headerPill.textContent = data.headers[c];
      headerPill.setAttribute('role', 'textbox');
      headerPill.setAttribute('aria-label', `Voter header ${c}`);

      headerPill.addEventListener('blur', () => {
        data.headers[c] = headerPill.textContent.trim() || `Voter ${c}`;
        saveRegionsAndRefresh(data);
      });

      headerPill.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          headerPill.blur();
          focusSelector(`.pill-cell[data-row="0"][data-col="${c}"]`);
          return;
        }

        if (event.key === 'Tab') {
          event.preventDefault();
          headerPill.blur();
          const targetCol = event.shiftKey ? Math.max(c - 1, 1) : Math.min(c + 1, data.headers.length - 2);
          focusSelector(`.header-pill[data-header-col="${targetCol}"]`);
        }
      });

      const toggleContainer = document.createElement('label');
      toggleContainer.className = 'toggle-switch header-toggle';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = data.voterVisibility[c - 1] ?? true;
      checkbox.addEventListener('change', () => {
        data.voterVisibility[c - 1] = checkbox.checked;
        saveCurrentPageData(data);
        buildRegionsTable();
      });

      const slider = document.createElement('span');
      slider.className = 'slider round';

      toggleContainer.appendChild(checkbox);
      toggleContainer.appendChild(slider);

      const delBtn = document.createElement('button');
      delBtn.className = 'col-delete-btn';
      delBtn.innerHTML = '✕';
      delBtn.title = 'Delete Voter Column';
      delBtn.onclick = () => {
        if (data.headers.length <= 3) return; // Keep at least one voter
        data.headers.splice(c, 1);
        data.rows.forEach(row => row.splice(c, 1));
        if (data.voterVisibility) {
          data.voterVisibility.splice(c - 1, 1);
        }
        saveCurrentPageData(data);
        buildRegionsTable();
      };

      headerContainer.appendChild(headerPill);
      headerContainer.appendChild(toggleContainer);
      headerContainer.appendChild(delBtn);
      th.appendChild(headerContainer);
    }

    headerRow.appendChild(th);
  }

  // Delete Header
  const deleteTh = document.createElement('th');
  deleteTh.textContent = 'Delete';
  deleteTh.className = 'fixed-header no-print';
  headerRow.appendChild(deleteTh);

  tableHead.appendChild(headerRow);

  for (let r = 0; r < data.rows.length; r++) {
    const tr = document.createElement('tr');
    animateNewRow(tr, r);

    for (let c = 0; c < data.headers.length; c++) {
      const td = document.createElement('td');
      td.dataset.label = data.headers[c];
      td.className = 'regions-td';

      if (c === data.headers.length - 1) {
        const consensus = document.createElement('div');
        consensus.className = 'pill-cell consensus-cell readonly-pill';
        consensus.dataset.row = String(r);
        consensus.textContent = computeConsensus(data, r);
        td.appendChild(consensus);
        tr.appendChild(td);
        continue;
      }

      const cellContainer = document.createElement('div');
      cellContainer.className = 'pill-cell-container';

      const cell = document.createElement('div');
      cell.className = 'pill-cell';
      const isVoterCol = c > 0 && c < data.headers.length - 1;
      if (isVoterCol && !data.voterVisibility[c - 1]) {
        cell.classList.add('password-style');
      }
      cell.contentEditable = 'true';
      cell.spellcheck = false;
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.textContent = data.rows[r]?.[c] ?? '';
      cell.setAttribute('role', 'textbox');
      cell.setAttribute('aria-label', `Row ${r + 1}, ${data.headers[c]}`);

      cell.addEventListener('blur', () => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        data.rows[row][col] = cell.textContent.trim();
        saveRegionsAndRefresh(data);
      });

      cell.addEventListener('keydown', (event) => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);

        if (event.key === 'Enter') {
          event.preventDefault();
          cell.blur();
          focusCell(Math.min(row + 1, data.rows.length - 1), col);
          return;
        }

        if (event.key === 'Tab') {
          event.preventDefault();
          cell.blur();
          const maxEditableCol = data.headers.length - 2;
          const nextCol = event.shiftKey ? Math.max(col - 1, 0) : Math.min(col + 1, maxEditableCol);
          focusCell(row, nextCol);
        }
      });

      cellContainer.appendChild(cell);
      td.appendChild(cellContainer);
      tr.appendChild(td);
    }

    // New Delete Column
    const deleteTd = document.createElement('td');
    deleteTd.dataset.label = 'Delete';
    deleteTd.className = 'regions-td no-print';
    const deleteContainer = document.createElement('div');
    deleteContainer.className = 'pill-cell-container';
    const delBtn = document.createElement('button');
    delBtn.className = 'row-delete-btn';
    delBtn.textContent = 'Delete';
    delBtn.type = 'button';
    delBtn.onclick = () => {
      confirmDeleteRow(tr, () => {
        const regionName = (data.rows[r] && data.rows[r][0]) || 'unnamed region';
        data.rows.splice(r, 1);
        logDeletion('Region', regionName);
        if (data.rows.length === 0) {
          data.rows.push(Array.from({ length: data.headers.length }, () => ''));
        }
        saveCurrentPageData(data);
        buildRegionsTable();
      });
    };
    deleteContainer.appendChild(delBtn);
    deleteTd.appendChild(deleteContainer);
    tr.appendChild(deleteTd);

    tableBody.appendChild(tr);
  }

  // Add Row button
  const addRowContainer = document.createElement('div');
  addRowContainer.className = 'add-row-container';
  const addRowBtn = document.createElement('button');
  addRowBtn.className = 'add-row-btn';
  addRowBtn.textContent = '+ Add new row';
  addRowBtn.onclick = () => {
    data.rows.push(Array.from({ length: data.headers.length }, () => ''));
    logCreation('Region', 'new empty region');
    saveRegionsAndRefresh(data);
    highlightedRowIndex = data.rows.length - 1;
    buildRegionsTable();
    focusCell(data.rows.length - 1, 0);
  };
  addRowContainer.appendChild(addRowBtn);

  const existing = document.querySelector('.add-row-container');
  if (existing) existing.remove();
  tableBody.parentElement.after(addRowContainer);

  updateConsensusCells(data);
  saveCurrentPageData(data);

  addBtn.onclick = () => {
    const insertAt = data.headers.length - 1;
    const newHeaderName = `Voter ${dynamicCount + 1}`;
    data.headers.splice(insertAt, 0, newHeaderName);
    data.rows.forEach((row) => row.splice(insertAt, 0, ''));
    if (data.voterVisibility) {
      data.voterVisibility.push(false);
    } else {
      data.voterVisibility = Array.from({ length: data.headers.length - 2 }, () => false);
    }
    logCreation('Voter Column', newHeaderName);
    saveCurrentPageData(data);
    buildRegionsTable();
  };

  const removeBtn = document.getElementById('remove-voter-columns');
  const removeModal = document.getElementById('remove-voter-columns-modal');
  const closeRemoveModal = document.getElementById('close-remove-modal');
  const confirmRemoveBtn = document.getElementById('confirm-remove-columns');
  const voterListContainer = document.getElementById('voter-columns-list');

  if (removeBtn) {
    removeBtn.onclick = () => {
      voterListContainer.innerHTML = '';
      for (let c = 1; c < data.headers.length - 1; c++) {
        const item = document.createElement('div');
        item.className = 'voter-remove-item';
        
        const label = document.createElement('span');
        label.textContent = data.headers[c];
        
        const toggleContainer = document.createElement('label');
        toggleContainer.className = 'toggle-switch';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.colIndex = String(c);
        
        const slider = document.createElement('span');
        slider.className = 'slider round';
        
        toggleContainer.appendChild(checkbox);
        toggleContainer.appendChild(slider);
        
        item.appendChild(label);
        item.appendChild(toggleContainer);
        
        item.onclick = (e) => {
          if (e.target !== checkbox && !toggleContainer.contains(e.target)) {
            checkbox.checked = !checkbox.checked;
          }
        };
        
        voterListContainer.appendChild(item);
      }
      removeModal.style.display = 'flex';
    };
  }

  if (closeRemoveModal) {
    closeRemoveModal.onclick = () => {
      removeModal.style.display = 'none';
    };
  }

  if (confirmRemoveBtn) {
    confirmRemoveBtn.onclick = () => {
      const selectedCheckboxes = voterListContainer.querySelectorAll('input[type="checkbox"]:checked');
      if (selectedCheckboxes.length === 0) {
        removeModal.style.display = 'none';
        return;
      }

      const indicesToDelete = Array.from(selectedCheckboxes)
        .map(cb => parseInt(cb.dataset.colIndex))
        .sort((a, b) => b - a);

      indicesToDelete.forEach(idx => {
        data.headers.splice(idx, 1);
        data.rows.forEach(row => row.splice(idx, 1));
        if (data.voterVisibility) {
          data.voterVisibility.splice(idx - 1, 1);
        }
      });

      logDeletion('Voter Columns', `${selectedCheckboxes.length} columns`);
      saveCurrentPageData(data);
      buildRegionsTable();
      removeModal.style.display = 'none';
    };
  }

  if (clearBtn) {
    clearBtn.remove();
  }
}

function calculatePSR(data, rowIndex, bundle) {
  const row = data[rowIndex];
  const regionName = row[0];
  const area = parseNumeric(row[2]);
  const length = parseNumeric(row[3]);
  const sweep = parseNumeric(row[4]);
  
  // Calculate Time per Sweep as Length / 0.5 if no manual override
  const manualTime = parseNumeric(row[8]);
  const timePerSweep = manualTime > 0 ? manualTime : (length / 0.5);

  if (!regionName || area <= 0 || length <= 0 || sweep <= 0 || timePerSweep <= 0) return '';

  const regionsData = bundle.pages.index;
  const regionRowIndex = (regionsData.rows || []).findIndex(r => r[0] === regionName);
  if (regionRowIndex === -1) return '';

  const consensus = parseFloat(computeConsensus(regionsData, regionRowIndex)) || 0;
  if (consensus <= 0) return '';

  // Sum of Areas for all segments in this region
  let sumOfAreas = 0;
  data.forEach(r => {
    if (r[0] === regionName) {
      sumOfAreas += parseNumeric(r[2]);
    }
  });

  if (sumOfAreas <= 0) return '';

  // Formula: PSR = ((Sweep * Length ) / Time) * (Consensus * (Area / Sum of Areas)) / (Area / 640)
  const psr = ((sweep * length ) / timePerSweep) * (consensus * (area / sumOfAreas)) / (area / 640);

  return isFinite(psr) ? psr.toFixed(4) : '';
}

// updateAllPSRs removed, logic moved to recalculateEverything

function buildSegmentsTable() {
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  const clearBtn = document.getElementById('clear-table');
  const sortToggle = document.getElementById('sort-toggle');
  const sortLabel = document.getElementById('sort-label');
  
  recalculateEverything();
  let data = loadData();
  const bundle = loadBundle();

  const isPSRDescending = sortToggle && sortToggle.checked;
  if (sortLabel) {
    sortLabel.textContent = isPSRDescending ? 'Sorted by PSRc (Descending)' : 'Sorted by Region then Segment';
  }

  const sortedData = [...data].sort((a, b) => {
    if (isPSRDescending) {
      const psrA = parseFloat(a[7]) || 0;
      const psrB = parseFloat(b[7]) || 0;
      return psrB - psrA;
    } else {
      // Region then Segment
      const regionA = (a[0] || '').toLowerCase();
      const regionB = (b[0] || '').toLowerCase();
      if (regionA < regionB) return -1;
      if (regionA > regionB) return 1;

      // Same region, check segment (index 1)
      const segA = parseNumeric(a[1]);
      const segB = parseNumeric(b[1]);
      return segA - segB;
    }
  });

  const activeSegments = new Set();
  if (bundle.currentAssignments && bundle.teamStatuses) {
    for (const team in bundle.currentAssignments) {
      const status = bundle.teamStatuses[team] || '';
      const assignment = bundle.currentAssignments[team] || '';
      if (!status.includes('at base') && assignment !== 'Base' && assignment !== 'None' && assignment !== '') {
        const match = assignment.match(/#\d+ (.+) - (.+)/);
        if (match) {
          activeSegments.add(`${match[1]}|${match[2]}`);
        }
      }
    }
  }

  const logSweepsDue = getLogSweepsDue();
  const dueSegments = new Set(logSweepsDue.map(d => `${d.region}|${d.segment}`));

  const regionsData = bundle.pages.index;
  const regionNames = (regionsData.rows || []).map(r => r[0]).filter(name => name && name.trim() !== '');

  const actionsContainer = document.getElementById('segment-header-actions');
  if (actionsContainer) {
      actionsContainer.innerHTML = '';
      const importBtn = document.createElement('button');
      importBtn.className = 'clear-btn';
      importBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; vertical-align: middle;"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/></svg>Import JSON';
      importBtn.onclick = showImportSegmentsPopup;
      actionsContainer.appendChild(importBtn);
  }

  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  const headers = ['Region', 'Segment', 'Area (acres)', 'Length (mi)', 'Sweep (ft)', 'Time per Sweep (hr)', 'PSRi', 'PSRc', 'CalTopo', 'Delete'];
  const headerRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.className = 'fixed-header';
    headerRow.appendChild(th);
  });
  tableHead.appendChild(headerRow);

  for (let r = 0; r < sortedData.length; r++) {
    const tr = document.createElement('tr');
    animateNewRow(tr, r);
    const segKey = `${sortedData[r][0]}|${sortedData[r][1]}`;
    if (activeSegments.has(segKey)) {
      tr.classList.add('unfinished-row');
    } else if (dueSegments.has(segKey)) {
      tr.classList.add('log-sweeps-due');
    }

    if (newlyImportedSegments.has(segKey)) {
      tr.classList.add('new-import-row');
    }

    const headers = ['Region', 'Segment', 'Area (acres)', 'Length (mi)', 'Sweep (ft)', 'Time per Sweep (hr)', 'PSRi', 'PSRc', 'CalTopo', 'Delete'];
    for (let c = 0; c < 8; c++) {
      const td = document.createElement('td');
      td.dataset.label = headers[c];
      const cellContainer = document.createElement('div');
      cellContainer.className = 'pill-cell-container';

      if (c === 0) {
        // Region Dropdown
        const select = document.createElement('select');
        select.className = 'pill-cell segment-select';
        if (newlyImportedSegments.has(segKey)) select.classList.add('new-import-highlight');
        select.dataset.row = String(r);
        select.dataset.col = String(c);
        select.style.width = '100%';

        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- Select --';
        select.appendChild(emptyOpt);

        regionNames.forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          if (sortedData[r][c] === name) opt.selected = true;
          select.appendChild(opt);
        });

        select.onchange = () => {
          const originalRow = sortedData[r];
          originalRow[c] = select.value;
          saveCurrentPageData(data);
          buildSegmentsTable();
        };

        select.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            focusCell(Math.min(r + 1, sortedData.length - 1), c);
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            const nextCol = event.shiftKey ? Math.max(c - 1, 0) : Math.min(c + 1, 7);
            focusCell(r, nextCol);
          }
        });

        cellContainer.appendChild(select);
      } else if (c === 5) {
        // Time per Sweep (hr) with manual override logic
        if (sortedData[r][8]) {
          const resetBtn = document.createElement('button');
          resetBtn.className = 'reset-pill-btn';
          resetBtn.textContent = '↺';
          resetBtn.title = 'Reset to calculated value';
          resetBtn.onclick = (e) => {
             e.stopPropagation();
             const originalRowIndex = data.indexOf(sortedData[r]);
             data[originalRowIndex][8] = '';
             saveCurrentPageData(data);
             buildSegmentsTable();
          };
          cellContainer.appendChild(resetBtn);
        }

        const cell = document.createElement('div');
        cell.className = 'pill-cell';
        if (newlyImportedSegments.has(segKey)) cell.classList.add('new-import-highlight');
        cell.contentEditable = 'true';
        cell.spellcheck = false;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.textContent = sortedData[r][c] || '';

        cell.addEventListener('blur', () => {
          let val = cell.textContent.trim();
          const originalRowIndex = data.indexOf(sortedData[r]);
          if (val) {
            val = formatUnit(val, 'hr');
            // Check if it's different from the calculated value (length / 0.5)
            const length = parseNumeric(sortedData[r][3]);
            const calc = (length / 0.5).toFixed(2) + ' hr';
            if (val !== calc) {
              data[originalRowIndex][8] = val; // Store manual override
            } else {
              data[originalRowIndex][8] = ''; // Clear override
            }
          } else {
            data[originalRowIndex][8] = '';
          }
          saveCurrentPageData(data);
          buildSegmentsTable();
        });

        cell.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            focusCell(Math.min(r + 1, sortedData.length - 1), c);
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            const nextCol = event.shiftKey ? Math.max(c - 1, 0) : Math.min(c + 1, 7);
            focusCell(r, nextCol);
          }
        });

        cellContainer.appendChild(cell);
      } else if (c === 6 || c === 7) {
        // PSR Columns (Read-only)
        cellContainer.className = 'pill-cell-container psr-cell-container';

        const cell = document.createElement('div');
        cell.className = 'pill-cell readonly-pill';
        if (newlyImportedSegments.has(segKey)) cell.classList.add('new-import-highlight');
        cell.contentEditable = 'false';
        cell.spellcheck = false;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.textContent = sortedData[r][c] || '';
        
        cell.addEventListener('keydown', (event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            const nextCol = event.shiftKey ? Math.max(c - 1, 0) : Math.min(c + 1, 7);
            focusCell(r, nextCol);
          }
        });

        cellContainer.appendChild(cell);

        if (c === 7) {
          const sweepsDue = getLogSweepsDue();
          const isDue = sweepsDue.find(d => d.region === sortedData[r][0] && d.segment === sortedData[r][1]);
          
          const actionBtn = document.createElement('button');
          actionBtn.className = 'row-search-btn';
          actionBtn.type = 'button';
          
          if (isDue) {
            actionBtn.textContent = 'log sweeps';
            actionBtn.classList.add('log-sweeps-active');
            actionBtn.onclick = () => showLogSweepsPopup(isDue.taskNum);
          } else {
            actionBtn.textContent = 'search';
            actionBtn.onclick = () => {
              showTeamSelectionPopup((teamName) => {
                showMissingStepsPopup(teamName, null, () => {
                  const region = sortedData[r][0] || '';
                  const segment = sortedData[r][1] || '';
                  const taskNumber = addAutoSearchLogEntry(teamName, region, segment);
                  const assignmentStr = `#${taskNumber} ${region} - ${segment}`;
                  
                  const bundle2 = loadBundle();
                  bundle2.currentAssignments[teamName] = assignmentStr;
                  bundle2.teamAssignmentTimes[teamName] = Date.now();
                  bundle2.teamStatuses[teamName] = 'assigned';
                  saveBundle(bundle2);
                  addActivityLogEntry(teamName, `Started search on ${assignmentStr}`);
                  
                  navigateToPage('page4.html?scroll=latest');
                });
              });
            };
          }
          cellContainer.appendChild(actionBtn);
        }
      } else {
        const cell = document.createElement('div');
        cell.className = 'pill-cell';
        if (newlyImportedSegments.has(segKey)) cell.classList.add('new-import-highlight');
        cell.contentEditable = 'true';
        cell.spellcheck = false;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.textContent = sortedData[r]?.[c] ?? '';

        cell.addEventListener('blur', () => {
          let val = cell.textContent.trim();
          if (val) {
            if (c === 2) val = formatUnit(val, 'ac');
            else if (c === 3) val = formatUnit(val, 'mi');
            else if (c === 4) val = formatUnit(val, 'ft');
            else if (c === 5) val = formatUnit(val, 'hr');
          }
          const originalRow = sortedData[r];
          originalRow[c] = val;
          saveCurrentPageData(data);
          buildSegmentsTable();
        });

        cell.addEventListener('keydown', (event) => {
          const row = Number(cell.dataset.row);
          const col = Number(cell.dataset.col);
          if (event.key === 'Enter') {
            event.preventDefault();
            cell.blur();
            focusCell(Math.min(row + 1, sortedData.length - 1), col);
            return;
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            cell.blur();
            const nextCol = event.shiftKey ? Math.max(col - 1, 0) : Math.min(col + 1, 7);
            focusCell(row, nextCol);
          }
        });

        cellContainer.appendChild(cell);
      }
      td.appendChild(cellContainer);
      tr.appendChild(td);
    }

    const caltopoTd = document.createElement('td');
    caltopoTd.dataset.label = 'CalTopo';
    const caltopoContainer = document.createElement('div');
    caltopoContainer.className = 'pill-cell-container';
    
    const caltopoBtn = document.createElement('button');
    caltopoBtn.className = 'mini-pill';
    const caltopoId = sortedData[r][9];
    caltopoBtn.textContent = caltopoId ? 'Linked.' : 'Link CalTopo';
    caltopoBtn.style.cursor = 'pointer';
    caltopoBtn.style.width = '100%';
    caltopoBtn.style.textAlign = 'center';
    if (caltopoId) {
        caltopoBtn.style.background = 'rgba(64, 192, 87, 0.2)';
        caltopoBtn.style.borderColor = 'rgba(64, 192, 87, 0.4)';
        caltopoBtn.style.color = '#2b8a3e';
        caltopoBtn.style.fontWeight = '600';
        caltopoBtn.title = `Linked to CalTopo ID: ${caltopoId}`;
    }
    
    caltopoBtn.onclick = () => {
        const originalIdx = data.indexOf(sortedData[r]);
        showCalTopoLinkPopup(originalIdx);
    };
    
    caltopoContainer.appendChild(caltopoBtn);
    caltopoTd.appendChild(caltopoContainer);
    tr.appendChild(caltopoTd);

    const deleteTd = document.createElement('td');
    deleteTd.dataset.label = 'Delete';
    const deleteContainer = document.createElement('div');
    deleteContainer.className = 'pill-cell-container';
    const delBtn = document.createElement('button');
    delBtn.className = 'row-delete-btn';
    delBtn.textContent = 'Delete';
    delBtn.type = 'button';
    delBtn.onclick = () => {
      confirmDeleteRow(tr, () => {
        const segName = (sortedData[r] && sortedData[r][1]) || 'unnamed segment';
        const indexInData = data.indexOf(sortedData[r]);
        if (indexInData > -1) {
          data.splice(indexInData, 1);
          logDeletion('Segment', segName);
          if (data.length === 0) data.push(Array.from({ length: 10 }, () => ''));
          saveCurrentPageData(data);
          buildSegmentsTable();
        }
      });
    };
    deleteContainer.appendChild(delBtn);
    deleteTd.appendChild(deleteContainer);
    tr.appendChild(deleteTd);

    tableBody.appendChild(tr);
  }

  const addRowContainer = document.createElement('div');
  addRowContainer.className = 'add-row-container';
  const addRowBtn = document.createElement('button');
  addRowBtn.className = 'add-row-btn';
  addRowBtn.textContent = '+ Add new segment';
  addRowBtn.onclick = () => {
    data.push(Array.from({ length: 10 }, () => ''));
    logCreation('Segment', 'new empty segment');
    saveCurrentPageData(data);
    highlightedRowIndex = data.length - 1;
    buildSegmentsTable();
    focusCell(data.length - 1, 1);
  };
  addRowContainer.appendChild(addRowBtn);
  const existing = document.querySelector('.add-row-container');
  if (existing) existing.remove();
  tableBody.parentElement.after(addRowContainer);

  if (sortToggle) {
    sortToggle.onchange = () => {
      buildSegmentsTable();
    };
  }

  if (clearBtn) {
    clearBtn.remove();
  }
}

let currentPersonnelSubpage = 'activity';

function buildPersonnelTable() {
  const btnAll = document.getElementById('btn-all-members');
  const btnAct = document.getElementById('btn-activity');
  const btnTeamRep = document.getElementById('btn-team-reports');
  const btnMemRep = document.getElementById('btn-member-reports');

  const logContainer = document.getElementById('activity-log-container');
  const baseContainer = document.getElementById('base-teams-container-header');
  const teamReportsContainer = document.getElementById('team-reports-container');
  const memberReportsContainer = document.getElementById('member-reports-container');
  const searchTeamsContainer = document.getElementById('search-teams-container');
  const controls = document.getElementById('all-members-controls');
  const personnelGrid = document.querySelector('.personnel-grid');

  const subNavBtns = [btnAll, btnAct, btnTeamRep, btnMemRep];
  const containers = [controls, baseContainer, teamReportsContainer, memberReportsContainer, searchTeamsContainer];

    const isSubAllowed = (_sub) => {
      return true;
  };

  if (btnAct) btnAct.style.display = isSubAllowed('activity') ? 'inline-block' : 'none';
  if (btnTeamRep) btnTeamRep.style.display = isSubAllowed('team-reports') ? 'inline-block' : 'none';
  if (btnMemRep) btnMemRep.style.display = isSubAllowed('member-reports') ? 'inline-block' : 'none';
  if (btnAll) btnAll.style.display = isSubAllowed('all-members') ? 'inline-block' : 'none';

  // If current subpage is not allowed, switch to first allowed
  if (!isSubAllowed(currentPersonnelSubpage)) {
      if (isSubAllowed('activity')) currentPersonnelSubpage = 'activity';
      else if (isSubAllowed('all-members')) currentPersonnelSubpage = 'all-members';
      else if (isSubAllowed('team-reports')) currentPersonnelSubpage = 'team-reports';
      else if (isSubAllowed('member-reports')) currentPersonnelSubpage = 'member-reports';
  }

  function hideAll() {
    containers.forEach(c => { if (c) c.style.display = 'none'; });
    subNavBtns.forEach(b => { if (b) b.classList.remove('active'); });
    if (personnelGrid) personnelGrid.classList.remove('all-members-active');
  }

  if (btnAll) {
    btnAll.onclick = () => {
      currentPersonnelSubpage = 'all-members';
      buildPersonnelTable();
    };
  }
  if (btnAct) {
    btnAct.onclick = () => {
      currentPersonnelSubpage = 'activity';
      buildPersonnelTable();
    };
  }
  if (btnTeamRep) {
    btnTeamRep.onclick = () => {
      currentPersonnelSubpage = 'team-reports';
      buildPersonnelTable();
    };
  }
  if (btnMemRep) {
    btnMemRep.onclick = () => {
      currentPersonnelSubpage = 'member-reports';
      buildPersonnelTable();
    };
  }

  const btnPrintTeam = document.getElementById('print-team-reports');
  const btnPrintAllTeam = document.getElementById('print-all-team-reports');
  const btnPrintMem = document.getElementById('print-member-reports');
  const btnPrintAllMem = document.getElementById('print-all-member-reports');

  if (btnPrintTeam) btnPrintTeam.onclick = () => printCurrentReport('team');
  if (btnPrintAllTeam) btnPrintAllTeam.onclick = () => printAllReports('team');
  if (btnPrintMem) btnPrintMem.onclick = () => printCurrentReport('member');
  if (btnPrintAllMem) btnPrintAllMem.onclick = () => printAllReports('member');

  const btnReset = document.getElementById('btn-reset-members');
  const btnMobileStatus = document.getElementById('btn-mobile-status');

  if (btnMobileStatus) {
    btnMobileStatus.onclick = () => {
      navigateToPage('mobile-status.html');
    };
  }

  if (btnReset) {
    btnReset.onclick = () => {
      const popup = createPopup('Delete All Members?');
      const content = popup.querySelector('.popup-content');
      const btnContainer = popup.querySelector('.popup-buttons');
      
      // Semi-transparent red theme
      content.style.background = 'rgba(150, 0, 0, 0.9)';
      content.style.borderColor = '#ff4444';
      content.style.color = '#fff';

      const msg = document.createElement('p');
      msg.textContent = 'This will permanently delete all members from the list. Please type your name to confirm:';
      msg.style.marginBottom = '15px';
      content.insertBefore(msg, btnContainer);

      const confirmInput = document.createElement('input');
      confirmInput.type = 'text';
      confirmInput.placeholder = 'Your Name';
      confirmInput.className = 'cell-edit-input';
      confirmInput.style.width = '100%';
      confirmInput.style.marginBottom = '20px';
      confirmInput.style.background = 'rgba(255, 255, 255, 0.1)';
      confirmInput.style.color = '#fff';
      content.insertBefore(confirmInput, btnContainer);

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'popup-btn primary';
      confirmBtn.style.background = '#ff4444';
      confirmBtn.textContent = 'Delete All Members';
      confirmBtn.disabled = true;

      confirmInput.oninput = () => {
        confirmBtn.disabled = confirmInput.value.trim() === '';
      };

      confirmBtn.onclick = () => {
        const bundle = loadBundle();
        const allMembersData = bundle.pages.page3 || [];
        const memberNames = allMembersData.map(m => m[0]).filter(n => n);

        // 1. Mark finish all steps for all teams
        const teams = Object.keys(bundle.teamStatuses);
        teams.forEach(team => {
          const currentStatus = bundle.teamStatuses[team] || '';
          if (!currentStatus.startsWith('at base')) {
            const sequence = [
              { id: 'headed to assignment', log: 'Leaving base for assignment' },
              { id: 'searching', log: 'Beginning assignment' },
              { id: 'finished segment', log: 'Finished assignment' },
              { id: 'returning', log: 'Returning to base' },
              { id: 'at base', log: 'Arrived at base' }
            ];
            
            const getIndex = (s) => {
              if (s === 'assigned') return -1;
              if (s === 'headed to assignment') return 0;
              if (s === 'searching') return 1;
              if (s === 'finished segment') return 2;
              if (s === 'returning') return 3;
              if (s && s.startsWith('at base')) return 4;
              return -1;
            };

            const currentIndex = getIndex(currentStatus);
            for (let i = currentIndex + 1; i < sequence.length; i++) {
              const step = sequence[i];
              if (step.id === 'at base') {
                 const now = new Date();
                 const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                 bundle.teamStatuses[team] = `at base (${timeStr})`;
                 bundle.currentAssignments[team] = 'Base';
                 bundle.teamAssignmentTimes[team] = Date.now();
                 if (bundle.parChecks) delete bundle.parChecks[team];
                 if (bundle.teamLeaveTimes) delete bundle.teamLeaveTimes[team];
              } else {
                 bundle.teamStatuses[team] = step.id;
                 if (!bundle.parChecks) bundle.parChecks = {};
                 bundle.parChecks[team] = { lastTime: Date.now() };
                 if (step.id === 'headed to assignment') bundle.teamLeaveTimes[team] = Date.now();
              }
              addActivityLogEntry(team, step.log, bundle);
            }
          }
        });

        // 2. Log deleted members
        if (memberNames.length > 0) {
          addActivityLogEntry('System', 'Deleted all members: ' + memberNames.join(', '), bundle);
        }

        // 3. Clear data
        localStorage.removeItem(PERMANENT_PERSONNEL_KEY);
        bundle.pages.page3 = [];
        
        saveBundle(bundle);
        closePopup(popup);
        buildPersonnelTable();
      };
      btnContainer.appendChild(confirmBtn);
    };
  }

  const btnCallAll = document.getElementById('btn-call-all-to-base');
  if (btnCallAll) {
    btnCallAll.onclick = callAllTeamsToBase;
  }

  hideAll();

  if (logContainer) logContainer.style.display = 'block';

  if (currentPersonnelSubpage === 'all-members') {
    if (personnelGrid) personnelGrid.classList.add('all-members-active');
    if (controls) controls.style.display = 'flex';
    if (searchTeamsContainer) {
      searchTeamsContainer.style.display = 'block';
      const h2 = searchTeamsContainer.querySelector('h2');
      if (h2) h2.textContent = 'All Members';
    }
    if (btnAll) btnAll.classList.add('active');
    if (btnReset) btnReset.style.display = 'block';
    buildPersonnelAllMembersTable();
  } else if (currentPersonnelSubpage === 'activity') {
    if (searchTeamsContainer) {
      searchTeamsContainer.style.display = 'block';
      const h2 = searchTeamsContainer.querySelector('h2');
      if (h2) h2.textContent = 'Search Teams';
    }
    if (baseContainer) baseContainer.style.display = 'block';
    if (btnAct) btnAct.classList.add('active');
    buildPersonnelActivityTable();
  } else if (currentPersonnelSubpage === 'team-reports') {
    if (teamReportsContainer) teamReportsContainer.style.display = 'block';
    if (btnTeamRep) btnTeamRep.classList.add('active');
    buildTeamReports();
  } else if (currentPersonnelSubpage === 'member-reports') {
    if (memberReportsContainer) memberReportsContainer.style.display = 'block';
    if (btnMemRep) btnMemRep.classList.add('active');
    buildMemberReports();
  }
  updateActivityLogUI();
}

function buildPersonnelAllMembersTable() {
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  const onSceneToggle = document.getElementById('on-scene-toggle');
  const onSceneLabel = document.getElementById('on-scene-label');
  const sortToggle = document.getElementById('personnel-sort-toggle');
  const sortLabel = document.getElementById('personnel-sort-label');
  const data = loadData();

  // Ensure first row has 'Off Duty' if it's empty
  if (data.length > 0 && !data[0][0] && !data[0][1]) {
    data[0][1] = 'Off Duty';
    saveCurrentPageData(data);
  }

  const filterOnScene = onSceneToggle && onSceneToggle.checked;
  const sortByTeam = sortToggle && sortToggle.checked;

  if (onSceneLabel) onSceneLabel.textContent = filterOnScene ? 'Filter: On Scene' : 'Filter: All Members';
  if (sortLabel) sortLabel.textContent = sortByTeam ? 'Sort: Team then Name' : 'Sort: Name';

  if (onSceneToggle && !onSceneToggle.dataset.listenerAdded) {
    onSceneToggle.addEventListener('change', buildPersonnelTable);
    onSceneToggle.dataset.listenerAdded = 'true';
  }
  if (sortToggle && !sortToggle.dataset.listenerAdded) {
    sortToggle.addEventListener('change', buildPersonnelTable);
    sortToggle.dataset.listenerAdded = 'true';
  }

  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  const headers = ['Name', 'Team', 'GPS', 'Radio', 'Medic', 'Status', 'Delete'];
  const headerRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.className = 'fixed-header';
    headerRow.appendChild(th);
  });
  tableHead.appendChild(headerRow);

  const teamOptions = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu', 'Command', 'Off Duty', 'Base Support'];
  
  let filteredData = [...data];
  filteredData.sort((a, b) => {
    if (sortByTeam) {
      const teamA = (a[1] || '').toLowerCase();
      const teamB = (b[1] || '').toLowerCase();
      if (teamA < teamB) return -1;
      if (teamA > teamB) return 1;
    }
    const nameA = (a[0] || '').toLowerCase();
    const nameB = (b[0] || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const activeStatuses = ['Enroute', 'On-Scene', 'Hotel', 'Returning Home', 'true'];
  if (filterOnScene) {
    filteredData = filteredData.filter(row => activeStatuses.includes(row[6]));
  }

  if (highlightedRowIndex === -2 && window.lastAddedRow) {
    highlightedRowIndex = filteredData.indexOf(window.lastAddedRow);
    if (highlightedRowIndex === -1) {
      const targetStr = JSON.stringify(window.lastAddedRow);
      highlightedRowIndex = filteredData.findIndex(r => JSON.stringify(r) === targetStr);
    }
    window.lastAddedRow = null;
  }

  for (let r = 0; r < filteredData.length; r++) {
    const tr = document.createElement('tr');
    animateNewRow(tr, r);
    const originalRowIndex = data.indexOf(filteredData[r]);
    
    const rowHeaders = ['Name', 'Team', 'GPS', 'Radio', 'Medic', 'Status'];
    const cellIndices = [0, 1, 3, 4, 5, 6];
    
    for (let i = 0; i < rowHeaders.length; i++) {
      const c = cellIndices[i];
      const td = document.createElement('td');
      td.dataset.label = rowHeaders[i];
      const cellContainer = document.createElement('div');
      cellContainer.className = 'pill-cell-container';

      if (c === 0) {
        const cell = document.createElement('div');
        cell.className = 'mini-pill';
        cell.style.width = '100%';
        cell.style.cursor = 'text';
        cell.contentEditable = 'true';
        cell.spellcheck = false;
        cell.textContent = filteredData[r][c] || '';
        
        const nameClick = document.createElement('div');
        nameClick.style.position = 'absolute';
        nameClick.style.right = '8px';
        nameClick.style.top = '50%';
        nameClick.style.transform = 'translateY(-50%)';
        nameClick.style.opacity = '0.5';
        nameClick.style.cursor = 'pointer';
        nameClick.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>';
        nameClick.title = 'View Incident Times';
        nameClick.onclick = (e) => {
            e.stopPropagation();
            currentMemberReportSelection = filteredData[r][c];
            currentPersonnelSubpage = 'member-reports';
            buildPersonnelTable();
        };
        cellContainer.appendChild(nameClick);

        cell.addEventListener('blur', () => {
          const newName = cell.textContent.trim();
          if (data[originalRowIndex][c] !== newName) {
            data[originalRowIndex][c] = newName;
            saveCurrentPageData(data);
            if (!window.pendingEmptyCellFocus) {
               buildPersonnelTable();
            }
          }
        });
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const newName = cell.textContent.trim();
            if (data[originalRowIndex][c] !== newName) {
              data[originalRowIndex][c] = newName;
              saveCurrentPageData(data);
            }
            window.pendingEmptyCellFocus = { colLabel: 'Name' };
            buildPersonnelTable();
          }
        });
        cellContainer.appendChild(cell);
      } else if (c === 1) {
        const select = document.createElement('select');
        select.className = 'mini-pill personnel-select';
        select.style.width = '100%';
        select.style.cursor = 'pointer';
        const emptyOpt = document.createElement('option');
        emptyOpt.value = ''; emptyOpt.textContent = '-- Select Team --';
        select.appendChild(emptyOpt);
        teamOptions.forEach(team => {
          const opt = document.createElement('option');
          opt.value = team; opt.textContent = team;
          if (filteredData[r][c] === team) opt.selected = true;
          select.appendChild(opt);
        });
        select.onchange = () => {
          const newTeam = select.value;
          const oldTeam = data[originalRowIndex][c];
          const memberName = data[originalRowIndex][0];
          data[originalRowIndex][c] = newTeam;
          
          // Auto-switch team lead to new team's lead
          const existingTeamMember = data.find(row => row[1] === newTeam && row[2]);
            data[originalRowIndex][2] = existingTeamMember ? existingTeamMember[2] : '';
          
          saveCurrentPageData(data);
          addActivityLogEntry(newTeam || 'Personnel', `${memberName} moved from team ${oldTeam || 'none'} to ${newTeam || 'none'}`);
          buildPersonnelTable();
        };
        cellContainer.appendChild(select);
      } else if (c === 2) {
        const selectLead = document.createElement('select');
        selectLead.className = 'mini-pill personnel-select';
        selectLead.style.width = '100%';
        selectLead.style.cursor = 'pointer';
        const emptyOptLead = document.createElement('option');
        emptyOptLead.value = ''; emptyOptLead.textContent = '-- Select Leader --';
        selectLead.appendChild(emptyOptLead);
        
        const currentTeam = filteredData[r][1];
        const possibleLeads = data.filter(row => row[1] === currentTeam && row[0]);
        
        possibleLeads.forEach(row => {
          const opt = document.createElement('option');
          opt.value = row[0]; opt.textContent = row[0];
          if (filteredData[r][c] === row[0]) opt.selected = true;
          selectLead.appendChild(opt);
        });
        selectLead.onchange = () => {
          const newLead = selectLead.value;
          const targetTeam = data[originalRowIndex][1];
          const oldLead = data[originalRowIndex][c];
          
          // Update everyone on the same team to have this new lead
          data.forEach(row => {
            if (row[1] === targetTeam) {
              row[2] = newLead;
            }
          });
          
          saveCurrentPageData(data);
          addActivityLogEntry(targetTeam || 'Personnel', `Team lead changed from ${oldLead || 'none'} to ${newLead || 'none'}`);
          buildPersonnelTable();
        };
        cellContainer.appendChild(selectLead);
      } else {
        if (c === 6) { // Status column
          const statusLabel = data[originalRowIndex][c] === 'true' ? 'On-Scene' : (data[originalRowIndex][c] || 'Off Duty');
          const statusBtn = document.createElement('button');
          statusBtn.className = 'mini-pill status-pill-btn';
          statusBtn.style.width = '100%';
          statusBtn.style.cursor = 'pointer';
          statusBtn.textContent = statusLabel === 'false' ? 'Off Duty' : statusLabel;
          
          statusBtn.onclick = () => {
            const memberName = data[originalRowIndex][0] || '';
            sessionStorage.setItem('mobile-status-member', memberName);
            navigateToPage('mobile-status.html');
          };
          cellContainer.appendChild(statusBtn);
        } else { // GPS, Radio, Medic columns
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'pill-checkbox';
          checkbox.checked = filteredData[r][c] === 'true';
          checkbox.onchange = () => {
            const isChecked = checkbox.checked;
            data[originalRowIndex][c] = isChecked ? 'true' : 'false';
            saveCurrentPageData(data);
          };
          cellContainer.appendChild(checkbox);
        }
      }
      td.appendChild(cellContainer);
      tr.appendChild(td);
    }

    const deleteTd = document.createElement('td');
    deleteTd.dataset.label = 'Delete';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'row-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      confirmDeleteRow(tr, () => {
        const memberName = (data[originalRowIndex] && data[originalRowIndex][0]) || 'unnamed person';
        
        // Also remove from permanent storage
        if (memberName && memberName !== 'unnamed person') {
          const global = getPermanentPersonnel();
          if (global[memberName]) {
            delete global[memberName];
            setPermanentPersonnel(global);
          }
        }

        data.splice(originalRowIndex, 1);
        logDeletion('Personnel', memberName);
        if (data.length === 0) data.push(Array.from({ length: 14 }, () => ''));
        saveCurrentPageData(data);
        buildPersonnelTable();
      });
    };
    deleteTd.appendChild(deleteBtn);
    tr.appendChild(deleteTd);
    tableBody.appendChild(tr);
  }

  const addRowContainer = document.createElement('div');
  addRowContainer.className = 'add-row-container';
  const addRowBtn = document.createElement('button');
  addRowBtn.className = 'add-row-btn';
  addRowBtn.textContent = '+ Add new person';
  addRowBtn.onclick = () => {
    const newRow = Array.from({ length: 14 }, () => '');
    newRow[1] = 'Off Duty';
    newRow[6] = 'Enroute'; // Default to Enroute
    
    data.push(newRow);
    logCreation('Personnel', 'New Person');
    saveCurrentPageData(data);
    
    // Clear filters to ensure new row is visible
    if (onSceneToggle) {
        onSceneToggle.checked = false;
        if (onSceneLabel) onSceneLabel.textContent = 'Filter: All Members';
    }
    
    highlightedRowIndex = -2;
    window.lastAddedRow = newRow;
    buildPersonnelTable();
    
    // Focus the Name cell of the new row and select text
    setTimeout(() => {
      const highlightedRow = tableBody.querySelector('.new-row-highlight');
      if (highlightedRow) {
        const nameCell = highlightedRow.querySelector('.mini-pill[contenteditable="true"]');
        if (nameCell) {
          nameCell.focus();
          const range = document.createRange();
          range.selectNodeContents(nameCell);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }, 100);
  };
  addRowContainer.appendChild(addRowBtn);
  const existingAllMem = document.querySelector('.add-row-container');
  if (existingAllMem) existingAllMem.remove();
  tableBody.parentElement.after(addRowContainer);

  if (window.pendingEmptyCellFocus) {
    const colLabel = window.pendingEmptyCellFocus.colLabel;
    window.pendingEmptyCellFocus = null;
    setTimeout(() => {
      const rows = tableBody.querySelectorAll('tr');
      for (const row of rows) {
        const targetCell = row.querySelector(`td[data-label="${colLabel}"] .mini-pill[contenteditable="true"]`);
        if (targetCell && !targetCell.textContent.trim()) {
          targetCell.focus();
          return;
        }
      }
    }, 100);
  }
}

function getLatestPSR(region, segment) {
  const bundle = loadBundle();
  const segData = bundle.pages.page2 || [];
  for (let i = 0; i < segData.length; i++) {
    if (segData[i][0] === region && segData[i][1] === segment) {
      // Index 7 is PSRc. If empty, fallback to index 6 (PSRi)
      return segData[i][7] || segData[i][6] || '';
    }
  }
  return '';
}

function calculatePSRAfter(row, bundle, segDataOverride = null) {
  const region = row[3];
  const segment = row[4];
  const teamInfo = row[7] || '';
  const sweepWidth = parseNumeric(row[8]);
  const numSweeps = parseNumeric(row[9]);

  if (!region || !segment || sweepWidth <= 0 || numSweeps <= 0) return '';

  // Extract team members count from e.g. "Team Alpha (3)"
  const match = teamInfo.match(/\((\d+)\)/);
  const numMembers = match ? parseInt(match[1]) : 0;
  if (numMembers <= 0) return '';

  // Get segment info from Segments page data
  const segData = segDataOverride || bundle.pages.page2 || [];
  const segRow = segData.find(r => r[0] === region && r[1] === segment);
  if (!segRow) return '';

  const area = parseNumeric(segRow[2]);
  const length = parseNumeric(segRow[3]);
  const timePerSweep = parseNumeric(segRow[5]);

  if (area <= 0 || length <= 0 || timePerSweep <= 0) return '';

  // Get Consensus and Sum of Areas from Regions page data
  const regionsData = bundle.pages.index;
  const regionRowIndex = (regionsData.rows || []).findIndex(r => r[0] === region);
  if (regionRowIndex === -1) return '';

  const consensus = parseFloat(computeConsensus(regionsData, regionRowIndex)) || 0;
  if (consensus <= 0) return '';

  let sumOfAreas = 0;
  segData.forEach(r => {
    if (r[0] === region) {
      sumOfAreas += parseNumeric(r[2]);
    }
  });
  if (sumOfAreas <= 0) return '';

  // Formula as requested:
  // PSR = Length / TimePerSweep * SweepWidth * ((Consensus * Area / SumOfAreas) - ((Consensus * Area / SumOfAreas) * (1 - EXP(-(SweepWidth / (Area / 640 / Length / NumOfSweeps / NumTeamMembers) * 5280)))))) / (Area / 640)

  const baseValue = (consensus * area / sumOfAreas);
  const z = sweepWidth / ((area / 640 / length / numSweeps / numMembers) * 5280);
  const psrAfter = (length / timePerSweep * sweepWidth * (baseValue - (baseValue * (1 - Math.exp(-z))))) / (area / 640);

  return isFinite(psrAfter) ? psrAfter.toFixed(4) : '';
}

let lastKnownProgress = JSON.parse(sessionStorage.getItem('lastKnownProgress') || '{}');
const updatedTasks = new Set();

function markTaskUpdated(teamName) {
  updatedTasks.add(String(teamName));
  const bundle = loadBundle();
  const assignment = bundle.currentAssignments[teamName] || '';
  const match = assignment.match(/#(\d+)/);
  if (match) {
    updatedTasks.add(String(match[0])); // e.g. "#1"
    updatedTasks.add(String(match[1])); // e.g. "1"
  }
}

function getTaskProgressPercent(status) {
  if (status === 'assigned') return 16.6;
  if (status === 'headed to assignment') return 33.3;
  if (status === 'searching') return 50;
  if (status === 'finished segment') return 66.6;
  if (status === 'returning') return 83.3;
  if (status && status.startsWith('at base')) return 100;
  return 0;
}

function createProgressBar(progress, keyRaw) {
  const key = String(keyRaw);
  const progFill = document.createElement('div');
  progFill.className = 'progress-fill-bg';
  const prev = lastKnownProgress[key] || 0;
  progFill.style.width = prev + '%';
  
  if (updatedTasks.has(key)) {
      progFill.classList.add('animate-progress');
      // Smooth fill from previous level
      setTimeout(() => {
        progFill.style.width = progress + '%';
        if (progress === 100) {
            progFill.classList.add('filling');
            // Wait for fill to finish (0.6s), then turn green, wait 5s, fade out and reset.
            setTimeout(() => {
                progFill.classList.add('completed-green');
                setTimeout(() => {
                    progFill.classList.add('fade-out');
                    setTimeout(() => {
                        progFill.style.width = '0%';
                        progFill.classList.remove('animate-progress', 'filling', 'completed-green', 'fade-out');
                        lastKnownProgress[key] = 0;
                        sessionStorage.setItem('lastKnownProgress', JSON.stringify(lastKnownProgress));
                    }, 1000);
                }, 3000);
            }, 600);
        }
      }, 50);
  } else {
      progFill.style.width = progress + '%';
      if (progress === 100) {
          progFill.classList.add('finished');
      }
  }
  
  if (progress < 100) {
      lastKnownProgress[key] = progress;
      sessionStorage.setItem('lastKnownProgress', JSON.stringify(lastKnownProgress));
  }

  return progFill;
}

function isActiveMemberStatus(status) {
  if (!status) return false;
  const s = status.toString();
  const activeStatuses = ['Enroute', 'On-Scene', 'Hotel', 'Returning Home', 'true'];
  return activeStatuses.includes(s);
}

function getTeamMembers(teamName) {
  const bundle = loadBundle();
  const data = bundle.pages.page3 || [];
  return data.filter(row => row[1] === teamName);
}

function isParCheckDue(teamName, bundle) {
  const baseTeamNames = ['Base Support', 'Off Duty', 'Command'];
  if (baseTeamNames.includes(teamName)) return false;
  
  const status = bundle.teamStatuses[teamName] || '';
  if (status.startsWith('at base')) return false;

  const lastPar = bundle.parChecks?.[teamName];
  const leaveTime = bundle.teamLeaveTimes?.[teamName];
  const assignTime = bundle.teamAssignmentTimes?.[teamName];
  
  let startTime = 0;
  if (lastPar) startTime = Math.max(startTime, lastPar.lastTime);
  if (leaveTime) startTime = Math.max(startTime, leaveTime);
  if (assignTime) startTime = Math.max(startTime, assignTime);

  if (startTime > 0) {
    const elapsedMs = Date.now() - startTime;
    const freqMs = (bundle.parCheckFrequency || 20) * 60 * 1000;
    return (freqMs - elapsedMs) <= 0;
  }
  return false;
}

function getSegmentInfo(region, segment) {
  const bundle = loadBundle();
  const segData = bundle.pages.page2 || [];
  const row = segData.find(r => r[0] === region && r[1] === segment);
  if (row) {
    return {
      area: row[2],
      length: row[3],
      sweep: row[4],
      time: row[5],
      psr: row[6]
    };
  }
  return { area: '', length: '', sweep: '', time: '', psr: '' };
}

function getNextTaskNumber() {
  const bundle = loadBundle();
  const searchLog = bundle.pages.page4 || [];
  let max = 0;
  searchLog.forEach(row => {
    if (row[0]) {
      const num = parseInt(row[0].replace('#', ''));
      if (!isNaN(num) && num > max) max = num;
    }
  });
  return max + 1;
}

function addAutoSearchLogEntry(teamName, region, segment) {
  const bundle = loadBundle();
  const logData = bundle.pages.page4 || [];
  const now = new Date();
  const dateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()}`;
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  const psrBefore = getLatestPSR(region, segment);
  const teamMembers = getTeamMembers(teamName);
  const teamPillText = `${teamName} (${teamMembers.length})`;
  const segInfo = getSegmentInfo(region, segment);
  const taskNumber = getNextTaskNumber();

  const newRow = [
    `#${taskNumber}`,
    dateStr,
    timeStr,
    region,
    segment,
    psrBefore,
    '', // PSR After
    teamPillText,
    segInfo.sweep,
    '' // Num of Sweeps
  ];
  
  logData.push(newRow);
  bundle.pages.page4 = logData;
  logCreation('Search Log Entry', '#' + taskNumber, bundle);
  saveBundle(bundle);
  return taskNumber;
}

function reassignMember(memberName, targetTeam) {
  const bundle = loadBundle();
  const data = bundle.pages.page3 || [];
  const originalRow = data.find(row => row[0] === memberName);
  
  if (originalRow) {
    const fromTeam = originalRow[1];
    if (fromTeam === targetTeam) return;
    
    originalRow[1] = targetTeam;
    
    // Auto-switch team lead to new team's lead
    const existingTeamMember = data.find(row => row[1] === targetTeam && row[2]);
    originalRow[2] = existingTeamMember ? existingTeamMember[2] : '';
    
    saveBundle(bundle);
    addActivityLogEntry(targetTeam, `${memberName} reassigned from ${fromTeam} to ${targetTeam}`);
    refreshCurrentPageTable();
  }
}

function promoteToTeamLead(memberName, targetTeam) {
  const bundle = loadBundle();
  const data = bundle.pages.page3 || [];
  
  // First ensure member is in the target team
  const originalRow = data.find(row => row[0] === memberName);
  if (!originalRow) return;

  const fromTeam = originalRow[1];
  const oldLeadRow = data.find(row => row[1] === targetTeam && row[2] === row[0]);
  const oldLeadName = oldLeadRow ? oldLeadRow[0] : 'None';

  if (memberName === oldLeadName && fromTeam === targetTeam) return;

  if (fromTeam !== targetTeam) {
    originalRow[1] = targetTeam;
    addActivityLogEntry(targetTeam, `${memberName} reassigned from ${fromTeam} to ${targetTeam}`);
  }

  // Update all team members to the new lead name
  data.forEach(row => {
    if (row[1] === targetTeam) {
      row[2] = memberName;
    }
  });

  saveBundle(bundle);
  addActivityLogEntry(targetTeam, `${memberName} is now Team Lead (previously ${oldLeadName})`);
  refreshCurrentPageTable();
}

function buildPersonnelActivityTable() {
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  const baseTableHead = document.getElementById('base-table-head');
  const baseTableBody = document.getElementById('base-table-body');
  const baseContainer = document.getElementById('base-teams-container-header');
  const searchTeamsContainer = document.getElementById('search-teams-container');
  
  const bundle = loadBundle();
  const data = bundle.pages.page3 || [];

  tableHead.innerHTML = '';
  tableBody.innerHTML = '';
  if (baseTableHead) baseTableHead.innerHTML = '';
  if (baseTableBody) baseTableBody.innerHTML = '';

  const headers = ['Team / Lead', 'Members', 'Assignment / Status', 'Update / Par Check'];
  const headerRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.className = 'fixed-header';
    headerRow.appendChild(th);
  });
  tableHead.appendChild(headerRow);

  if (baseTableHead) {
    const baseHeaderRow = document.createElement('tr');
    ['Team', 'Members'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      th.className = 'fixed-header';
      baseHeaderRow.appendChild(th);
    });
    baseTableHead.appendChild(baseHeaderRow);
  }

  const teamsMap = new Map();
  const baseTeamsMap = new Map();
  const baseTeamNames = ['Base Support', 'Off Duty', 'Command'];

  data.forEach((row) => {
    // Show all members that have a name regardless of status
    if (row[0] && row[0].trim() !== '') {
      let teamName = row[1] && row[1].trim() !== '' ? row[1] : 'Off Duty';
      
      if (baseTeamNames.includes(teamName)) {
        if (!baseTeamsMap.has(teamName)) baseTeamsMap.set(teamName, []);
        baseTeamsMap.get(teamName).push(row);
      } else {
        if (!teamsMap.has(teamName)) teamsMap.set(teamName, []);
        teamsMap.get(teamName).push(row);
      }
    }
  });

  if (baseContainer) {
    baseContainer.style.display = 'block';
  }
  if (searchTeamsContainer) {
    searchTeamsContainer.style.display = 'block';
  }

  const sortedBaseTeams = Array.from(baseTeamsMap.keys()).sort();
  sortedBaseTeams.forEach((teamName, idx) => {
    const members = baseTeamsMap.get(teamName);

    const tr = document.createElement('tr');
    animateNewRow(tr, idx);
    animateArrivedRow(tr, teamName);

    const tdTeam = document.createElement('td');
    tdTeam.dataset.label = 'Team';
    const teamPill = document.createElement('div');
    teamPill.className = 'mini-pill readonly-pill';
    teamPill.textContent = teamName;
    tdTeam.appendChild(teamPill);
    tr.appendChild(tdTeam);

    const tdMembers = document.createElement('td');
    tdMembers.dataset.label = 'Members';
    const membersContainer = document.createElement('div');
    membersContainer.className = 'pill-container';
    
    // Drag and drop for container
    membersContainer.ondragover = (e) => {
      e.preventDefault();
      membersContainer.classList.add('drag-over');
    };
    membersContainer.ondragleave = () => {
      membersContainer.classList.remove('drag-over');
    };
    membersContainer.ondrop = (e) => {
      e.preventDefault();
      membersContainer.classList.remove('drag-over');
      const memberName = e.dataTransfer.getData('text/plain');
      reassignMember(memberName, teamName);
    };

    members.forEach(member => {
      const pill = document.createElement('div');
      pill.className = 'mini-pill';
      pill.textContent = member[0];
      pill.onclick = () => showReassignPopup(member, teamName);
      
      // Drag and drop for pill
      pill.draggable = true;
      pill.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', member[0]);
        pill.classList.add('dragging');
      };
      pill.ondragend = () => {
        pill.classList.remove('dragging');
      };

      membersContainer.appendChild(pill);
    });
    tdMembers.appendChild(membersContainer);
    tr.appendChild(tdMembers);

    if (baseTableBody) baseTableBody.appendChild(tr);
  });

  const sortedTeams = Array.from(teamsMap.keys()).sort();
  sortedTeams.forEach((teamName, idx) => {
    const members = teamsMap.get(teamName);
    const teamLeadRow = members.find(row => row[2] === row[0]) || members[0];
    const teamLead = teamLeadRow ? teamLeadRow[0] : '';

    const tr = document.createElement('tr');
    animateNewRow(tr, idx);
    animateArrivedRow(tr, teamName);

    const tdTeamLead = document.createElement('td');
    tdTeamLead.dataset.label = 'Team / Lead';
    const teamLeadContainer = document.createElement('div');
    teamLeadContainer.className = 'pill-cell-container stacked';

    const teamPill = document.createElement('div');
    teamPill.className = 'mini-pill readonly-pill';
    teamPill.textContent = teamName;
    teamLeadContainer.appendChild(teamPill);

    const teamLeadPill = document.createElement('div');
    teamLeadPill.className = 'mini-pill clickable-pill';
    teamLeadPill.textContent = teamLead || 'No Lead';
    teamLeadPill.onclick = () => {
        if (teamLeadRow) showTeamLeadSwapPopup(teamLeadRow, teamName);
    };

    // Drag and drop for Team Lead pill (drop target)
    teamLeadPill.ondragover = (e) => {
      e.preventDefault();
      teamLeadPill.classList.add('drag-over');
    };
    teamLeadPill.ondragleave = () => {
      teamLeadPill.classList.remove('drag-over');
    };
    teamLeadPill.ondrop = (e) => {
      e.preventDefault();
      teamLeadPill.classList.remove('drag-over');
      const memberName = e.dataTransfer.getData('text/plain');
      promoteToTeamLead(memberName, teamName);
    };

    // Drag for team lead (draggable)
    if (teamLead) {
      teamLeadPill.draggable = true;
      teamLeadPill.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', teamLead);
        teamLeadPill.classList.add('dragging');
      };
      teamLeadPill.ondragend = () => {
        teamLeadPill.classList.remove('dragging');
      };
    }

    teamLeadContainer.appendChild(teamLeadPill);
    tdTeamLead.appendChild(teamLeadContainer);
    tr.appendChild(tdTeamLead);

    const tdMembers = document.createElement('td');
    tdMembers.dataset.label = 'Members';
    const membersContainer = document.createElement('div');
    membersContainer.className = 'pill-container';

    // Drag and drop for Members container (drop target)
    membersContainer.ondragover = (e) => {
      e.preventDefault();
      membersContainer.classList.add('drag-over');
    };
    membersContainer.ondragleave = () => {
      membersContainer.classList.remove('drag-over');
    };
    membersContainer.ondrop = (e) => {
      e.preventDefault();
      membersContainer.classList.remove('drag-over');
      const memberName = e.dataTransfer.getData('text/plain');
      reassignMember(memberName, teamName);
    };

    members.forEach(member => {
      // Members who are team leads do not need to be in the Members column
      if (member[0] === teamLead) return;

      const pill = document.createElement('div');
      pill.className = 'mini-pill';
      pill.textContent = member[0];
      pill.onclick = () => showReassignPopup(member, teamName);
      
      // Drag for member (draggable)
      pill.draggable = true;
      pill.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', member[0]);
        pill.classList.add('dragging');
      };
      pill.ondragend = () => {
        pill.classList.remove('dragging');
      };

      membersContainer.appendChild(pill);
    });
    tdMembers.appendChild(membersContainer);
    tr.appendChild(tdMembers);

    const tdAssignStatus = document.createElement('td');
    tdAssignStatus.dataset.label = 'Assignment / Status';
    const assignStatusContainer = document.createElement('div');
    assignStatusContainer.className = 'pill-cell-container stacked';

    const assignmentText = bundle.currentAssignments[teamName] || 'None';
    const assignPill = document.createElement('div');
    assignPill.className = 'mini-pill clickable-pill';
    assignPill.textContent = assignmentText;
    assignPill.onclick = () => showTeamUpdatePopup(teamName);
    assignStatusContainer.appendChild(assignPill);

    const statusPill = document.createElement('div');
    statusPill.className = 'mini-pill clickable-pill';
    const statusText = bundle.teamStatuses[teamName] || '';
    statusPill.textContent = statusText;
    statusPill.onclick = () => showTeamUpdatePopup(teamName);
    
    if (assignmentText !== 'None' && assignmentText !== 'Base' && assignmentText !== '') {
      const progress = getTaskProgressPercent(statusText);
      statusPill.appendChild(createProgressBar(progress, teamName));
    }
    
    assignStatusContainer.appendChild(statusPill);
    tdAssignStatus.appendChild(assignStatusContainer);
    tr.appendChild(tdAssignStatus);

    const tdUpdatePar = document.createElement('td');
    tdUpdatePar.dataset.label = 'Update / Par Check';
    const updateParContainer = document.createElement('div');
    updateParContainer.className = 'pill-cell-container stacked';

    const updatePill = document.createElement('div');
    updatePill.className = 'mini-pill update-pill';
    updatePill.textContent = 'Update';
    updatePill.onclick = () => showTeamUpdatePopup(teamName);
    updateParContainer.appendChild(updatePill);

    const parPill = document.createElement('div');
    parPill.className = 'mini-pill readonly-pill';
    
    const lastPar = bundle.parChecks?.[teamName];
    const leaveTime = bundle.teamLeaveTimes?.[teamName];
    const assignTime = bundle.teamAssignmentTimes?.[teamName];
    
    let startTime = 0;
    if (lastPar) startTime = Math.max(startTime, lastPar.lastTime);
    if (leaveTime) startTime = Math.max(startTime, leaveTime);
    if (assignTime) startTime = Math.max(startTime, assignTime);

    const status = bundle.teamStatuses[teamName] || '';
    if (status.startsWith('at base')) {
      parPill.textContent = ' - ';
    } else if (startTime > 0) {
      const elapsedMs = Date.now() - startTime;
      const freqMs = (bundle.parCheckFrequency || 20) * 60 * 1000;
      const remainingMs = freqMs - elapsedMs;

      if (remainingMs <= 0) {
        parPill.textContent = 'Par Check Due';
        parPill.classList.add('par-check-due');
      } else {
        const remainingMin = Math.ceil(remainingMs / 60000);
        parPill.textContent = `${remainingMin}m`;
      }
    } else {
      parPill.textContent = 'N/A';
    }

    parPill.onclick = () => showParCheckPopup(teamName);
    updateParContainer.appendChild(parPill);
    tdUpdatePar.appendChild(updateParContainer);
    tr.appendChild(tdUpdatePar);

    if (idx < sortedTeams.length - 1) {
      tr.classList.add('team-divider-row');
    }

    tableBody.appendChild(tr);
  });

  updateActivityLogUI();
  const existingAddRow = document.querySelector('.add-row-container');
  if (existingAddRow) existingAddRow.remove();
}

function showReassignPopup(member, currentTeam) {
  const teamOptions = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu', 'Command', 'Off Duty', 'Base Support'];
  const popup = createPopup('Reassign ' + member[0]);
  const btnContainer = popup.querySelector('.popup-buttons');
  btnContainer.style.display = 'flex';
  btnContainer.style.flexWrap = 'wrap';
  btnContainer.style.gap = '10px';

  teamOptions.forEach(team => {
    if (team === currentTeam) return;
    const btn = document.createElement('button');
    btn.className = 'mini-pill';
    btn.textContent = 'Move to ' + team;
    btn.onclick = () => {
      const bundle = loadBundle();
      const data = bundle.pages.page3;
      const originalRow = data.find(row => row[0] === member[0]);
      if (originalRow) {
        originalRow[1] = team;
        
        // Auto-switch team lead to new team's lead
        const existingTeamMember = data.find(row => row[1] === team && row[2]);
        originalRow[2] = existingTeamMember ? existingTeamMember[2] : '';
        
        saveBundle(bundle);
        addActivityLogEntry(team, `${member[0]} reassigned from ${currentTeam} to ${team}`);
        refreshCurrentPageTable();
      }
      closePopup(popup);
    };
    btnContainer.appendChild(btn);
  });

  // Leave Scene button in reassign popup
  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'mini-pill';
  leaveBtn.style.borderColor = 'rgba(255, 69, 58, 0.4)';
  leaveBtn.style.color = '#ff453a';
  leaveBtn.textContent = 'Leave Scene';
  leaveBtn.onclick = () => {
    closePopup(popup);
    promptMemberOffScene(member);
  };
  btnContainer.appendChild(leaveBtn);
}

function showTeamLeadSwapPopup(currentLeadRow, teamName) {
  const bundle = loadBundle();
  const data = bundle.pages.page3 || [];
  const teamMembers = data.filter(row => row[1] === teamName && row[0] !== currentLeadRow[0] && isActiveMemberStatus(row[6]));
  
  const popup = createPopup(`Change Team Lead for ${teamName}`);
  const btnContainer = popup.querySelector('.popup-buttons');
  btnContainer.style.display = 'flex';
  btnContainer.style.flexWrap = 'wrap';
  btnContainer.style.gap = '10px';

  if (teamMembers.length === 0) {
    const msg = document.createElement('div');
    msg.textContent = "No other members in this team to promote.";
    msg.style.marginBottom = "10px";
    btnContainer.appendChild(msg);
  }

  teamMembers.forEach(member => {
    const btn = document.createElement('button');
    btn.className = 'mini-pill';
    btn.textContent = 'Promote ' + member[0];
    btn.onclick = () => {
      const b = loadBundle();
      const d = b.pages.page3;
      const newLeadName = member[0];
      const oldLeadName = currentLeadRow[0];
      
      // Update all team members to the new lead name
      d.forEach(row => {
        if (row[1] === teamName) {
          row[2] = newLeadName;
        }
      });
      
      saveBundle(b);
      addActivityLogEntry(teamName, `${newLeadName} is now Team Lead (previously ${oldLeadName})`);
      closePopup(popup);
      refreshCurrentPageTable();
    };
    btnContainer.appendChild(btn);
  });
}

function getStatusIndex(status) {
    if (status === 'assigned') return -1;
    if (status === 'headed to assignment') return 0;
    if (status === 'searching') return 1;
    if (status === 'finished segment') return 2;
    if (status === 'returning') return 3;
    if (status && (status === 'at base' || status.startsWith('at base'))) return 4;
    return -1;
}

function showTeamUpdatePopup(teamName) {
  const popup = createPopup('Team ' + teamName + ' Update');
  const btnContainer = popup.querySelector('.popup-buttons');

  const bundle = loadBundle();
  const currentStatus = bundle.teamStatuses[teamName] || '';
  const currentIndex = getStatusIndex(currentStatus);

  const updateStatus = (newStatus, logAction) => {
    showMissingStepsPopup(teamName, newStatus, () => {
      markTaskUpdated(teamName);
      const b = loadBundle();
      b.teamStatuses[teamName] = newStatus;
      if (newStatus === 'headed to assignment') {
        b.teamLeaveTimes[teamName] = Date.now();
      }
      if (!b.parChecks) b.parChecks = {};
      b.parChecks[teamName] = { lastTime: Date.now() };
      saveBundle(b);
      addActivityLogEntry(teamName, logAction);
      popup.remove();
      refreshCurrentPageTable();
    });
  };

  const statusActions = [
    { id: 'headed to assignment', label: 'Leave Base', action: () => updateStatus('headed to assignment', 'Leaving base for assignment') },
    { id: 'searching', label: 'Begin Assignment', action: () => updateStatus('searching', 'Beginning assignment') },
    { id: 'finished segment', label: 'Finish Assignment', action: () => updateStatus('finished segment', 'Finished assignment') },
    { id: 'returning', label: 'Return to Base', action: () => updateStatus('returning', 'Returning to base') },
    { id: 'at base', label: 'Arrived at Base', action: () => {
        showMissingStepsPopup(teamName, 'at base', () => {
            markTaskUpdated(teamName);
            const b = loadBundle();
            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            b.teamStatuses[teamName] = `at base (${timeStr})`;
            b.currentAssignments[teamName] = 'Base';
            b.teamAssignmentTimes[teamName] = Date.now();
            
            if (b.parChecks) delete b.parChecks[teamName];
            if (b.teamLeaveTimes) delete b.teamLeaveTimes[teamName];
            if (b.teamAssignmentTimes) delete b.teamAssignmentTimes[teamName];
            
            if (!b.arrivedTeams) b.arrivedTeams = [];
            if (!b.arrivedTeams.includes(teamName)) b.arrivedTeams.push(teamName);
            
            saveBundle(b);
            addActivityLogEntry(teamName, `Arrived at base at ${timeStr}`);
            popup.remove();
            refreshCurrentPageTable();
        });
    }}
  ];

  // Assign New Task (Always available)
  const btnNew = document.createElement('button');
  btnNew.className = 'popup-btn';
  btnNew.textContent = 'Assign New Task';
  btnNew.onclick = () => {
    showNewSegmentPopup(teamName, popup);
  };
  btnContainer.appendChild(btnNew);

  // Status Buttons
  statusActions.forEach((step, idx) => {
    const btn = document.createElement('button');
    btn.className = 'popup-btn';
    btn.textContent = step.label;
    if (idx <= currentIndex) {
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
    }
    btn.onclick = step.action;
    btnContainer.appendChild(btn);
  });

  // Par Check
  const btnPar = document.createElement('button');
  btnPar.className = 'popup-btn';
  if (isParCheckDue(teamName, bundle)) {
    btnPar.textContent = 'Par Check Due';
    btnPar.classList.add('par-check-due');
  } else {
    btnPar.textContent = 'Par Check';
  }
  btnPar.onclick = () => {
    showParCheckPopup(teamName, popup);
  };
  btnContainer.appendChild(btnPar);
}

function refreshCurrentPageTable() {
  if (isPersonnelPage()) buildPersonnelTable();
  else if (isSearchLogPage()) buildSearchLogTable();
  else if (isSegmentsPage()) buildSegmentsTable();
  else if (isFormsPage()) buildFormsPage();
  else if (isRegionsPage()) buildRegionsTable();
  else if (isHomePage()) buildHomePage();

  // Ensure header status (like par checks) is updated immediately, but avoid infinite loop
  checkParChecksAndNotify(true);
}

function showParCheckPopup(teamName, parentPopup) {
  if (parentPopup) closePopup(parentPopup);
  const popup = createPopup('Par Check - Team ' + teamName, null, () => refreshCurrentPageTable());
  const content = popup.querySelector('.popup-content');
  
  const inputContainer = document.createElement('div');
  inputContainer.className = 'popup-input-container';
  
  const textarea = document.createElement('textarea');
  textarea.className = 'popup-textarea';
  textarea.placeholder = 'Enter par check update...';
  inputContainer.appendChild(textarea);
  
  const updateBtn = document.createElement('button');
  updateBtn.className = 'popup-btn primary';
  updateBtn.textContent = 'Update';
  updateBtn.onclick = () => {
    const bundle = loadBundle();
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const fullNote = `[${timeStr}] Par Check: ${textarea.value}`;
    bundle.parChecks[teamName] = {
      lastTime: Date.now(),
      lastNote: textarea.value
    };
    saveBundle(bundle);
    addActivityLogEntry(teamName, fullNote);
    closePopup(popup);
    refreshCurrentPageTable();
  };
  inputContainer.appendChild(updateBtn);
  
  content.appendChild(inputContainer);
}

function showNewSegmentPopup(teamName, parentPopup) {
  if (parentPopup) parentPopup.remove();
  const popup = createPopup('Assign New Task - Team ' + teamName);
  const content = popup.querySelector('.popup-content');
  
  const bundle = loadBundle();
  const segments = (bundle.pages.page2 || []).filter(s => s[0] && s[1]);
  
  // Sort by PSR descending
  segments.sort((a, b) => {
    const psrA = parseFloat(getLatestPSR(a[0], a[1])) || 0;
    const psrB = parseFloat(getLatestPSR(b[0], b[1])) || 0;
    return psrB - psrA;
  });

  if (segments.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No segments defined.';
    content.appendChild(p);
  } else {
    const select = document.createElement('select');
    select.className = 'popup-select';
    select.style.width = '100%';
    select.style.marginBottom = '15px';
    select.style.padding = '8px';
    
    const defaultOpt = document.createElement('option');
    defaultOpt.value = "";
    defaultOpt.textContent = "Select a segment...";
    select.appendChild(defaultOpt);
    
    segments.forEach(seg => {
      const region = seg[0];
      const segment = seg[1];
      const psr = getLatestPSR(region, segment);
      const val = `${region} - ${segment}`;
      
      const opt = document.createElement('option');
      opt.value = JSON.stringify({region, segment, val});
      opt.textContent = `${segment} (PSRc: ${psr || 'N/A'})`;
      select.appendChild(opt);
    });
    
    content.appendChild(select);
    
    const assignBtn = document.createElement('button');
    assignBtn.className = 'popup-btn primary';
    assignBtn.textContent = 'Assign Selected Task';
    assignBtn.onclick = () => {
      if (!select.value) return;
      
      const {region, segment, val} = JSON.parse(select.value);
      
      showMissingStepsPopup(teamName, null, () => {
        const taskNumber = addAutoSearchLogEntry(teamName, region, segment);
        const fullAssignment = `#${taskNumber} ${val}`;
        
        const b2 = loadBundle();
        b2.currentAssignments[teamName] = fullAssignment;
        b2.teamAssignmentTimes[teamName] = Date.now();
        b2.teamStatuses[teamName] = 'assigned';
        if (!b2.parChecks) b2.parChecks = {};
        b2.parChecks[teamName] = { lastTime: Date.now() };
        saveBundle(b2);
        markTaskUpdated(teamName);
        addActivityLogEntry(teamName, 'Assigned to segment: ' + fullAssignment);
        closePopup(popup);
        refreshCurrentPageTable();
      });
    };
    content.appendChild(assignBtn);
  }
}

function showTeamSelectionPopup(onTeamSelected) {
  const bundle = loadBundle();
  const data = bundle.pages.page3 || [];
  const teamsMap = new Map();
  data.forEach(row => {
    if (row[1]) {
      teamsMap.set(row[1], true);
    }
  });
  const sortedTeams = Array.from(teamsMap.keys())
    .filter(team => team !== 'Base Support' && team !== 'Command')
    .sort();

  const popup = createPopup('Select Team for Search');
  const content = popup.querySelector('.popup-content');
  
  const segmentsGrid = document.createElement('div');
  segmentsGrid.className = 'popup-segments-grid';
  
  if (sortedTeams.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No teams currently available.';
    segmentsGrid.appendChild(p);
  }

  sortedTeams.forEach(team => {
    const status = bundle.teamStatuses[team] || 'unassigned';
    const assignment = bundle.currentAssignments[team] || '';
    
    const btn = document.createElement('button');
    btn.className = 'mini-pill';
    btn.style.width = '100%';
    btn.style.padding = '12px';
    btn.style.display = 'flex';
    btn.style.flexDirection = 'column';
    btn.style.alignItems = 'center';
    btn.style.gap = '4px';
    
    const nameDiv = document.createElement('div');
    nameDiv.style.fontWeight = 'bold';
    nameDiv.textContent = 'Team ' + team;
    btn.appendChild(nameDiv);

    if (status && status.startsWith('at base')) {
      btn.style.background = 'rgba(255, 255, 255, 0.05)';
      const pill = document.createElement('div');
      pill.style.fontSize = '0.75rem';
      pill.style.opacity = '0.7';
      pill.textContent = status;
      btn.appendChild(pill);
    } else {
      btn.style.background = 'rgba(125, 198, 255, 0.15)';
      btn.style.borderColor = 'rgba(125, 198, 255, 0.4)';
      const match = assignment.match(/#\d+/);
      
      const pill = document.createElement('div');
      pill.style.fontSize = '0.75rem';
      pill.style.color = 'var(--accent)';
      
      let displayText = status;
      if (match) {
        displayText += ` (Task ${match[0]})`;
      } else if (assignment) {
        displayText += ` (${assignment})`;
      }
      pill.textContent = displayText;
      btn.appendChild(pill);
    }

    btn.onclick = () => {
      onTeamSelected(team);
      closePopup(popup);
    };
    segmentsGrid.appendChild(btn);
  });
  content.appendChild(segmentsGrid);
}

function showMissingStepsPopup(teamName, targetStatus, onComplete) {
  const bundle = loadBundle();
  const currentStatus = bundle.teamStatuses[teamName] || '';
  
  const sequence = [
    { id: 'headed to assignment', label: 'Leave Base', log: 'Leaving base for assignment' },
    { id: 'searching', label: 'Begin Assignment', log: 'Beginning assignment' },
    { id: 'finished segment', label: 'Finish Assignment', log: 'Finished assignment' },
    { id: 'returning', label: 'Return to Base', log: 'Returning to base' },
    { id: 'at base', label: 'Arrived at Base', log: 'Arrived at base' }
  ];

  const currentIndex = getStatusIndex(currentStatus);
  const targetIndex = getStatusIndex(targetStatus);
  
  const missingSteps = sequence.slice(currentIndex + 1, targetIndex);
  
  if (missingSteps.length === 0) {
    onComplete();
    return;
  }
  
  const popup = createPopup('Missing Steps: ' + teamName);
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');
  
  const msg = document.createElement('p');
  msg.textContent = 'Please provide missing step information:';
  msg.style.marginBottom = '15px';
  content.insertBefore(msg, btnContainer);
  
  const list = document.createElement('div');
  list.style.textAlign = 'left';
  list.style.marginBottom = '20px';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '15px';
  list.style.maxHeight = '300px';
  list.style.overflowY = 'auto';
  list.style.paddingRight = '5px';
  
  const stepData = [];

    missingSteps.forEach((step) => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.justifyContent = 'space-between';
    item.style.gap = '15px';
    
    // Step Pill Button
    const stepPill = document.createElement('div');
    stepPill.className = 'popup-btn';
    stepPill.textContent = step.label;
    stepPill.style.flex = '1';
    stepPill.style.padding = '8px 16px';
    stepPill.style.fontSize = '0.9rem';
    stepPill.style.cursor = 'default';
    stepPill.style.textAlign = 'center';
    item.appendChild(stepPill);

    // Date/Time Stamp
    const now = new Date();
    const initialDate = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()}`;
    const initialTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    const stamp = document.createElement('div');
    stamp.className = 'sub-nav-btn';
    stamp.style.padding = '8px 12px';
    stamp.style.fontSize = '0.85rem';
    stamp.style.whiteSpace = 'nowrap';
    stamp.style.cursor = 'pointer';
    stamp.textContent = `${initialDate} ${initialTime}`;
    
    const currentStepData = { step, date: initialDate, time: initialTime };
    stepData.push(currentStepData);

    stamp.onclick = () => {
        showEditTimePopup(currentStepData, (newData) => {
            stamp.textContent = `${newData.date} ${newData.time}`;
        });
    };

    item.appendChild(stamp);
    list.appendChild(item);
  });
  
  content.insertBefore(list, btnContainer);
  
  const submitBtn = document.createElement('button');
  submitBtn.className = 'popup-btn primary';
  submitBtn.textContent = 'Submit';
  submitBtn.onclick = () => {
    markTaskUpdated(teamName);
    const b = loadBundle();
    stepData.forEach(item => {
        let logText = item.step.log;
        const d = item.date;
        const t = item.time;

        if (item.step.id === 'at base') {
          b.teamStatuses[teamName] = `at base (${t})`;
          b.currentAssignments[teamName] = 'Base';
          b.teamAssignmentTimes[teamName] = Date.now();
        } else {
          b.teamStatuses[teamName] = item.step.id;
          if (item.step.id === 'headed to assignment') {
            b.teamLeaveTimes[teamName] = Date.now();
          }
        }

        if (item.step.id === 'finished segment') {
            const assignment = b.currentAssignments[teamName] || '';
            const match = assignment.match(/#\d+/);
            if (match) {
                const tag = match[0];
                const searchLog = b.pages.page4 || [];
                const logEntry = searchLog.find(r => r[0] === tag);
                if (logEntry) {
                    logEntry[1] = d;
                    logEntry[2] = t;
                }
            }
        }

        addActivityLogEntry(teamName, logText, b, null, d, t);
    });
    saveBundle(b);
    closePopup(popup);
    onComplete();
  };
  btnContainer.appendChild(submitBtn);
}

function showEditTimePopup(data, onSave) {
  const popup = createPopup('Edit Time');
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');
  
  const inputContainer = document.createElement('div');
  inputContainer.style.display = 'flex';
  inputContainer.style.flexDirection = 'column';
  inputContainer.style.gap = '15px';
  inputContainer.style.marginBottom = '20px';
  inputContainer.style.marginTop = '10px';
  
  const dateInput = document.createElement('input');
  dateInput.className = 'pill-input';
  dateInput.value = data.date;
  dateInput.placeholder = 'MM-DD-YYYY';
  setupAutoFormatDate(dateInput);
  
  const timeInput = document.createElement('input');
  timeInput.className = 'pill-input';
  timeInput.value = data.time;
  timeInput.placeholder = 'hh:mm';
  setupAutoFormatTime(timeInput);
  
  inputContainer.appendChild(dateInput);
  inputContainer.appendChild(timeInput);
  content.insertBefore(inputContainer, btnContainer);
  
  const saveBtn = document.createElement('button');
  saveBtn.className = 'popup-btn primary';
  saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
        await withSaveButtonFeedback(saveBtn, async () => {
            data.date = dateInput.value;
            data.time = timeInput.value;
            await Promise.resolve(onSave(data));
            closePopup(popup);
        });
  };
  btnContainer.appendChild(saveBtn);
}

function callAllTeamsToBase() {
  const commander = prompt("Enter the name of the person commanding this to all teams:");
  if (!commander) return;

  const bundle = loadBundle();
  const searchTeams = [];
  const personnel = bundle.pages.page3 || [];
  const activeStatuses = ['Enroute', 'On-Scene', 'Hotel', 'Returning Home', 'true'];
  personnel.forEach(row => {
    const team = row[1];
    const onScene = activeStatuses.includes(row[6]);
    if (team && onScene && !['Base Support', 'Off Duty', 'Command'].includes(team)) {
      if (!searchTeams.includes(team)) searchTeams.push(team);
    }
  });

  if (searchTeams.length === 0) {
    alert("No search teams currently on scene.");
    return;
  }

  const sequence = [
    { id: 'headed to assignment', label: 'Leave Base', log: 'Leaving base for assignment' },
    { id: 'searching', label: 'Beginning Assignment', log: 'Beginning assignment' },
    { id: 'finished segment', label: 'Finish Assignment', log: 'Finished assignment' },
    { id: 'returning', label: 'Return to Base', log: 'Returning to base' }
  ];

  function getStatusIndex(status) {
    if (status === 'assigned') return -1;
    if (status === 'headed to assignment') return 0;
    if (status === 'searching') return 1;
    if (status === 'finished segment') return 2;
    if (status === 'returning') return 3;
    if (status && status.startsWith('at base')) return 4;
    return -1;
  }

  searchTeams.forEach(teamName => {
    const currentStatus = bundle.teamStatuses[teamName] || '';
    const currentIndex = getStatusIndex(currentStatus);
    const targetIndex = 3; // 'returning'

    if (currentIndex < targetIndex) {
      // Complete all steps in between
      for (let i = currentIndex + 1; i <= targetIndex; i++) {
        const step = sequence[i];
        bundle.teamStatuses[teamName] = step.id;
        if (!bundle.parChecks) bundle.parChecks = {};
        bundle.parChecks[teamName] = { lastTime: Date.now() };
        if (step.id === 'headed to assignment') {
          bundle.teamLeaveTimes[teamName] = Date.now();
        }
        addActivityLogEntry(teamName, `${step.log} (Commanded by: ${commander})`, bundle);
      }
      if (!bundle.arrivedTeams) bundle.arrivedTeams = [];
      if (!bundle.arrivedTeams.includes(teamName)) bundle.arrivedTeams.push(teamName);
    }
  });

  saveBundle(bundle);
  refreshCurrentPageTable();
}

function closePopup(overlay) {
  if (!overlay) return;
  overlay.classList.add('fade-out');
  const content = overlay.querySelector('.popup-content');
  if (content) content.classList.add('fade-out');
  setTimeout(() => overlay.remove(), 200);
}

function createPopup(titleText, originElement = null, onClose = null) {
  const overlay = document.createElement('div');
  overlay.className = 'popup-overlay';
  
  const content = document.createElement('div');
  content.className = 'popup-content expanding';
  
  // Close button (x)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'popup-close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.onclick = () => {
    if (onClose) onClose();
    closePopup(overlay);
  };
  content.appendChild(closeBtn);
  
  const origin = originElement || document.activeElement;
  if (origin && typeof origin.getBoundingClientRect === 'function') {
    const rect = origin.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        content.style.transformOrigin = `${x}px ${y}px`;
    }
  }
  
  const title = document.createElement('div');
  title.className = 'popup-title';
  title.textContent = titleText;
  content.appendChild(title);
  
  const btnContainer = document.createElement('div');
  btnContainer.className = 'popup-buttons';
  content.appendChild(btnContainer);
  
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  return overlay;
}

function addActivityLogEntry(team, action, bundle = null, membersOverride = null, customDate = null, customTime = null) {
  const b = bundle || loadBundle();
  const now = new Date();
  const dateStr = customDate || `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()}`;
  const timeStr = customTime || `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  // Determine tag: "base" or "#task"
  let tag = 'base';
  const assignment = b.currentAssignments[team] || '';
  if (assignment !== 'Base' && assignment !== 'None' && assignment !== '') {
    const match = assignment.match(/#\d+/);
    if (match) {
      tag = match[0];
    }
  }

  const currentUser = getCurrentUser();
  const userTag = currentUser ? ` - ${currentUser.handle || (currentUser.firstName + ' ' + (currentUser.lastName || '')).trim()}` : '';

  let members = '';
  if (team !== 'System') {
    members = membersOverride || getTeamMembers(team).map(m => {
      const name = m[0];
      const leadName = m[2];
      const isLead = (leadName === name);
      return isLead ? name + '*' : name;
    }).join(', ');
  }

  const ts = (customDate && customTime) ? 
    new Date(`${customDate.split('-')[2]}-${customDate.split('-')[0]}-${customDate.split('-')[1]}T${customTime}:00`).getTime() :
    Date.now();

  b.activityLog.unshift({
    id: 'log-' + ts + '-' + Math.floor(Math.random() * 1000),
    date: dateStr,
    time: timeStr,
    tag: tag + userTag,
    team: team,
    members: members,
    action: action,
    timestamp: ts
  });
  
  if (!bundle) {
    saveBundle(b);
  }
  if (isHomePage()) {
    buildHomePage();
  }
}

function logDeletion(type, name, bundle = null) {
  addActivityLogEntry('System', `Deleted ${type}: ${name || 'unknown'}`, bundle);
}

function logCreation(type, name, bundle = null) {
  addActivityLogEntry('System', `Created ${type}: ${name || 'unknown'}`, bundle);
}

function showLoginPopup() {
  const onCancel = () => {
    if (!getCurrentUser()) {
        alert('You must select a team member to continue');
        showLoginPopup();
    }
  };
  const popup = createPopup('Select Team Member', null, onCancel);
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');
  
  const bundle = loadBundle();
  const accounts = bundle.accounts || [];
  let selectedUser = getCurrentUser();

  const inputs = document.createElement('div');
  inputs.className = 'popup-input-container';
  inputs.style.flexDirection = 'column';
  inputs.style.gap = '15px';
  
  const userSelectContainer = document.createElement('div');
  userSelectContainer.style.width = '100%';
  userSelectContainer.style.display = 'flex';
  userSelectContainer.style.flexDirection = 'column';
  userSelectContainer.style.alignItems = 'center';

  const userSearchInput = document.createElement('input');
  userSearchInput.type = 'text';
  userSearchInput.placeholder = 'Type to search...';
  userSearchInput.className = 'pill-input';
  userSearchInput.style.textAlign = 'center';
  userSearchInput.value = '';
  userSelectContainer.appendChild(userSearchInput);

  const pillsContainer = document.createElement('div');
  pillsContainer.style.display = 'flex';
  pillsContainer.style.flexWrap = 'wrap';
  pillsContainer.style.justifyContent = 'center';
  pillsContainer.style.gap = '5px';
  pillsContainer.style.marginTop = '10px';
  userSelectContainer.appendChild(pillsContainer);

  const updatePills = () => {
    pillsContainer.innerHTML = '';
    const query = userSearchInput.value.toLowerCase();
    const filtered = accounts.filter(acc => 
      `${acc.firstName} ${acc.lastName}`.toLowerCase().includes(query)
    );

    filtered.forEach(acc => {
      const pill = document.createElement('button');
      pill.className = 'mini-pill';
      pill.textContent = `${acc.firstName} ${acc.lastName}`;
      if (selectedUser && selectedUser.firstName === acc.firstName && selectedUser.lastName === acc.lastName) {
          pill.style.background = 'var(--pill-bg-hover)';
          pill.style.borderColor = 'var(--accent)';
      }
      pill.onclick = () => {
        setCurrentUser(acc);
        closePopup(popup);
        window.location.reload();
      };
      pillsContainer.appendChild(pill);
    });
  };

  userSearchInput.oninput = updatePills;
  updatePills();
  inputs.appendChild(userSelectContainer);
  
  content.insertBefore(inputs, btnContainer);
  
  // Remove the Login button from btnContainer as selection immediately switches user
  btnContainer.innerHTML = '';
  
  userSearchInput.focus();
}

function showAccountManager() {
  const user = getCurrentUser();
  if (!user) return;

  const popup = createPopup('Account Manager');
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');
  content.style.maxWidth = '600px';

  const bundle = loadBundle();
  const accounts = bundle.accounts || [];

  const list = document.createElement('div');
  list.style.maxHeight = '300px';
  list.style.overflowY = 'auto';
  list.style.marginBottom = '20px';

  accounts.forEach((acc, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.padding = '10px';
    row.style.borderBottom = '1px solid var(--line)';

    const info = document.createElement('div');
    info.textContent = `${acc.firstName} ${acc.lastName} (@${acc.handle || 'no-handle'})`;
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '5px';

    const editBtn = document.createElement('button');
    editBtn.className = 'mini-pill';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => {
        popup.remove();
        showEditAccountPopup(acc, idx);
    };
    actions.appendChild(editBtn);

    if (!isUserAdmin(acc)) {
        const delBtn = document.createElement('button');
        delBtn.className = 'mini-pill';
        delBtn.style.color = 'var(--accent)';
        delBtn.textContent = 'Delete';
        delBtn.onclick = () => {
            const b = loadBundle();
            const doDelete = () => {
                bundle.accounts.splice(idx, 1);
                saveBundle(bundle);
                popup.remove();
                showAccountManager();
            };
            if (b.deleteMode) {
                doDelete();
            } else if (confirm(`Delete account ${acc.firstName}?`)) {
                doDelete();
            }
        };
        actions.appendChild(delBtn);
    }
    row.appendChild(actions);
    list.appendChild(row);
  });

  content.insertBefore(list, btnContainer);

  const addBtn = document.createElement('button');
  addBtn.className = 'popup-btn primary';
  addBtn.textContent = '+ Create New Account';
  addBtn.onclick = () => {
    popup.remove();
    showEditAccountPopup(null);
  };
  btnContainer.appendChild(addBtn);

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'popup-btn';
  logoutBtn.style.marginTop = '10px';
  logoutBtn.textContent = 'Logout';
  logoutBtn.onclick = () => {
      setCurrentUser(null);
      window.location.reload();
  };
  btnContainer.appendChild(logoutBtn);
}

function showEditAccountPopup(acc, index = -1) {
    const popup = createPopup(acc ? 'Edit Account' : 'Create Account', null, () => showAccountManager());
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');

    const inputs = document.createElement('div');
    inputs.className = 'popup-input-container';

    const fName = document.createElement('input');
    fName.className = 'pill-input';
    fName.placeholder = 'First Name';
    fName.value = acc ? acc.firstName : '';
    inputs.appendChild(fName);

    const lName = document.createElement('input');
    lName.className = 'pill-input';
    lName.placeholder = 'Last Name';
    lName.value = acc ? acc.lastName : '';
    inputs.appendChild(lName);

    const handle = document.createElement('input');
    handle.className = 'pill-input';
    handle.placeholder = 'Handle (for Log Activity)';
    handle.value = acc ? acc.handle || '' : '';
    inputs.appendChild(handle);

    const pinLabel = document.createElement('div');
    pinLabel.textContent = 'Account ID (formerly PIN):';
    pinLabel.style.marginTop = '10px';
    pinLabel.style.fontSize = '0.8rem';
    pinLabel.style.color = 'var(--muted)';
    inputs.appendChild(pinLabel);

    const pin = document.createElement('input');
    pin.className = 'pill-input';
    pin.placeholder = 'Account ID';
    pin.value = acc ? acc.pin : '';
    pin.readOnly = true; // Make it read-only as we don't want people worrying about PINs
    inputs.appendChild(pin);

    const color = document.createElement('input');
    color.type = 'color';
    color.style.width = '100%';
    color.style.height = '40px';
    color.style.border = 'none';
    color.style.background = 'transparent';
    color.value = acc ? acc.color : '#7dc6ff';
    inputs.appendChild(color);

    const pagesLabel = document.createElement('div');
    pagesLabel.textContent = 'Visible Pages:';
    pagesLabel.style.marginTop = '10px';
    pagesLabel.style.fontWeight = '700';
    inputs.appendChild(pagesLabel);

    const pagesContainer = document.createElement('div');
    pagesContainer.style.display = 'grid';
    pagesContainer.style.gridTemplateColumns = '1fr 1fr';
    pagesContainer.style.gap = '5px';

    const allPages = [
        { id: 'index', name: 'Regions' },
        { id: 'page2', name: 'Segments' },
        { id: 'page3', name: 'Personnel' },
        { id: 'sub-activity', name: 'Personnel: Activity' },
        { id: 'sub-team-reports', name: 'Personnel: Team Reports' },
        { id: 'sub-member-reports', name: 'Personnel: Member Reports' },
        { id: 'sub-all-members', name: 'Personnel: All Members' },
        { id: 'page4', name: 'Search Log' },
        { id: 'page5', name: 'Forms' },
        { id: 'page6', name: 'Profile' },
        { id: 'page7', name: 'Uploads' },
        { id: 'page10', name: 'Maps' },
        { id: 'settings', name: 'Settings' }
    ];

    allPages.forEach(p => {
        const wrap = document.createElement('label');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '5px';
        wrap.style.fontSize = '0.9rem';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = p.id;
        cb.checked = acc ? acc.visiblePages.includes(p.id) : true;
        wrap.appendChild(cb);
        wrap.appendChild(document.createTextNode(p.name));
        pagesContainer.appendChild(wrap);
    });
    inputs.appendChild(pagesContainer);

    content.insertBefore(inputs, btnContainer);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'popup-btn primary';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
        await withSaveButtonFeedback(saveBtn, async () => {
            const bundle = loadBundle();
            let finalPin = pin.value;
            if (!finalPin) {
                // Generate next sequential PIN if not provided
                let next = 1400;
                while (bundle.accounts.some(a => a.pin === next.toString())) {
                    next++;
                }
                finalPin = next.toString();
            }
            const newAcc = {
                firstName: fName.value,
                lastName: lName.value,
                handle: handle.value,
                pin: finalPin,
                color: color.value,
                visiblePages: Array.from(pagesContainer.querySelectorAll('input:checked')).map(i => i.value).concat(['home'])
            };

            // Sync to Personnel list
            if (bundle.pages && bundle.pages.page3) {
                const newName = newAcc.handle || (newAcc.firstName + ' ' + (newAcc.lastName || '')).trim();
                if (acc) {
                    const oldPin = acc.pin;
                    const oldHandle = acc.handle;
                    const oldFullName = (acc.firstName + ' ' + (acc.lastName || '')).trim();
                    bundle.pages.page3.forEach(row => {
                        const rowName = (row[0] || '').trim();
                        const rowPin = (row[8] || '').trim();
                        if ((rowPin && rowPin === oldPin) || rowName === oldHandle || rowName === oldFullName) {
                            row[0] = newName;
                            row[8] = newAcc.pin;
                        }
                    });
                } else {
                    // New account - add to Personnel if not already there
                    const exists = bundle.pages.page3.some(row => (row[0] || '').trim() === newName);
                    if (!exists) {
                        bundle.pages.page3.push([newName, '', '', '', '', '', '', '', newAcc.pin]);
                    } else {
                        // Link to existing Personnel row
                        bundle.pages.page3.forEach(row => {
                            if ((row[0] || '').trim() === newName) {
                                row[8] = newAcc.pin;
                            }
                        });
                    }
                }
            }

            if (index >= 0) {
                bundle.accounts[index] = newAcc;
            } else {
                bundle.accounts.push(newAcc);
            }
            saveBundle(bundle);
            closePopup(popup);
            showAccountManager();
        });
    };
    btnContainer.appendChild(saveBtn);
}

function updateHeaderProfile() {
    const user = getCurrentUser();
    const btn = document.getElementById('profile-btn');
    if (!btn) return;

    // Reset classes
    btn.className = 'profile-nav-btn';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';

    if (user) {
        const f = (user.firstName || '').trim().charAt(0).toUpperCase();
        const l = (user.lastName || '').trim().charAt(0).toUpperCase();
        btn.innerHTML = (f + l) || '??';
        
        if (pageKey() === 'page8') {
            btn.classList.add('active');
        }
        
        if (user.color && user.color !== 'none') {
            btn.classList.add(`profile-highlight-${user.color}`);
        } else {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text)';
        }

        btn.onclick = (e) => {
            e.preventDefault();
            navigateToPage('page8.html');
        };
    } else {
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        btn.onclick = (e) => {
            e.preventDefault();
            showLoginPopup();
        };
    }

    // Hide restricted nav items
    const navItems = document.querySelectorAll('nav a');
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (!href) return;
        const key = href.replace('.html', '');
        
        // Always show these
        if (key === 'home' || key === 'page8' || key === 'page10' || href === '#') return;
        
        // Page 9 is gone, now part of Page 8
        if (key === 'page9') {
            item.style.display = 'none';
            return;
        }
        
        if (user && user.visiblePages && !user.visiblePages.includes(key)) {
            item.style.display = 'none';
        }
    });
}

function showProfileSettingsPopup(user) {
    const popup = createPopup('Profile Settings');
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');

    const inputs = document.createElement('div');
    inputs.className = 'popup-input-container';

    const colorLabel = document.createElement('div');
    colorLabel.textContent = 'Profile Color:';
    colorLabel.style.fontWeight = '700';
    inputs.appendChild(colorLabel);

    const color = document.createElement('input');
    color.type = 'color';
    color.style.width = '100%';
    color.style.height = '40px';
    color.style.border = 'none';
    color.style.background = 'transparent';
    color.value = user.color || '#7dc6ff';
    inputs.appendChild(color);

    content.insertBefore(inputs, btnContainer);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'popup-btn primary';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
        await withSaveButtonFeedback(saveBtn, async () => {
            const bundle = loadBundle();
            const accountIndex = bundle.accounts.findIndex(a => a.pin === user.pin);
            if (accountIndex >= 0) {
                bundle.accounts[accountIndex].color = color.value;
                saveBundle(bundle);
                user.color = color.value;
                setCurrentUser(user);
                updateHeaderProfile();
            }
            popup.remove();
        });
    };
    btnContainer.appendChild(saveBtn);

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'popup-btn';
    logoutBtn.style.marginTop = '10px';
    logoutBtn.textContent = 'Logout';
    logoutBtn.onclick = () => {
        setCurrentUser(null);
        window.location.reload();
    };
    btnContainer.appendChild(logoutBtn);
}

let currentLogTeamFilter = null;

function updateActivityLogUI() {
  const logBox = document.getElementById('activity-log');
  const searchInput = document.getElementById('log-search');
  const teamFilters = document.getElementById('log-team-filters');
  if (!logBox) return;
  
  const bundle = loadBundle();
  logBox.innerHTML = '';
  
  if (teamFilters) {
      teamFilters.innerHTML = '';
      const teams = Array.from(new Set(bundle.activityLog.map(e => e.team).filter(t => t && t !== 'System'))).sort();
      
      const allBtn = document.createElement('button');
      allBtn.className = 'mini-pill' + (!currentLogTeamFilter ? ' active' : '');
      allBtn.textContent = 'All Teams';
      allBtn.onclick = () => { currentLogTeamFilter = null; updateActivityLogUI(); };
      teamFilters.appendChild(allBtn);
      
      teams.forEach(t => {
          const btn = document.createElement('button');
          btn.className = 'mini-pill' + (currentLogTeamFilter === t ? ' active' : '');
          btn.textContent = t;
          btn.onclick = () => { 
              currentLogTeamFilter = (currentLogTeamFilter === t) ? null : t; 
              updateActivityLogUI(); 
          };
          teamFilters.appendChild(btn);
      });
  }

  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
  
  if (searchInput && !searchInput.dataset.listenerAdded) {
    searchInput.addEventListener('input', updateActivityLogUI);
    searchInput.dataset.listenerAdded = 'true';
  }

  bundle.activityLog.forEach(entry => {
    const datePart = entry.date || '';
    const timePart = entry.time || '';
    const teamPart = entry.team || '';
    const membersPart = entry.members || '';
    const tagPart = entry.tag || 'base';
    const displayTag = tagPart.split(' - ')[0];
    const actionPart = entry.action || '';
    
    if (currentLogTeamFilter && teamPart !== currentLogTeamFilter) return;

    if (searchTerm) {
      const combined = `${datePart} ${timePart} ${teamPart} ${membersPart} ${tagPart} ${actionPart}`.toLowerCase();
      if (!combined.includes(searchTerm)) return;
    }

    const div = document.createElement('div');
    div.className = 'activity-log-entry';
    div.style.display = 'flex';
    div.style.alignItems = 'flex-start';
    div.style.gap = '10px';
    div.style.padding = '8px 0';
    
    const timePillContainer = createLogTimestampPill(entry);
    div.appendChild(timePillContainer);
    
    const infoSpan = document.createElement('span');
    if (teamPart === 'System') {
      infoSpan.textContent = ` ${actionPart}`;
    } else {
      infoSpan.textContent = ` Team ${teamPart} (${membersPart}) [${displayTag}]: ${actionPart}`;
    }
    div.appendChild(infoSpan);
    
    logBox.appendChild(div);
  });
}

function createLogTimestampPill(entry) {
  const container = document.createElement('div');
  container.className = 'pill-cell-container';
  container.style.justifyContent = 'flex-start';
  container.style.width = 'auto';

  const pill = document.createElement('div');
  pill.className = 'mini-pill clickable-pill';
  pill.style.fontSize = '0.75rem';
  pill.textContent = `${entry.date} ${entry.time}`;
  pill.onclick = (e) => {
    e.stopPropagation();
    showEditLogTimePopup(entry);
  };
  container.appendChild(pill);

  if (entry.tag && entry.tag.includes(' - ')) {
    const parts = entry.tag.split(' - ');
    const userName = parts[1];
    const userPill = document.createElement('div');
    userPill.className = 'mini-pill log-user-pill';
    userPill.style.fontSize = '0.7rem';
    userPill.style.background = 'rgba(255,255,255,0.05)';
    userPill.style.borderColor = 'rgba(255,255,255,0.1)';
    userPill.textContent = userName;
    container.appendChild(userPill);
  } else if (entry.team === 'System' && entry.tag === 'base') {
    const currentUser = getCurrentUser();
    if (currentUser) {
      const userPill = document.createElement('div');
      userPill.className = 'mini-pill log-user-pill';
      userPill.style.fontSize = '0.7rem';
      userPill.style.background = 'rgba(255,255,255,0.05)';
      userPill.style.borderColor = 'rgba(255,255,255,0.1)';
      userPill.textContent = currentUser.handle || (currentUser.firstName + ' ' + (currentUser.lastName || '')).trim();
      container.appendChild(userPill);
    }
  }

  if (entry.originalDate && entry.originalTime) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'mini-pill update-pill';
    resetBtn.style.padding = '0 5px';
    resetBtn.style.fontSize = '0.8rem';
    resetBtn.textContent = '↺';
    resetBtn.onclick = (e) => {
      e.stopPropagation();
      const oldTimestamp = entry.timestamp;
      entry.date = entry.originalDate;
      entry.time = entry.originalTime;
      
      const [lm, ld, ly] = entry.date.split('-').map(Number);
      const [lh, lmin] = entry.time.split(':').map(Number);
      const resetTimestamp = new Date(ly, lm - 1, ld, lh, lmin).getTime();
      
      delete entry.originalDate;
      delete entry.originalTime;
      const bundle = loadBundle();
      const idx = bundle.activityLog.findIndex(l => l.timestamp === oldTimestamp);
      if (idx > -1) {
        entry.timestamp = resetTimestamp;
        bundle.activityLog[idx] = entry;
        bundle.activityLog.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        saveBundle(bundle);
        refreshCurrentPageTable();
      }
    };
    container.appendChild(resetBtn);
  }

  return container;
}

function showEditLogTimePopup(entry) {
  const popup = createPopup('Edit Timestamp');
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');

  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.gap = '15px';
  container.style.marginBottom = '20px';

  const dateInput = document.createElement('input');
  dateInput.type = 'text';
  dateInput.className = 'form-input';
  dateInput.style.borderRadius = '8px';
  dateInput.style.textAlign = 'center';
  dateInput.placeholder = 'MM-DD-YYYY';
  dateInput.value = entry.date;
  dateInput.oninput = () => {
    let cursor = dateInput.selectionStart;
    let oldVal = dateInput.value;
    let val = dateInput.value.replace(/\D/g, '');
    let newVal = '';
    if (val.length > 0) newVal += val.substring(0, 2);
    if (val.length > 2) newVal += '-' + val.substring(2, 4);
    if (val.length > 4) newVal += '-' + val.substring(4, 8);
    dateInput.value = newVal;
    if (cursor === oldVal.length) dateInput.setSelectionRange(newVal.length, newVal.length);
  };

  const timeInput = document.createElement('input');
  timeInput.type = 'text';
  timeInput.className = 'form-input';
  timeInput.style.borderRadius = '8px';
  timeInput.style.textAlign = 'center';
  timeInput.placeholder = 'HH:MM';
  timeInput.value = entry.time;
  timeInput.oninput = () => {
    let cursor = timeInput.selectionStart;
    let oldVal = timeInput.value;
    let val = timeInput.value.replace(/\D/g, '');
    let newVal = '';
    if (val.length > 0) newVal += val.substring(0, 2);
    if (val.length > 2) newVal += ':' + val.substring(2, 4);
    timeInput.value = newVal;
    if (cursor === oldVal.length) timeInput.setSelectionRange(newVal.length, newVal.length);
  };

  container.appendChild(dateInput);
  container.appendChild(timeInput);
  content.insertBefore(container, btnContainer);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'popup-btn primary';
  saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
        await withSaveButtonFeedback(saveBtn, async () => {
            const dMatch = dateInput.value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
            const tMatch = timeInput.value.match(/^(\d{2}):(\d{2})$/);
            if (dMatch && tMatch) {
                if (!entry.originalDate) {
                    entry.originalDate = entry.date;
                    entry.originalTime = entry.time;
                }
                const oldTimestamp = entry.timestamp;
                entry.date = dateInput.value;
                entry.time = timeInput.value;
                
                const [lm, ld, ly] = entry.date.split('-').map(Number);
                const [lh, lmin] = entry.time.split(':').map(Number);
                const newTimestamp = new Date(ly, lm - 1, ld, lh, lmin).getTime();

                const bundle = loadBundle();
                const idx = bundle.activityLog.findIndex(l => l.timestamp === oldTimestamp);
                if (idx > -1) {
                    entry.timestamp = newTimestamp;
                    bundle.activityLog[idx] = entry;
                    bundle.activityLog.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    saveBundle(bundle);
                    refreshCurrentPageTable();
                }
                closePopup(popup);
            } else {
                alert('Invalid format. Use MM-DD-YYYY and HH:MM');
            }
        });
  };
  btnContainer.appendChild(saveBtn);
}

function printCurrentReport(type) {
  const bundle = loadBundle();
  const log = bundle.activityLog || [];
  let title = '';
  let filteredLogs = [];

  if (type === 'team') {
    const filterContainer = document.getElementById('team-report-filters');
    const activeTeam = filterContainer ? filterContainer.dataset.activeTeam : null;
    if (!activeTeam) { alert('Please select a team first.'); return; }
    title = `Team Activity Report: ${activeTeam}`;
    filteredLogs = log.filter(e => e.team === activeTeam);
  } else {
    if (!currentMemberReportSelection) { alert('Please select a member first.'); return; }
    title = `Member Activity Report: ${currentMemberReportSelection}`;
    filteredLogs = log.filter(e => {
      if (!e.members) return false;
      const mList = e.members.split(', ').map(m => m.replace('*', '').trim());
      return mList.includes(currentMemberReportSelection);
    });
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert("Please allow popups to view the printout."); return; }

  const style = `
    @page { size: auto; margin: 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; margin: 0; padding: 0; }
    .print-container { max-width: 8.5in; margin: 0 auto; padding: 20px; }
    h1 { font-size: 18pt; border-bottom: 2px solid #000; margin: 0 0 15px 0; padding-bottom: 5px; }
    .activity-log { font-size: 10pt; line-height: 1.0; }
    .activity-log-entry { margin-bottom: 1px; }
    .activity-log-time { font-weight: bold; margin-right: 5px; }
    .no-print { text-align: center; margin-bottom: 20px; padding: 10px; background: #f0f2f5; }
    @media print { .no-print { display: none; } }
  `;

  let htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>${title}</title>
      <style>${style}</style>
    </head>
    <body>
      <div class="no-print">
        <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 999px;">Print PDF</button>
      </div>
      <div class="print-container">
        <h1>${title}</h1>
        <div class="activity-log">
  `;

  filteredLogs.forEach(entry => {
    const tagPart = entry.tag || 'base';
    const displayTag = tagPart.split(' - ')[0];
    const userName = tagPart.includes(' - ') ? tagPart.split(' - ')[1] : '';
    
    htmlContent += '<div class="activity-log-entry">';
    htmlContent += `<span class="activity-log-time">[${entry.date} ${entry.time} ${displayTag}${userName ? ' (' + userName + ')' : ''}]</span> `;
    htmlContent += `Team ${entry.team} (${entry.members}): ${entry.action}`;
    htmlContent += '</div>';
  });

  htmlContent += `
        </div>
      </div>
      <script>
        setTimeout(() => { window.print(); }, 500);
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
}

function printAllReports(type) {
    const bundle = loadBundle();
    const log = bundle.activityLog || [];
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert("Please allow popups to view the printout."); return; }

    const style = `
      @page { size: auto; margin: 10mm; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; margin: 0; padding: 0; }
      .print-container { max-width: 8.5in; margin: 0 auto; padding: 20px; }
      .print-section { page-break-after: always; padding: 20px 0; }
      .print-section:last-child { page-break-after: auto; }
      h1 { font-size: 18pt; border-bottom: 2px solid #000; margin: 0 0 15px 0; padding-bottom: 5px; }
      .activity-log { font-size: 10pt; line-height: 1.0; }
      .activity-log-entry { margin-bottom: 1px; }
      .activity-log-time { font-weight: bold; margin-right: 5px; }
      .no-print { text-align: center; margin-bottom: 20px; padding: 10px; background: #f0f2f5; }
      @media print { .no-print { display: none; } }
    `;

    let htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>All Reports</title>
        <style>${style}</style>
      </head>
      <body>
        <div class="no-print">
          <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 999px;">Print PDF</button>
        </div>
        <div class="print-container">
    `;
    
    if (type === 'team') {
        const teams = Array.from(new Set(log.map(e => e.team).filter(Boolean))).sort();
        teams.forEach(team => {
            htmlContent += '<div class="print-section">';
            htmlContent += `<h1>Team Activity Report: ${team}</h1>`;
            htmlContent += '<div class="activity-log">';
            log.filter(e => e.team === team).forEach(entry => {
                const tagPart = entry.tag || 'base';
                const displayTag = tagPart.split(' - ')[0];
                const userName = tagPart.includes(' - ') ? tagPart.split(' - ')[1] : '';
                htmlContent += `<div class="activity-log-entry"><span class="activity-log-time">[${entry.date} ${entry.time} ${displayTag}${userName ? ' (' + userName + ')' : ''}]</span> Team ${entry.team} (${entry.members}): ${entry.action}</div>`;
            });
            htmlContent += '</div></div>';
        });
    } else {
        const membersData = bundle.pages.page3 || [];
        const members = Array.from(new Set(membersData.map(m => m[0]).filter(Boolean))).sort();
        members.forEach(member => {
            const memberLogs = log.filter(e => {
                if (!e.members) return false;
                const mList = e.members.split(', ').map(m => m.replace('*', '').trim());
                return mList.includes(member);
            });
            if (memberLogs.length > 0) {
                htmlContent += '<div class="print-section">';
                htmlContent += `<h1>Member Activity Report: ${member}</h1>`;
                htmlContent += '<div class="activity-log">';
                memberLogs.forEach(entry => {
                    const tagPart = entry.tag || 'base';
                    const displayTag = tagPart.split(' - ')[0];
                    const userName = tagPart.includes(' - ') ? tagPart.split(' - ')[1] : '';
                    htmlContent += `<div class="activity-log-entry"><span class="activity-log-time">[${entry.date} ${entry.time} ${displayTag}${userName ? ' (' + userName + ')' : ''}]</span> Team ${entry.team} (${entry.members}): ${entry.action}</div>`;
                });
                htmlContent += '</div></div>';
            }
        });
    }

    htmlContent += `
        </div>
        <script>
          setTimeout(() => { window.print(); }, 500);
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
}

function buildTeamReports() {
  const filterContainer = document.getElementById('team-report-filters');
  const tableBody = document.getElementById('team-reports-body');
  if (!filterContainer || !tableBody) return;

  const bundle = loadBundle();
  const logs = bundle.activityLog || [];
  const teams = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu', 'Command', 'Off Duty', 'Base Support'];

  filterContainer.innerHTML = '';
  tableBody.innerHTML = '';

  teams.forEach(teamName => {
    const btn = document.createElement('button');
    btn.className = 'sub-nav-btn';
    btn.style.fontSize = '0.8rem';
    btn.style.padding = '5px 10px';
    btn.textContent = teamName;
    if (filterContainer.dataset.activeTeam === teamName) btn.classList.add('active');
    btn.onclick = () => {
      filterContainer.dataset.activeTeam = teamName;
      buildTeamReports();
    };
    filterContainer.appendChild(btn);
  });

  const activeTeam = filterContainer.dataset.activeTeam;
  if (!activeTeam) return;

  const filteredLogs = logs.filter(log => log.team === activeTeam);
  
  filteredLogs.forEach(entry => {
    const tr = document.createElement('tr');
    tr.className = 'report-row';
    
    const tdTime = document.createElement('td');
    tdTime.dataset.label = 'Timestamp';
    tdTime.appendChild(createLogTimestampPill(entry));
    tr.appendChild(tdTime);
    
    const tdTeam = document.createElement('td');
    tdTeam.dataset.label = 'Team';
    const teamPill = document.createElement('div');
    teamPill.className = 'mini-pill readonly-pill';
    teamPill.textContent = entry.team || '';
    tdTeam.appendChild(teamPill);
    tr.appendChild(tdTeam);
    
    const tdMembers = document.createElement('td');
    tdMembers.dataset.label = 'Members';
    const memberContainer = document.createElement('div');
    memberContainer.className = 'pill-container';
    memberContainer.style.justifyContent = 'flex-start';
    
    if (entry.members) {
      const members = entry.members.split(', ').map(m => m.trim());
      members.sort((a, b) => (b.endsWith('*') ? -1 : 1));
      members.forEach(m => {
        const pill = document.createElement('div');
        pill.className = 'mini-pill readonly-pill';
        if (m.endsWith('*')) {
          pill.style.background = 'var(--pill-focus)';
          pill.style.borderColor = 'var(--accent)';
          pill.style.fontWeight = '700';
        }
        pill.textContent = m;
        memberContainer.appendChild(pill);
      });
    }
    tdMembers.appendChild(memberContainer);
    tr.appendChild(tdMembers);
    
    const tagPart = entry.tag || 'base';
    const displayTag = tagPart.split(' - ')[0];
    const tdActivity = document.createElement('td');
    tdActivity.dataset.label = 'Activity';
    tdActivity.textContent = `[${displayTag}] ${entry.action}`;
    tr.appendChild(tdActivity);
    
    tableBody.appendChild(tr);
  });
}

function renderMemberIncidentCards(memberName, container) {
    if (!container) return;
    container.innerHTML = '';
    
    const bundle = loadBundle();
    const allRows = (bundle.pages.page3 || []).filter(r => r[0] === memberName);
    if (allRows.length === 0) return;

    const cardsWrapper = document.createElement('div');
    cardsWrapper.className = 'incident-times-container';

    allRows.forEach((pRow, index) => {
        const card = document.createElement('div');
        card.className = 'incident-card';
        
        const header = document.createElement('div');
        header.className = 'incident-card-header';
        
        const title = document.createElement('div');
        title.className = 'incident-card-title';
        title.textContent = `Incident Set ${index + 1}`;
        header.appendChild(title);

        const delBtn = document.createElement('div');
        delBtn.className = 'delete-card-btn no-print';
        delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('Delete this incident row?')) {
                const page3 = bundle.pages.page3 || [];
                // Find the absolute index in page3
                const absoluteIndex = page3.indexOf(pRow);
                if (absoluteIndex > -1) {
                    page3.splice(absoluteIndex, 1);
                    saveBundle(bundle);
                    renderMemberIncidentCards(memberName, container);
                }
            }
        };
        header.appendChild(delBtn);
        card.appendChild(header);
        
        const grid = document.createElement('div');
        grid.className = 'incident-times-grid';
        
        const fields = [
            { key: 'enroute', idx: 9, label: 'Enroute' },
            { key: 'onScene', idx: 10, label: 'On Scene' },
            { key: 'returning', idx: 11, label: 'Returning' },
            { key: 'arrived', idx: 12, label: 'Arrived Home' }
        ];
        
        fields.forEach(f => {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.onclick = () => {
                showTimePrompt(`Set ${f.label}`, (d, t) => {
                    pRow[f.idx] = t;
                    saveBundle(bundle);
                    renderMemberIncidentCards(memberName, container);
                }, null, pRow[f.idx] || null, (popup) => {
                    const btnContainer = popup.querySelector('.popup-buttons');
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'popup-btn';
                    clearBtn.style.marginRight = 'auto';
                    clearBtn.style.color = '#eb5757';
                    clearBtn.textContent = 'Clear Info';
                    clearBtn.onclick = () => {
                        pRow[f.idx] = '';
                        saveBundle(bundle);
                        renderMemberIncidentCards(memberName, container);
                        popup.remove();
                    };
                    btnContainer.insertBefore(clearBtn, btnContainer.firstChild);
                });
            };
            
            const lbl = document.createElement('div');
            lbl.className = 'time-slot-label';
            lbl.textContent = f.label;
            slot.appendChild(lbl);
            
            const val = document.createElement('div');
            val.className = 'time-slot-value';
            if (pRow[f.idx]) {
                val.textContent = pRow[f.idx];
            } else {
                val.className += ' add-time-btn-small';
                val.textContent = '+';
            }
            slot.appendChild(val);
            grid.appendChild(slot);
        });
        card.appendChild(grid);
        cardsWrapper.appendChild(card);
    });
    
    // Add "Add Incident Row" button back as requested in previous requirements
    const placeholder = document.createElement('div');
    placeholder.className = 'add-card-placeholder no-print';
    placeholder.onclick = () => {
        const page3 = bundle.pages.page3 || [];
        // Create a new row for the same member
        // Assuming the structure from previous knowledge: member name is index 0
        const firstRow = allRows[0];
        const newRow = [...firstRow];
        // Clear incident times in the new row (indexes 9-12)
        newRow[9] = '';
        newRow[10] = '';
        newRow[11] = '';
        newRow[12] = '';
        // Clear old sets JSON if it exists
        if (newRow[13]) newRow[13] = '';
        
        page3.push(newRow);
        saveBundle(bundle);
        renderMemberIncidentCards(memberName, container);
    };
    
    const icon = document.createElement('div');
    icon.className = 'add-card-icon';
    icon.textContent = '+';
    placeholder.appendChild(icon);
    
    const txt = document.createElement('div');
    txt.className = 'add-card-text';
    txt.textContent = 'Add Incident Row';
    placeholder.appendChild(txt);
    
    cardsWrapper.appendChild(placeholder);
    container.appendChild(cardsWrapper);
}

let currentMemberReportSelection = '';

function buildMemberReports() {
  const btn = document.getElementById('member-report-btn');
  const tableBody = document.getElementById('member-reports-body');
  if (!btn || !tableBody) return;

  const bundle = loadBundle();
  const logs = bundle.activityLog || [];
  
  const allMembers = bundle.pages.page3 || [];

  btn.textContent = currentMemberReportSelection ? `Member: ${currentMemberReportSelection}` : 'Select Member...';
  btn.onclick = () => {
    const popup = createPopup('Select Member');
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');
    
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexWrap = 'wrap';
    list.style.gap = '10px';
    list.style.marginBottom = '20px';
    list.style.maxHeight = '400px';
    list.style.overflowY = 'auto';
    
    allMembers.filter(m => m[0]).forEach(mRow => {
      const mBtn = document.createElement('button');
      mBtn.className = 'mini-pill';
      mBtn.textContent = mRow[0];
      mBtn.onclick = () => {
        currentMemberReportSelection = mRow[0];
        closePopup(popup);
        buildMemberReports();
      };
      list.appendChild(mBtn);
    });

    content.insertBefore(list, btnContainer);
  };

  tableBody.innerHTML = '';
  
  // Clear any existing incident cards container
  const existingCards = document.getElementById('member-incident-cards');
  if (existingCards) existingCards.remove();

  if (!currentMemberReportSelection) return;

  // Add Incident Cards
  const cardsContainer = document.createElement('div');
  cardsContainer.id = 'member-incident-cards';
  tableBody.parentElement.before(cardsContainer);
  renderMemberIncidentCards(currentMemberReportSelection, cardsContainer);

  const filteredLogs = logs.filter(log => {
    if (!log.members) return false;
    const members = log.members.split(', ').map(m => m.replace('*', '').trim());
    return members.includes(currentMemberReportSelection);
  });

  filteredLogs.forEach(entry => {
    const tr = document.createElement('tr');
    tr.className = 'report-row';
    
    const tdTime = document.createElement('td');
    tdTime.dataset.label = 'Timestamp';
    tdTime.appendChild(createLogTimestampPill(entry));
    tr.appendChild(tdTime);
    
    const tdTeam = document.createElement('td');
    tdTeam.dataset.label = 'Team';
    const teamPill = document.createElement('div');
    teamPill.className = 'mini-pill readonly-pill';
    teamPill.textContent = entry.team || '';
    tdTeam.appendChild(teamPill);
    tr.appendChild(tdTeam);
    
    const tdMembers = document.createElement('td');
    tdMembers.dataset.label = 'Members';
    const memberContainer = document.createElement('div');
    memberContainer.className = 'pill-container';
    memberContainer.style.justifyContent = 'flex-start';
    
    if (entry.members) {
      const members = entry.members.split(', ').map(m => m.trim());
      members.sort((a, b) => (b.endsWith('*') ? -1 : 1));
      members.forEach(m => {
        const pill = document.createElement('div');
        pill.className = 'mini-pill readonly-pill';
        if (m.endsWith('*')) {
          pill.style.background = 'var(--pill-focus)';
          pill.style.borderColor = 'var(--accent)';
          pill.style.fontWeight = '700';
        }
        pill.textContent = m;
        memberContainer.appendChild(pill);
      });
    }
    tdMembers.appendChild(memberContainer);
    tr.appendChild(tdMembers);
    
    const tagPart = entry.tag || 'base';
    const displayTag = tagPart.split(' - ')[0];
    const tdActivity = document.createElement('td');
    tdActivity.dataset.label = 'Activity';
    tdActivity.textContent = `[${displayTag}] ${entry.action}`;
    tr.appendChild(tdActivity);
    
    tableBody.appendChild(tr);
  });
}

function recountTeamMembersForSearchLog() {
  const bundle = loadBundle();
  const logData = bundle.pages.page4 || [];
  const personnelData = bundle.pages.page3 || [];
  const activityLog = bundle.activityLog || [];

  let changed = false;

  logData.forEach(entry => {
    const taskNum = entry[0];
    const teamCell = entry[7] || '';
    
    let teamName = teamCell;
    const match = teamCell.match(/^(.*)\s\(\d+\)$/);
    if (match) {
       teamName = match[1].trim();
    } else {
       teamName = teamCell.trim();
    }
    if (!teamName) return;

    const dateStr = entry[1];
    const timeStr = entry[2];
    if (!dateStr || !timeStr) return;
    
    const [m, d, y] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    const assignmentTime = new Date(y, m - 1, d, h, min).getTime();

    const currentMembersCount = personnelData.filter(row => row[1] === teamName).length;

    let addedCount = 0;
    let removedCount = 0;

    activityLog.forEach(log => {
      let logTime;
      if (log.date && log.time) {
        const [lm, ld, ly] = log.date.split('-').map(Number);
        const [lh, lmin] = log.time.split(':').map(Number);
        logTime = new Date(ly, lm - 1, ld, lh, lmin).getTime();
      } else {
        logTime = log.timestamp;
      }
      if (!logTime) return;

      if (logTime > assignmentTime) {
         const action = log.action || '';
         const reassignMatch = action.match(/reassigned from (.*?) to (.*)$/i);
         const moveMatch = action.match(/moved from team (.*?) to (.*)$/i);
         
         let fromTeam = null;
         let toTeam = null;

         if (reassignMatch) {
             fromTeam = reassignMatch[1].trim();
             toTeam = reassignMatch[2].trim();
         } else if (moveMatch) {
             fromTeam = moveMatch[1].trim();
             toTeam = moveMatch[2].trim();
         }
         
         if (toTeam === teamName) {
             addedCount++;
         }
         if (fromTeam === teamName) {
             removedCount++;
         }
      }
    });

    const countAtAssignment = currentMembersCount - addedCount + removedCount;
    const finalCount = Math.max(0, countAtAssignment);

    const newTeamCell = `${teamName} (${finalCount})`;
    if (entry[7] !== newTeamCell) {
       entry[7] = newTeamCell;
       changed = true;
    }
  });

  if (changed) {
    bundle.pages.page4 = logData;
    saveBundle(bundle);
    buildSearchLogTable();
    showToast('Team member counts updated based on assignment times.');
  } else {
    showToast('All search log member counts are up to date.');
  }
}

function buildSearchLogTable() {
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  const clearBtn = document.getElementById('clear-table');
  const sortToggle = document.getElementById('sort-toggle');
  const sortLabel = document.getElementById('sort-label');

  recalculateEverything();
  const data = loadData();
  const bundle = loadBundle();

  // Identify unfinished tasks from team assignments and statuses
  const unfinishedTasks = new Set();
  if (bundle.currentAssignments && bundle.teamStatuses) {
    for (const team in bundle.currentAssignments) {
      const status = bundle.teamStatuses[team] || '';
      const assignment = bundle.currentAssignments[team] || '';
      // A task is unfinished if the team status is not "at base" and they have an assignment with a task number
      if (!status.includes('at base') && assignment !== 'Base' && assignment !== 'None' && assignment !== '') {
        const match = assignment.match(/#(\d+)/);
        if (match) {
          unfinishedTasks.add(`#${match[1]}`);
        }
      }
    }
  }

  // Recalculate PSR After for all entries (now handled by recalculateEverything above)
  saveCurrentPageData(data);

  const user = getCurrentUser();
  const account = user ? (bundle.accounts || []).find(a => a.pin === user.pin) : null;

  const isRecentFirst = account ? !!account.searchLogSortRecentFirst : (sortToggle && sortToggle.checked);
  if (sortToggle) {
    sortToggle.checked = isRecentFirst;
  }

  if (sortLabel) {
    sortLabel.textContent = isRecentFirst ? 'Sorted by Most Recent at Top' : 'Sorted Chronologically (Oldest at Top)';
  }

  const sortedData = [...data].sort((a, b) => {
    // Column 1: MM-DD-YYYY, Column 2: HH:mm
    const [m1, d1, y1] = (a[1] || '').split('-').map(Number);
    const [m2, d2, y2] = (b[1] || '').split('-').map(Number);
    const [h1, min1] = (a[2] || '').split(':').map(Number);
    const [h2, min2] = (b[2] || '').split(':').map(Number);

    const date1 = new Date(y1 || 0, (m1 || 1) - 1, d1 || 1, h1 || 0, min1 || 0);
    const date2 = new Date(y2 || 0, (m2 || 1) - 1, d2 || 1, h2 || 0, min2 || 0);

    if (isRecentFirst) {
      return date2 - date1; // Newest at Top (Descending)
    } else {
      return date1 - date2; // Oldest at Top (Ascending)
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('scroll') === 'latest') {
      const absoluteLatest = [...sortedData].sort((a, b) => {
           const [m1, d1, y1] = (a[1] || '').split('-').map(Number);
           const [m2, d2, y2] = (b[1] || '').split('-').map(Number);
           const [h1, min1] = (a[2] || '').split(':').map(Number);
           const [h2, min2] = (b[2] || '').split(':').map(Number);
           const date1 = new Date(y1 || 0, (m1 || 1) - 1, d1 || 1, h1 || 0, min1 || 0);
           const date2 = new Date(y2 || 0, (m2 || 1) - 1, d2 || 1, h2 || 0, min2 || 0);
           return date2 - date1;
      })[0];
      highlightedRowIndex = sortedData.indexOf(absoluteLatest);
  }

  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  const headers = ['Task #', 'Date', 'Time', 'Region', 'Segment', 'PSR Before', 'PSR After', 'Team', 'Sweep Width (ft)', 'Num of Sweeps', 'Delete'];
  const headerRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.className = 'fixed-header';
    if (h === 'Team') {
      const recountBtn = document.createElement('button');
      recountBtn.className = 'mini-pill';
      recountBtn.style.marginTop = '4px';
      recountBtn.style.display = 'block';
      recountBtn.style.cursor = 'pointer';
      recountBtn.style.fontSize = '0.7em';
      recountBtn.style.padding = '2px 6px';
      recountBtn.textContent = 'Recount';
      recountBtn.onclick = (e) => {
         e.stopPropagation();
         recountTeamMembersForSearchLog();
      };
      th.appendChild(recountBtn);
    }
    headerRow.appendChild(th);
  });
  tableHead.appendChild(headerRow);

  for (let r = 0; r < sortedData.length; r++) {
    const tr = document.createElement('tr');
    animateNewRow(tr, r);
    
    // index 7 is team
    if (sortedData[r][7]) {
        // Handle team names like "Team 1 (3)" by extracting the name
        const fullTeamStr = sortedData[r][7];
        const teamNameMatch = fullTeamStr.match(/^(.*?)\s*\(/) || [null, fullTeamStr];
        const teamName = teamNameMatch[1].trim();
        animateArrivedRow(tr, teamName);
    }
    
    // Highlight if task is unfinished
    const taskNum = sortedData[r][0];
    if (unfinishedTasks.has(taskNum)) {
      tr.classList.add('unfinished-row');
    }

    // If this is the last entry by chronological order and we just arrived, we might scroll to it
    // But since it's sorted, latest might be top or bottom.
    
    const headers = ['Task #', 'Date', 'Time', 'Region', 'Segment', 'PSR Before', 'PSR After', 'Team', 'Sweep Width (ft)', 'Num of Sweeps', 'Delete'];
    for (let c = 0; c < 10; c++) {
      const td = document.createElement('td');
      td.dataset.label = headers[c];
      const cellContainer = document.createElement('div');
      cellContainer.className = 'pill-cell-container';

      const cell = document.createElement('div');
      cell.className = 'pill-cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      const cellValue = sortedData[r][c] || '';
      
      // index 7: Team, show as team pill if it looks like "TeamName (Count)"
      if (c === 7 && cellValue.includes('(') && cellValue.includes(')')) {
          const pill = document.createElement('div');
          pill.className = 'mini-pill readonly-pill';
          pill.textContent = cellValue;
          cell.appendChild(pill);
          cell.classList.add('readonly-pill');

          const teamName = cellValue.split(' (')[0];
          cell.style.cursor = 'pointer';
          cell.onclick = () => showTeamUpdatePopup(teamName);
          
          if (unfinishedTasks.has(taskNum)) {
            // Highlight orange if par check due
            if (isParCheckDue(teamName, bundle)) {
              cell.classList.add('par-check-due');
            }
            // Show progress bar
            const status = bundle.teamStatuses[teamName] || '';
            const progress = getTaskProgressPercent(status);
            cell.appendChild(createProgressBar(progress, taskNum));
          }
      } else {
          cell.textContent = cellValue;
      }
      
      cell.spellcheck = false;

      // Highlight Team (7) and Num of Sweeps (9) when blank
      if ([7, 9].includes(c) && cellValue === '') {
        cell.classList.add('blank-highlight');
      }

      // Read-only columns: Task # (0), Region (3), Segment (4), PSR Before (5), PSR After (6), and Team if it's a pill (7)
      const isReadonly = [0, 3, 4, 5, 6].includes(c) || (c === 7 && cellValue.includes('('));
      if (isReadonly) {
        cell.classList.add('readonly-pill');
      } else {
        cell.contentEditable = 'true';
      }

      cell.addEventListener('input', () => {
        if ([7, 9].includes(c)) {
          if (cell.textContent.trim() === '') {
            cell.classList.add('blank-highlight');
          } else {
            cell.classList.remove('blank-highlight');
          }
        }
        let val = cell.textContent.replace(/[^\d]/g, '');
        if (c === 1) { // Date MM-DD-YYYY
          if (val.length > 8) val = val.slice(0, 8);
          let formatted = val;
          if (val.length > 4) {
            formatted = val.slice(0, 2) + '-' + val.slice(2, 4) + '-' + val.slice(4);
          } else if (val.length > 2) {
            formatted = val.slice(0, 2) + '-' + val.slice(2);
          }
          if (cell.textContent !== formatted) {
            cell.textContent = formatted;
            // Simple caret restoration (approximate)
            try {
               placeCaretAtEnd(cell);
            } catch(e){}
          }
        } else if (c === 2) { // Time hh:mm
          if (val.length > 4) val = val.slice(0, 4);
          let formatted = val;
          if (val.length > 2) {
            formatted = val.slice(0, 2) + ':' + val.slice(2);
          }
          if (cell.textContent !== formatted) {
            cell.textContent = formatted;
            try {
              placeCaretAtEnd(cell);
            } catch(e){}
          }
        }
      });

      cell.addEventListener('blur', () => {
        // Need to find original row index if we are editing in sorted view
        const originalRow = sortedData[r];
        const oldVal = originalRow[c];
        const newVal = cell.textContent.trim();
        originalRow[c] = newVal;
        
        // If Num of Sweeps (9), Sweep Width (8), or Team (7) was changed, recalculate PSR After (6)
        if ([7, 8, 9].includes(c)) {
          const bundle = loadBundle();
          originalRow[6] = calculatePSRAfter(originalRow, bundle);
          
          if (c === 9 && oldVal !== newVal) {
              // If sweeps filled, we might need to update nav immediately
              recalculateEverything();
          }
        }
        
        saveCurrentPageData(data);
        buildSearchLogTable(); // Re-render to show updated PSR After and handle cascading if needed
      });

      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          cell.blur();
          focusCell(Math.min(r + 1, sortedData.length - 1), c);
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          cell.blur();
          const nextCol = event.shiftKey ? Math.max(c - 1, 0) : Math.min(c + 1, 9);
          focusCell(r, nextCol);
        }
      });

      cellContainer.appendChild(cell);

      td.appendChild(cellContainer);
      tr.appendChild(td);
    }

    // New Delete Column
    const deleteTd = document.createElement('td');
    deleteTd.dataset.label = 'Delete';
    const deleteContainer = document.createElement('div');
    deleteContainer.className = 'pill-cell-container';
    const delBtn = document.createElement('button');
    delBtn.className = 'row-delete-btn';
    delBtn.textContent = 'Delete';
    delBtn.type = 'button';
    delBtn.onclick = () => {
      confirmDeleteRow(tr, () => {
        const rowToDelete = sortedData[r];
        const indexInData = data.indexOf(rowToDelete);
        if (indexInData > -1) {
            const taskNum = rowToDelete[0]; // e.g. "#1"
            let bundle = loadBundle();
            let changed = false;
            
            if (bundle.currentAssignments && taskNum) {
                for (const team in bundle.currentAssignments) {
                    const assignment = bundle.currentAssignments[team] || '';
                    if (assignment.startsWith(taskNum + ' ')) {
                        const now = new Date();
                        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                        bundle.teamStatuses[team] = `at base (${timeStr})`;
                        bundle.currentAssignments[team] = 'Base';
                        bundle.teamAssignmentTimes[team] = Date.now();
                        
                        // Delete log entries that referred to that team performing that task
                        bundle.activityLog = bundle.activityLog.filter(entry => 
                            !(entry.team === team && entry.tag === taskNum)
                        );
                        changed = true;
                    }
                }
            }

            const taskNumId = taskNum.startsWith('#') ? taskNum.substring(1) : taskNum;
            if (bundle.forms && bundle.forms[taskNumId]) {
                delete bundle.forms[taskNumId];
                changed = true;
            }
            
            if (changed) {
                saveBundle(bundle);
            }

            data.splice(indexInData, 1);
            logDeletion('Search Log Entry', taskNum);
            if (data.length === 0) data.push(Array.from({ length: 10 }, () => ''));
            saveCurrentPageData(data);
            buildSearchLogTable();
        }
      });
    };
    deleteContainer.appendChild(delBtn);
    deleteTd.appendChild(deleteContainer);
    tr.appendChild(deleteTd);

    tableBody.appendChild(tr);
    
    // Check if this is the "latest" search to scroll to it
    const params = new URLSearchParams(window.location.search);
    if (params.get('scroll') === 'latest') {
        // Identify latest by date/time
        // Actually, we can just scroll to the very last one added if it's the first time we load
        // But the requirement says "scroll to the latest search".
        // If sorting is DESCENDING (default), latest is at the top.
        // If sorting is ASCENDING, latest is at the bottom.
        
        // Let's scroll to the row that matches the absolute latest timestamp in sortedData
        const absoluteLatest = [...sortedData].sort((a, b) => {
             const [m1, d1, y1] = (a[1] || '').split('-').map(Number);
             const [m2, d2, y2] = (b[1] || '').split('-').map(Number);
             const [h1, min1] = (a[2] || '').split(':').map(Number);
             const [h2, min2] = (b[2] || '').split(':').map(Number);
             const date1 = new Date(y1 || 0, (m1 || 1) - 1, d1 || 1, h1 || 0, min1 || 0);
             const date2 = new Date(y2 || 0, (m2 || 1) - 1, d2 || 1, h2 || 0, min2 || 0);
             return date2 - date1;
        })[0];
        
        if (sortedData[r] === absoluteLatest) {
            setTimeout(() => {
                tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Remove param so it doesn't keep scrolling on refresh
                const newUrl = window.location.pathname;
                window.history.replaceState({}, '', newUrl);
            }, 100);
        }
    }
  }

  const existing = document.querySelector('.add-row-container');
  if (existing) existing.remove();

  if (sortToggle) {
    sortToggle.onchange = () => {
        const user = getCurrentUser();
        if (user) {
            const b = loadBundle();
            const acc = (b.accounts || []).find(a => a.pin === user.pin);
            if (acc) {
                acc.searchLogSortRecentFirst = sortToggle.checked;
                saveBundle(b);
                
                // Update session storage too
                user.searchLogSortRecentFirst = sortToggle.checked;
                setCurrentUser(user);
            }
        }
        buildSearchLogTable();
    };
  }

  if (clearBtn) {
    clearBtn.remove();
  }
  
  initCharts();
}

function getLocalISOString(date) {
    const tzoffset = date.getTimezoneOffset() * 60000;
    return (new Date(date - tzoffset)).toISOString().slice(0, 16);
}

let selectedChartStart = getLocalISOString(new Date());
let selectedChartEnd = getLocalISOString(new Date(Date.now() + 24 * 3600000));

// Helper to format hour offset
function formatHourOffset(ts) {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '00:00';
    return `${(date.getMonth() + 1)}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// Helper to get timestamp
function getTs(dateStr, timeStr) {
    if (!dateStr) return 0;
    const [m, d, y] = dateStr.split('-').map(Number);
    const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm).getTime();
}

function calculateHourlyMetrics(startTimeTs, endTimeTs) {
    const bundle = loadBundle();
    const searchLog = bundle.pages.page4 || [];
    const segments = bundle.pages.page2 || [];
    const regions = bundle.pages.index.rows || [];
    
    const results = [];
    const totalDuration = endTimeTs - startTimeTs;
    const increment = totalDuration / 10;

    for (let i = 0; i <= 10; i++) {
        const currentTs = startTimeTs + (i * increment);
        
        let totalPOS = 0;
        let totalPSRc = 0;
        
        const hourMetrics = [];

        segments.forEach(segRow => {
            const regionName = segRow[0];
            const segmentName = segRow[1];
            const area = parseNumeric(segRow[2]);
            const length = parseNumeric(segRow[3]);
            const timePerSweep = parseNumeric(segRow[5]);
            const psri = parseNumeric(segRow[6]);

            // Region consensus and sum of areas
            const regionRow = regions.find(r => r[0] === regionName);
            const consensus = regionRow ? parseFloat(computeConsensus(bundle.pages.index, regions.indexOf(regionRow))) || 0 : 0;
            const sumOfAreas = segments.filter(s => s[0] === regionName).reduce((sum, s) => sum + parseNumeric(s[2]), 0);
            
            const initialPOC = (sumOfAreas > 0) ? (consensus * area / sumOfAreas) : 0;

            // Find all logs for this segment up to currentTs
            const logs = searchLog.filter(log => {
                if (log[3] !== regionName || log[4] !== segmentName) return false;
                return getTs(log[1], log[2]) <= currentTs;
            }).sort((a, b) => getTs(a[1], a[2]) - getTs(b[1], b[2]));

            let currentPOC = initialPOC;
            let currentPSR = psri;
            let segTotalPOS = 0;
            
            logs.forEach(log => {
                const sweepWidth = parseNumeric(log[8]);
                const numSweeps = parseNumeric(log[9]);
                const teamInfo = log[7] || '';
                const match = teamInfo.match(/\((\d+)\)/);
                const numMembers = match ? parseInt(match[1]) : 0;
                
                if (area > 0 && length > 0 && numMembers > 0) {
                    // Searcher Spacing (ft) = (Area (ac) / 640 / Length (mi) / NumSweeps / NumMembers) * 5280
                    const spacing = (area / 640 / length / numSweeps / numMembers) * 5280;
                    
                    // Coverage = Sweep Width (ft) / (Area (ac) / 640 / Length (mi) / NumMembers * 5280)
                    // Note: user's formula for coverage didn't include numSweeps in the denominator.
                    // "Coverage = sweep width / (area / 640 / length / num of team members searching on the team that searched this)"
                    // But if we have multiple sweeps, the spacing between searchers is different.
                    // Usually Coverage = SweepWidth / EffectiveSpacing.
                    // I'll stick to user's formula precisely:
                    const spacingForCoverage = (area / 640 / length / numMembers) * 5280;
                    const coverage = sweepWidth / spacingForCoverage;
                    
                    const pod = 1 - Math.exp(-coverage);
                    const pos = currentPOC * pod;
                    
                    segTotalPOS += pos;
                    currentPOC = currentPOC - pos;
                    
                    // PSR = length / time per sweep * Sweep Width * POCa / Area
                    // User says: length / time per sweep * Sweep Width (do not try to convert these ft to miles: leave these ft as ft) * POCa / Area
                    currentPSR = (length / timePerSweep) * sweepWidth * currentPOC / area;

                    // Store these for the detailed metrics table
                    hourMetrics.push({
                        region: regionName,
                        segment: segmentName,
                        spacing: spacing,
                        coverage: coverage,
                        pod: pod,
                        pos: pos,
                        psrc: currentPSR,
                        poca: currentPOC
                    });
                }
            });

            totalPOS += segTotalPOS;
            totalPSRc += (logs.length > 0) ? currentPSR : psri;
            
            // If no logs, still record current state for POCa/PSRc
            if (logs.length === 0) {
                hourMetrics.push({
                    region: regionName,
                    segment: segmentName,
                    spacing: 0,
                    coverage: 0,
                    pod: 0,
                    pos: 0,
                    psrc: psri,
                    poca: initialPOC
                });
            }
        });

        results.push({
            hour: currentTs,
            totalPOS,
            totalPSRc,
            segments: hourMetrics
        });
    }
    
    return results;
}

function buildMetricsTable() {
    const tableBody = document.getElementById('metrics-table-body');
    const dateTitle = document.getElementById('metrics-date-title');
    if (!tableBody || !dateTitle) return;

    const startTs = new Date(selectedChartStart).getTime();
    const endTs = new Date(selectedChartEnd).getTime();

    dateTitle.textContent = `${selectedChartStart.replace('T', ' ')} to ${selectedChartEnd.replace('T', ' ')}`;
    tableBody.innerHTML = '';
    
    const metricsData = calculateHourlyMetrics(startTs, endTs);
    
    metricsData.forEach(m => {
        const tr = document.createElement('tr');
        
        // Hour Column
        const tdHour = document.createElement('td');
        tdHour.setAttribute('data-label', 'Hour');
        tdHour.textContent = formatHourOffset(m.hour);
        tdHour.style.fontWeight = 'bold';
        tr.appendChild(tdHour);
        
        // Segments logic
        const segs = m.segments || [];
        // Only count segments that actually have search stats
        const activeSegs = segs.filter(s => s.spacing > 0 || s.coverage > 0);
        const count = activeSegs.length || 1;
        
        const avgSpacing = activeSegs.reduce((s, seg) => s + seg.spacing, 0) / count;
        const avgCoverage = activeSegs.reduce((s, seg) => s + seg.coverage, 0) / count;
        const avgPOD = activeSegs.reduce((s, seg) => s + seg.pod, 0) / count;
        
        // PSR and POCa are cumulative/summed across the operation
        const avgPOCa = segs.reduce((s, seg) => s + seg.poca, 0); // Sum of POCa across all segments
        
        const createTd = (val, label) => {
            const td = document.createElement('td');
            td.setAttribute('data-label', label);
            td.textContent = isFinite(val) ? val.toFixed(4) : '0.0000';
            return td;
        };

        tr.appendChild(createTd(avgSpacing, 'Searcher Spacing (ft)'));
        tr.appendChild(createTd(avgCoverage, 'Coverage'));
        tr.appendChild(createTd(avgPOD, 'POD'));
        tr.appendChild(createTd(m.totalPOS, 'POS'));
        tr.appendChild(createTd(avgPOCa, 'POC After'));
        tr.appendChild(createTd(m.totalPSRc, 'PSR'));
        
        tableBody.appendChild(tr);
    });
}

function initCharts() {
    const startInput = document.getElementById('chart-start-datetime');
    const endInput = document.getElementById('chart-end-datetime');
    
    if (startInput && endInput) {
        startInput.value = selectedChartStart;
        endInput.value = selectedChartEnd;
        
        startInput.onchange = () => {
            selectedChartStart = startInput.value;
            renderCharts();
        };
        endInput.onchange = () => {
            selectedChartEnd = endInput.value;
            renderCharts();
        };
    }
    renderCharts();
}

function renderCharts() {
    const startTs = new Date(selectedChartStart).getTime();
    const endTs = new Date(selectedChartEnd).getTime();
    
    if (isNaN(startTs) || isNaN(endTs)) return;
    
    const metrics = calculateHourlyMetrics(startTs, endTs);
    
    const psrcData = metrics.map(m => m.totalPSRc);
    const posData = metrics.map(m => m.totalPOS);

    drawLineChart('psrc-chart-container', psrcData, '#7dc6ff', startTs, endTs);
    drawLineChart('activity-chart-container', posData, '#ff8c00', startTs, endTs);
}

function drawLineChart(containerId, data, color, startTimeTs, endTimeTs) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const padding = { top: 20, right: 20, bottom: 40, left: 60 }; // More bottom padding for date/time
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 150;
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const max = Math.max(...data, 1);
    const durationMs = endTimeTs - startTimeTs;

    container.innerHTML = '';
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = 'visible';

    // Y Axis (Vertical Axis)
    const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    yAxis.setAttribute("x1", padding.left);
    yAxis.setAttribute("y1", padding.top);
    yAxis.setAttribute("x2", padding.left);
    yAxis.setAttribute("y2", height - padding.bottom);
    yAxis.setAttribute("stroke", "rgba(255,255,255,0.2)");
    yAxis.setAttribute("stroke-width", "1");
    svg.appendChild(yAxis);

    // Major increments on Y Axis
    const numTicks = 5;
    for (let i = 0; i <= numTicks; i++) {
        const val = (max / numTicks) * i;
        const y = height - padding.bottom - (val / max) * (height - padding.top - padding.bottom);
        
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("x1", padding.left - 5);
        tick.setAttribute("y1", y);
        tick.setAttribute("x2", padding.left);
        tick.setAttribute("y2", y);
        tick.setAttribute("stroke", "rgba(255,255,255,0.4)");
        svg.appendChild(tick);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", padding.left - 10);
        text.setAttribute("y", y + 4);
        text.setAttribute("fill", "var(--muted)");
        text.setAttribute("font-size", "10");
        text.setAttribute("text-anchor", "end");
        
        // If it's the activity-chart (POS), show as percent
        if (containerId === 'activity-chart-container') {
            text.textContent = (val * 100).toFixed(0) + '%';
        } else {
            text.textContent = val.toFixed(1);
        }
        svg.appendChild(text);
    }

    // X Axis Ticks
    const numXTicks = 10;
    for (let i = 0; i <= numXTicks; i++) {
        const tickTs = startTimeTs + (i / numXTicks) * durationMs;
        const x = padding.left + (i / numXTicks) * chartWidth;
        
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("x1", x);
        tick.setAttribute("y1", height - padding.bottom);
        tick.setAttribute("x2", x);
        tick.setAttribute("y2", height - padding.bottom + 5);
        tick.setAttribute("stroke", "rgba(255,255,255,0.4)");
        svg.appendChild(tick);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x);
        text.setAttribute("y", height - padding.bottom + 20);
        text.setAttribute("fill", "var(--muted)");
        text.setAttribute("font-size", "7.5"); // Smaller to fit date/time
        text.setAttribute("text-anchor", "middle");
        text.textContent = formatHourOffset(tickTs);
        svg.appendChild(text);
    }

    const points = data.map((val, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = height - padding.bottom - (val / max) * chartHeight;
        return { x, y };
    });

    if (points.length > 0) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        let d = `M ${points[0].x} ${points[0].y}`;

        if (points.length > 1) {
            for (let i = 0; i < points.length - 1; i++) {
                const curr = points[i];
                const next = points[i + 1];
                const cp1x = curr.x + (next.x - curr.x) / 3;
                const cp2x = curr.x + 2 * (next.x - curr.x) / 3;
                d += ` C ${cp1x} ${curr.y}, ${cp2x} ${next.y}, ${next.x} ${next.y}`;
            }
        }

        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", "3");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
    }

    // No more dots/circles on line graphs as per request
    /*
    data.forEach((val, i) => {
        ...
    });
    */

    container.appendChild(svg);
}

function drawBarChart(containerId, data, color) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const max = Math.max(...data, 1);
    container.innerHTML = '';
    
    data.forEach((val, i) => {
        const bar = document.createElement('div');
        bar.style.flex = '1';
        bar.style.background = color;
        bar.style.height = `${(val / max) * 100}%`;
        bar.style.borderRadius = '4px 4px 0 0';
        bar.style.opacity = '0.6';
        bar.style.transition = 'height 0.3s ease';
        bar.title = `Hour ${i}:00 - Members: ${val}`;
        container.appendChild(bar);
    });
}


function buildSavedFilesTable() {
    const tbody = document.getElementById('saved-files-body');
    if (!tbody) return;

    const files = getSavedFiles();
    const fileNames = Object.keys(files).sort();
    
    if (fileNames.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--muted); padding: 20px;">No saved search files yet.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    const currentUser = getCurrentUser();
    const isAdmin = isUserAdmin(currentUser);
    const isFileManager = currentUser && (currentUser.isFileManager === true || currentUser.isFileManager === 'true');

    fileNames.forEach(name => {
        const fileInfo = files[name];
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        // Name (Open button-like pill)
        const tdName = document.createElement('td');
        tdName.setAttribute('data-label', 'File Name');
        tdName.style.padding = '12px 15px';
        const nameBtn = document.createElement('button');
        nameBtn.className = 'mini-pill';
        nameBtn.style.fontWeight = 'bold';
        nameBtn.textContent = name;
        nameBtn.onclick = () => {
            saveBundle(fileInfo.bundle);
            window.location.reload();
        };
        tdName.appendChild(nameBtn);
        tr.appendChild(tdName);

        // Date
        const tdDate = document.createElement('td');
        tdDate.setAttribute('data-label', 'Last Modified');
        tdDate.style.padding = '12px 15px';
        tdDate.style.color = 'var(--muted)';
        try {
            tdDate.textContent = new Date(fileInfo.lastModified).toLocaleString();
        } catch(e) {
            tdDate.textContent = fileInfo.lastModified;
        }
        tr.appendChild(tdDate);

        // Size
        const tdSize = document.createElement('td');
        tdSize.setAttribute('data-label', 'File Size');
        tdSize.style.padding = '12px 15px';
        tdSize.style.color = 'var(--muted)';
        const sizeInBytes = JSON.stringify(fileInfo.bundle).length;
        const sizeInKB = (sizeInBytes / 1024).toFixed(1);
        tdSize.textContent = `${sizeInKB} KB`;
        tr.appendChild(tdSize);

        // Actions
        const tdActions = document.createElement('td');
        tdActions.setAttribute('data-label', 'Actions');
        tdActions.style.padding = '12px 15px';
        tdActions.style.textAlign = 'center';
        
        const btnCont = document.createElement('div');
        btnCont.className = 'tool-actions';
        btnCont.style.justifyContent = 'center';
        btnCont.style.gap = '10px';

        const downBtn = document.createElement('button');
        downBtn.className = 'mini-pill';
        downBtn.textContent = 'Download';
        downBtn.onclick = () => {
            downloadTextFile(name, JSON.stringify(fileInfo.bundle, null, 2));
        };
        btnCont.appendChild(downBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'row-delete-btn';
        delBtn.textContent = 'Delete';
        delBtn.onclick = () => {
            if (isAdmin || isFileManager) {
                const b = loadBundle();
                const doDelete = () => {
                    deleteFileFromList(name);
                    buildSavedFilesTable();
                };
                if (b.deleteMode) {
                    doDelete();
                } else if (confirm(`Are you sure you want to delete "${name}"?`)) {
                    doDelete();
                }
            } else {
                alert('You do not have permission to delete files. Contact Super Admin or a File Manager.');
            }
        };
        btnCont.appendChild(delBtn);

        tdActions.appendChild(btnCont);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}

function buildHomePage() {
  updateFileNameDisplay();
  const fileNameInput = document.getElementById('bundle-file-name');
  const saveNameBtn = document.getElementById('save-file-name');
  const homeStatus = document.getElementById('home-status');

  const bundle = loadBundle();
  fileNameInput.value = bundle.fileName;

  buildSavedFilesTable();

  const createNewBtn = document.getElementById('create-new-search-btn');
  if (createNewBtn) {
    createNewBtn.onclick = () => {
        const popup = createPopup('Create New Search?', createNewBtn);
        const content = popup.querySelector('.popup-content');
        const btnContainer = popup.querySelector('.popup-buttons');
        
        const desc = document.createElement('p');
        desc.style.color = 'var(--muted)';
        desc.style.fontSize = '0.9rem';
        desc.style.margin = '10px 0 20px 0';
        desc.textContent = 'Create a new search file? Registered personnel will be preserved but set to off-scene.';
        content.insertBefore(desc, btnContainer);
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'popup-btn primary';
        confirmBtn.textContent = 'Confirm';
        confirmBtn.onclick = () => {
            let nextName = prompt('Enter a name for the new search:', 'new-search.json');
            if (nextName === null) {
                closePopup(popup);
                return;
            }
            nextName = nextName.trim();
            if (!nextName) nextName = 'new-search.json';
            if (!nextName.toLowerCase().endsWith('.json')) nextName += '.json';

            const currentBundle = loadBundle();
            const newBundle = defaultBundle();
            newBundle.fileName = nextName;
            
            // Preserve personnel but set to off-scene
            const oldPersonnel = currentBundle.pages.page3 || [];
            const preservedPersonnel = oldPersonnel.filter(r => r[0] && r[0].trim() !== '').map(r => {
                const newRow = [...r];
                newRow[1] = ''; // Clear team
                newRow[2] = ''; // Clear lead
                newRow[6] = 'false'; // Off-scene
                return newRow;
            });
            
            if (preservedPersonnel.length > 0) {
                newBundle.pages.page3 = preservedPersonnel;
            }
            
            // Preserve accounts
            newBundle.accounts = currentBundle.accounts;

            logCreation('New Search File', newBundle.fileName, newBundle);
            saveBundle(newBundle);
            window.location.reload();
        };
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'popup-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => closePopup(popup);
        
        btnContainer.appendChild(confirmBtn);
        btnContainer.appendChild(cancelBtn);
    };
  }

  const printBtn = document.getElementById('print-search-file-btn');
  if (printBtn) {
    printBtn.onclick = () => printSearchFile();
  }

  const backupZipBtn = document.getElementById('backup-all-zip-btn');
  if (backupZipBtn) {
    backupZipBtn.onclick = async () => {
      // Ensure current file is saved to list before backing up
      const currentBundle = loadBundle();
      saveFileToList(currentBundle.fileName, currentBundle);

      const files = getSavedFiles();
      const fileNames = Object.keys(files);
      if (fileNames.length === 0) {
        alert("No saved search files to backup.");
        return;
      }

      try {
        const zip = new JSZip();
        fileNames.forEach(name => {
          const fileInfo = files[name];
          const content = JSON.stringify(fileInfo.bundle, null, 2);
          zip.file(name, content);
        });

        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `sar-search-files-backup-${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      } catch (err) {
        console.error("Failed to create ZIP:", err);
        alert("An error occurred while creating the ZIP backup.");
      }
    };
  }

  // Populate stats
  const statRegions = document.getElementById('stat-regions');
  const statSegments = document.getElementById('stat-segments');
  const statPersonnel = document.getElementById('stat-personnel');
  const statTasks = document.getElementById('stat-tasks');

  if (statRegions) {
    const rows = bundle.pages.index.rows || [];
    statRegions.textContent = rows.filter(r => r[0] && r[0].trim() !== '').length;
  }
  if (statSegments) {
    const rows = bundle.pages.page2 || [];
    statSegments.textContent = rows.filter(r => r[1] && r[1].trim() !== '').length;
  }
  if (statPersonnel) {
    const rows = bundle.pages.page3 || [];
    statPersonnel.textContent = rows.filter(r => r[0] && r[0].trim() !== '').length;
  }
  if (statTasks) {
    const rows = bundle.pages.page4 || [];
    statTasks.textContent = rows.filter(r => r[0] && r[0].trim() !== '').length;
  }

  const recentLogsContainer = document.getElementById('recent-logs');
  const updateRecentLogs = () => {
    if (!recentLogsContainer) return;
    const b = loadBundle();
    const logs = b.activityLog || [];
    if (logs.length > 0) {
      recentLogsContainer.innerHTML = '';
      // Take the latest 3 logs (they are at the beginning because of unshift)
      const latestThree = logs.slice(0, 3);
      latestThree.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'activity-log-entry';
        div.style.marginBottom = '5px';
        
        const tagPart = entry.tag || 'base';
        const displayTag = tagPart.split(' - ')[0];
        const userName = tagPart.includes(' - ') ? tagPart.split(' - ')[1] : '';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'activity-log-time';
        timeSpan.textContent = '[' + entry.time + ' ' + displayTag + (userName ? ' ' + userName : '') + ']';
        
        const text = document.createTextNode(` Team ${entry.team}: ${entry.action}`);
        
        div.appendChild(timeSpan);
        div.appendChild(text);
        recentLogsContainer.appendChild(div);
      });
    } else {
      recentLogsContainer.innerHTML = '<p>No recent activity logs.</p>';
    }
  };

  if (recentLogsContainer) {
    updateRecentLogs();
    // Refresh every 5 seconds to catch new logs from other pages/background
    setInterval(updateRecentLogs, 5000);
  }

  const importBtn = document.getElementById('import-search-btn');
  const importInput = document.getElementById('import-search-input');
  if (importBtn && importInput) {
    importBtn.onclick = () => importInput.click();
    importInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importedBundle = JSON.parse(event.target.result);
          if (!importedBundle.pages || !importedBundle.fileName) {
              alert('Invalid search file format. Missing pages or fileName.');
              return;
          }
          logCreation('Imported Search File', importedBundle.fileName, importedBundle);
          saveBundle(importedBundle);
          window.location.reload();
        } catch (err) {
          alert('Error importing file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
  }

  saveNameBtn.onclick = () => {
    const currentBundle = loadBundle();
    let nextName = fileNameInput.value.trim() || DEFAULT_FILE_NAME;
    if (!nextName.toLowerCase().endsWith('.json')) nextName += '.json';
    
    // Check if we are renaming an existing file list entry
    const files = getSavedFiles();
    const oldName = currentBundle.fileName;
    
    if (oldName !== nextName && files[nextName]) {
        if (!confirm(`A file named "${nextName}" already exists. Overwrite it?`)) {
            return;
        }
    }
    
    if (oldName !== nextName && files[oldName]) {
        deleteFileFromList(oldName);
    }
    
    currentBundle.fileName = nextName;
    saveBundle(currentBundle);

    fileNameInput.value = nextName;
    homeStatus.textContent = `File identifier updated to ${nextName} and saved to list.`;
    updateFileNameDisplay();
    buildSavedFilesTable();
  };

  initCharts();

  const viewMetricsBtn = document.getElementById('view-metrics-btn');
  const backToDashboardBtn = document.getElementById('back-to-dashboard-btn');
  const dashboardView = document.getElementById('home-dashboard-view');
  const metricsView = document.getElementById('home-metrics-view');

  if (viewMetricsBtn && backToDashboardBtn && dashboardView && metricsView) {
      viewMetricsBtn.onclick = () => {
          dashboardView.style.display = 'none';
          metricsView.style.display = 'block';
          buildMetricsTable();
      };
      backToDashboardBtn.onclick = () => {
          dashboardView.style.display = 'grid';
          metricsView.style.display = 'none';
      };
  }
}

function applyTheme(bundle) {
  const user = getCurrentUser();
  let theme = bundle.theme || 'dark';
  
  if (user) {
    // Look up current user in bundle to get latest theme preference
    const actualUser = (bundle.accounts || []).find(a => 
      a.firstName === user.firstName && a.lastName === user.lastName && a.pin === user.pin
    );
    if (actualUser && actualUser.theme) {
      theme = actualUser.theme;
    }
  }

  if (theme === 'light') {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
}

function applyBackground(bundle) {
  if (bundle && bundle.background) {
    document.body.style.backgroundImage = `linear-gradient(var(--bg-dim-start), var(--bg-dim-end)), url('${bundle.background}')`;
  }
}

function applyTipsVisibility(bundle) {
  const showTips = bundle.showTips !== false; // Default to true
  const tips = document.querySelectorAll('.hero p');
  tips.forEach(p => {
    // Only target p elements that are direct children of hero or within hero-col-left
    // to avoid hiding actual content if any hero section uses p for something else.
    // Based on exploration, these are indeed the informational tips.
    if (p.closest('.hero')) {
      p.style.display = showTips ? '' : 'none';
    }
  });
}

function buildSettingsPage() {
  const toggle = document.getElementById('delete-mode-toggle');
  const label = document.getElementById('delete-mode-label');
  const themeToggle = document.getElementById('theme-toggle');
  const themeLabel = document.getElementById('theme-label');
  const tipsToggle = document.getElementById('tips-toggle');
  const tipsLabel = document.getElementById('tips-label');
    const segmentScaleMaxToggle = document.getElementById('segment-scale-max-toggle');
    const segmentScaleMaxLabel = document.getElementById('segment-scale-max-label');
    const segmentScaleLowColorInput = document.getElementById('segment-scale-low-color-input');
    const segmentScaleMidColorInput = document.getElementById('segment-scale-mid-color-input');
    const segmentScaleHighColorInput = document.getElementById('segment-scale-high-color-input');
    const segmentSearchOpacityInput = document.getElementById('segment-search-opacity-input');
    const segmentSearchOpacityLabel = document.getElementById('segment-search-opacity-label');
  const status = document.getElementById('settings-status');
  const bgInput = document.getElementById('bg-image-input');
  const resetBgBtn = document.getElementById('reset-bg-btn');
  const parFreqInput = document.getElementById('par-freq-input');
  const bundle = loadBundle();
    const segmentDisplaySettings = getSegmentDisplaySettings(bundle);

    const updateSegmentScaleLabel = settings => {
        if (!segmentScaleMaxLabel) return;
        segmentScaleMaxLabel.textContent = settings.usePsriMax
            ? 'Scale max uses highest PSRi'
            : 'Scale max uses highest PSRc';
    };

    const updateSegmentSearchOpacityLabel = () => {
        if (!segmentSearchOpacityLabel) return;
        segmentSearchOpacityLabel.textContent = '%';
    };

    if (segmentScaleMaxToggle) {
        segmentScaleMaxToggle.checked = segmentDisplaySettings.usePsriMax;
        updateSegmentScaleLabel(segmentDisplaySettings);
        segmentScaleMaxToggle.onchange = () => {
            const nextBundle = loadBundle();
            nextBundle.segmentColorScaleUsePsriMax = segmentScaleMaxToggle.checked;
            saveBundle(nextBundle);
            updateSegmentScaleLabel(getSegmentDisplaySettings(nextBundle));
            status.textContent = 'Segment color scale maximum source updated.';
        };
    }

    [
        [segmentScaleLowColorInput, 'segmentColorScaleLowColor', 'Low color updated.'],
        [segmentScaleMidColorInput, 'segmentColorScaleMidColor', 'Mid color updated.'],
        [segmentScaleHighColorInput, 'segmentColorScaleHighColor', 'High color updated.']
    ].forEach(([input, key, message]) => {
        if (!input) return;
        input.value = segmentDisplaySettings[key === 'segmentColorScaleLowColor' ? 'lowColor' : key === 'segmentColorScaleMidColor' ? 'midColor' : 'highColor'];
        input.oninput = () => {
            const nextBundle = loadBundle();
            nextBundle[key] = input.value;
            saveBundle(nextBundle);
            status.textContent = message;
        };
    });

    if (segmentSearchOpacityInput) {
        segmentSearchOpacityInput.value = segmentDisplaySettings.activeSearchOpacityPercent;
        updateSegmentSearchOpacityLabel(segmentDisplaySettings);
        segmentSearchOpacityInput.onchange = () => {
            const nextBundle = loadBundle();
            const nextSettings = getSegmentDisplaySettings({
                ...nextBundle,
                segmentActiveSearchOpacityPercent: segmentSearchOpacityInput.value
            });
            nextBundle.segmentActiveSearchOpacityPercent = nextSettings.activeSearchOpacityPercent;
            segmentSearchOpacityInput.value = nextSettings.activeSearchOpacityPercent;
            saveBundle(nextBundle);
            updateSegmentSearchOpacityLabel(nextSettings);
            status.textContent = 'Active-search segment opacity updated.';
        };
    }

  toggle.checked = !!bundle.deleteMode;
  label.textContent = `Delete Mode is ${toggle.checked ? 'ON' : 'OFF'}`;

  if (themeToggle) {
    themeToggle.checked = bundle.theme === 'light';
    themeLabel.textContent = bundle.theme === 'light' ? 'Grey Mode' : 'Dark Mode';
    themeToggle.onchange = () => {
      const nextBundle = loadBundle();
      nextBundle.theme = themeToggle.checked ? 'light' : 'dark';
      saveBundle(nextBundle);
      applyTheme(nextBundle);
      applyBackground(nextBundle);
      themeLabel.textContent = nextBundle.theme === 'light' ? 'Grey Mode' : 'Dark Mode';
      status.textContent = 'Theme updated and saved.';
    };
  }

  if (tipsToggle) {
    tipsToggle.checked = bundle.showTips !== false;
    tipsLabel.textContent = `Tips are ${tipsToggle.checked ? 'ON' : 'OFF'}`;
    tipsToggle.onchange = () => {
      const nextBundle = loadBundle();
      nextBundle.showTips = tipsToggle.checked;
      saveBundle(nextBundle);
      applyTipsVisibility(nextBundle);
      tipsLabel.textContent = `Tips are ${tipsToggle.checked ? 'ON' : 'OFF'}`;
      status.textContent = 'Tips display preference updated.';
    };
  }

  if (parFreqInput) {
    parFreqInput.value = bundle.parCheckFrequency || 20;
    parFreqInput.onchange = () => {
      const val = parseInt(parFreqInput.value);
      if (isNaN(val) || val < 1) {
        parFreqInput.value = 20;
        return;
      }
      const nextBundle = loadBundle();
      nextBundle.parCheckFrequency = val;
      saveBundle(nextBundle);
      status.textContent = `Par check frequency updated to ${val} minutes.`;
    };
  }

  toggle.onchange = () => {
    const nextBundle = loadBundle();
    nextBundle.deleteMode = toggle.checked;
    saveBundle(nextBundle);
    label.textContent = `Delete Mode is ${toggle.checked ? 'ON' : 'OFF'}`;
    status.textContent = `Settings saved automatically.`;
  };

  if (bgInput) {
    bgInput.onchange = async () => {
      const file = bgInput.files?.[0];
      if (!file) return;

      try {
        const reader = new FileReader();
        reader.onload = (e) => {
          const nextBundle = loadBundle();
          nextBundle.background = e.target.result;
          saveBundle(nextBundle);
          applyBackground(nextBundle);
          status.textContent = 'Background updated and saved.';
        };
        reader.readAsDataURL(file);
      } catch (err) {
        status.textContent = 'Could not load the image.';
      }
      bgInput.value = '';
    };
  }

  if (resetBgBtn) {
    resetBgBtn.onclick = () => {
      const nextBundle = loadBundle();
      nextBundle.background = 'assets/us-night.jpg';
      saveBundle(nextBundle);
      applyBackground(nextBundle);
        status.textContent = 'Background reverted to default us-night satellite image.';
    };
  }

  const syncUrlInput = document.getElementById('sync-url-input');
  const saveSyncBtn = document.getElementById('save-sync-url-btn');
  const syncStatusMsg = document.getElementById('sync-status-msg');
    const proxyInput = document.getElementById('caltopo-proxy-input');
  const saveProxyBtn = document.getElementById('save-proxy-btn');
    const testProxyBtn = document.getElementById('test-proxy-btn');

  if (proxyInput && saveProxyBtn) {
      proxyInput.value = getCalTopoProxy();
      saveProxyBtn.onclick = async () => {
          await withSaveButtonFeedback(saveProxyBtn, async () => {
              const normalizedProxyUrl = normalizeCalTopoProxyUrl(proxyInput.value);
              setCalTopoProxy(normalizedProxyUrl);
              proxyInput.value = normalizedProxyUrl;
              status.textContent = 'CalTopo Proxy URL saved.';
              await checkProxyHealth();
          });
    };
  }

    if (testProxyBtn) {
        testProxyBtn.onclick = async () => {
            const proxyUrl = normalizeCalTopoProxyUrl(proxyInput.value);
            if (!proxyUrl) {
                alert('Please enter a Proxy URL first.');
                return;
            }

            proxyInput.value = proxyUrl;

            testProxyBtn.textContent = 'Testing...';
            testProxyBtn.disabled = true;

            const healthUrl = getCalTopoProxyHealthUrl(proxyUrl);

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for manual test

                const healthUrlWithBuster = healthUrl.includes('?') ? `${healthUrl}&_=${Date.now()}` : `${healthUrl}?_=${Date.now()}`;
                const resp = await fetch(healthUrlWithBuster, {signal: controller.signal});
                const data = await resp.json().catch(() => ({}));
                clearTimeout(timeoutId);

                if (resp.ok) {
                    if (data.caltopoSigningConfigured) {
                        alert(`Success!\n\nProxy Version: ${data.version || 'unknown'}\nStatus: ${data.status}\nMessage: ${data.message}\n\nYour proxy is reachable and ready for signed CalTopo requests using backend credentials.`);
                    } else if (data.supportsClientSuppliedCredentials === false) {
                        const configLocationHint = data.credentialConfigPaths && data.credentialConfigPaths.length
                            ? `\n\nSuggested config file(s):\n${data.credentialConfigPaths.join('\n')}`
                            : '';
                        alert(`Proxy Reachable, Needs CalTopo Credentials\n\nProxy Version: ${data.version || 'unknown'}\nStatus: ${data.status}\nMessage: ${data.message}${configLocationHint}\n\nConfigure CALTOPO_CREDENTIAL_ID and CALTOPO_CREDENTIAL_SECRET on the proxy server, then redeploy or restart it.`);
                    } else {
                        alert(`Success!\n\nProxy Version: ${data.version || 'unknown'}\nStatus: ${data.status}\nMessage: ${data.message}`);
                    }
                    checkProxyHealth();
                } else {
                    alert(`Proxy Error ${resp.status}\n\nThe server is there, but it returned an error. Make sure you deployed the latest code.`);
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    alert(`Connection Timed Out\n\nCould not reach ${healthUrl} within 10 seconds.\n\nThis usually means the URL is wrong, the service is sleeping, or your internet is slow.`);
                } else {
                    alert(`Connection Failed\n\nCould not reach ${healthUrl}.\n\nError: ${err.message}\n\nThis usually means the URL is wrong or the Railway service is down.`);
                }
            } finally {
                testProxyBtn.textContent = 'Test Connection';
                testProxyBtn.disabled = false;
            }
        };
    }

    checkProxyHealth();

    const startWalkthroughBtn = document.getElementById('start-walkthrough-btn');
    if (startWalkthroughBtn) {
        startWalkthroughBtn.onclick = () => startCalTopoSetupWalkthrough(1);
    }

  if (syncUrlInput && saveSyncBtn) {
    const syncBucketInput = document.getElementById('sync-bucket-input');
      syncUrlInput.value = getSyncServerUrl();
    if (syncBucketInput) syncBucketInput.value = getSyncBucket();

    saveSyncBtn.onclick = async () => {
        await withSaveButtonFeedback(saveSyncBtn, async () => {
            const serverUrl = syncUrlInput.value.trim();
            const bucket = syncBucketInput ? syncBucketInput.value.trim() : getSyncBucket();

            if (serverUrl && bucket) {
                localStorage.setItem(SYNC_URL_STORAGE_KEY, serverUrl);
                localStorage.setItem(SYNC_BUCKET_STORAGE_KEY, bucket);
                syncStatusMsg.textContent = 'Sync settings saved! Testing connection...';

                try {
                    const apiBase = `${serverUrl.replace(/\/$/, '')}/api/v1/${bucket}`;
                    const [resp, listResp] = await Promise.all([
                        fetch(`${apiBase}/bundle?_=${Date.now()}`),
                        fetch(`${apiBase}/all-files?_=${Date.now()}`)
                    ]);

                    if (resp.ok || listResp.ok) {
                        syncStatusMsg.textContent = 'Sync connection successful! Data found.';
                    } else if (resp.status === 404 && listResp.status === 404) {
                        syncStatusMsg.textContent = 'Connected! New bucket created on server.';
                    } else {
                        syncStatusMsg.textContent = `Server returned status ${resp.status}/${listResp.status}.`;
                    }
                    await Promise.resolve(syncWithServer());
                } catch (err) {
                    syncStatusMsg.textContent = 'Could not reach sync server. Check the URL and your connection.';
                }
            } else {
                syncStatusMsg.textContent = 'Please enter both Server URL and Bucket ID.';
            }
        });
    };
  }
}

function buildProfilePage() {
  const container = document.getElementById('profile-form-container');
  if (!container) return;

  const bundle = loadBundle();
  const profile = bundle.profile || {};

  // Redesign Profile Page Header for two columns
  const hero = document.querySelector('.hero');
  if (hero) {
    hero.innerHTML = `
      <div class="hero-columns">
        <div class="hero-col-left">
          <h1>Profile</h1>
          <p>Enter the general incident and lost person information below.</p>
        </div>
        <div class="hero-col-right" style="display: flex; align-items: flex-end; justify-content: flex-end;">
          <div style="display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.2); padding: 10px 20px; border-radius: 999px; border: 1px solid var(--line);">
            <input type="checkbox" id="profile-completed" class="pill-checkbox" ${profile.completed ? 'checked' : ''}>
            <label for="profile-completed" style="font-weight: bold; cursor: pointer;">Profile Completed</label>
          </div>
        </div>
      </div>
    `;
    const cb = document.getElementById('profile-completed');
    if (cb) {
      cb.onchange = () => {
        const b = loadBundle();
        if (!b.profile) b.profile = {};
        b.profile.completed = cb.checked;
        saveBundle(b);
        checkParChecksAndNotify(); // Trigger header refresh
      };
    }
  }

  container.innerHTML = '';
  
  const form = document.createElement('div');
  form.className = 'task-form'; 
  
  const save = () => {
    const b = loadBundle();
    b.profile = profile;
    saveBundle(b);
  };

  const addGroup = (label, key, type = 'text') => {
    const grp = document.createElement('div');
    grp.className = 'form-group ' + (type === 'textarea' ? 'large' : 'small');
    grp.innerHTML = `<label>${label}</label>`;
    
    let input;
    if (type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'form-input';
      input.style.minHeight = '100px';
    } else {
      input = document.createElement('input');
      input.type = type;
      input.className = 'form-input';
    }
    
    input.value = profile[key] || '';
    input.oninput = () => {
      profile[key] = input.value;
      save();
    };
    
    grp.appendChild(input);
    form.appendChild(grp);
  };

  addGroup('Incident #', 'incidentNumber');
  addGroup('Lost Person Name', 'lostPersonName');
  addGroup('Age', 'lostPersonAge');
  addGroup('Gender', 'lostPersonGender');
  addGroup('Description', 'lostPersonDescription', 'textarea');
  addGroup('Clothing', 'lostPersonClothing', 'textarea');
  addGroup('Physical / Medical', 'lostPersonPhysical', 'textarea');

  container.appendChild(form);
}

let currentFormsSubpage = 'task-assignment';
let currentTaskNumber = null;

function buildFormsPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const taskParam = urlParams.get('task');
  if (taskParam) {
     currentTaskNumber = taskParam;
     currentFormsSubpage = 'task-assignment';
  }

  const btnTask = document.getElementById('btn-task-assignment');
  const btnIncidentTimes = document.getElementById('btn-incident-times');
  const btnManage = document.getElementById('btn-manage-forms');
  const taskView = document.getElementById('task-assignment-view');
  const incidentTimesView = document.getElementById('incident-times-view');
  const manageView = document.getElementById('manage-forms-view');
  const printContainer = document.getElementById('print-btn-container');

  if (btnTask) {
    btnTask.onclick = () => {
      currentFormsSubpage = 'task-assignment';
      buildFormsPage();
    };
  }
  if (btnIncidentTimes) {
    btnIncidentTimes.onclick = () => {
      currentFormsSubpage = 'incident-times';
      currentTaskNumber = null; // Clear task selection when going to report
      buildFormsPage();
    };
  }
  if (btnManage) {
    btnManage.onclick = () => {
      currentFormsSubpage = 'manage-forms';
      buildFormsPage();
    };
  }

  // Set visibility and active classes based on state
  if (currentFormsSubpage === 'task-assignment') {
    if (btnTask) btnTask.classList.add('active');
    if (btnIncidentTimes) btnIncidentTimes.classList.remove('active');
    if (btnManage) btnManage.classList.remove('active');
    if (taskView) taskView.style.display = 'block';
    if (manageView) manageView.style.display = 'none';

    const taskPills = document.getElementById('task-pills-container');
    if (taskPills) taskPills.style.display = 'flex';
    const taskTitle = document.getElementById('task-view-title');
    if (taskTitle) taskTitle.textContent = 'Task Assignment Form';
  } else if (currentFormsSubpage === 'incident-times') {
    if (btnIncidentTimes) btnIncidentTimes.classList.add('active');
    if (btnTask) btnTask.classList.remove('active');
    if (btnManage) btnManage.classList.remove('active');
    if (taskView) taskView.style.display = 'block'; // Keep taskView visible because it contains the interactive-form-container
    if (manageView) manageView.style.display = 'none';
  } else {
    if (btnManage) btnManage.classList.add('active');
    if (btnTask) btnTask.classList.remove('active');
    if (btnIncidentTimes) btnIncidentTimes.classList.remove('active');
    if (taskView) taskView.style.display = 'none';
    if (manageView) manageView.style.display = 'block';
  }

  if (printContainer) printContainer.innerHTML = '';

  if (printContainer) {
    const downloadAllBtn = document.createElement('button');
    downloadAllBtn.id = 'download-all-forms-btn';
    downloadAllBtn.className = 'sub-nav-btn';
    downloadAllBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Download All Forms';
    downloadAllBtn.onclick = () => downloadAllForms();
    printContainer.appendChild(downloadAllBtn);
  }

  if (currentFormsSubpage === 'task-assignment') {
    if (printContainer) {
      const printBtn = document.createElement('button');
      printBtn.className = 'sub-nav-btn active';
      printBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; vertical-align: middle;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>Print Form';
        printBtn.onclick = () => {
            if (currentTaskNumber) {
                printSingleTaskForm(currentTaskNumber);
            } else {
                alert("Please select a task first.");
            }
        };
      printContainer.appendChild(printBtn);
    }
    buildTaskAssignmentForm();
  } else if (currentFormsSubpage === 'incident-times') {
    if (printContainer) {
      const addRowBtn = document.createElement('button');
      addRowBtn.className = 'sub-nav-btn active';
      addRowBtn.style.marginRight = '8px';
      addRowBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; vertical-align: middle;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add Row';
      addRowBtn.onclick = () => addIncidentRow();
      printContainer.appendChild(addRowBtn);

      const printBtn = document.createElement('button');
      printBtn.className = 'sub-nav-btn active';
      printBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; vertical-align: middle;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>Print Report';
      printBtn.onclick = () => printIncidentTimesReport();
      printContainer.appendChild(printBtn);
    }
    const taskPills = document.getElementById('task-pills-container');
    if (taskPills) taskPills.style.display = 'none';
    const taskTitle = document.getElementById('task-view-title');
    if (taskTitle) taskTitle.textContent = 'Incident Times Report';

    buildIncidentTimesReport();
  } else {
    const taskPills = document.getElementById('task-pills-container');
    if (taskPills) taskPills.style.display = 'none';
    buildManageFormsTable();
  }
}

function printIncidentTimesReport() {
    const container = document.getElementById('interactive-form-container');
    if (!container) return;
    const tableHTML = container.innerHTML;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Please allow popups to view the printout.");
        return;
    }

    const bundle = loadBundle();
    const fileName = (bundle.fileName || "Search_File").replace('.json', '');

    printWindow.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Incident Times Report - ${fileName}</title>
    <style>
        ${TASK_FORM_PRINT_STYLES}
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #000; padding: 8px; text-align: left; font-size: 10pt; }
        th { background: #eee !important; -webkit-print-color-adjust: exact; }
        .mini-pill { border: 1px solid #ccc; padding: 2px 4px; border-radius: 4px; font-size: 8pt; display: block; margin: 2px 0; background: none !important; color: #000 !important; }
        button.mini-pill { border: none; }
        .pill-cell { background: none !important; padding: 0 !important; min-height: 0 !important; }
        .readonly-pill { border: none !important; }
        @media print {
            button { display: none !important; }
            .mini-pill { border: none !important; }
        }
    </style>
</head>
<body>
    <div class="no-print">
        <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 999px;">Print PDF</button>
    </div>
    <div class="print-container">
        <h1>Incident Times Report</h1>
        <p><strong>File:</strong> ${fileName}</p>
        <div class="report-content">
            ${tableHTML}
        </div>
    </div>
    <script>
        setTimeout(() => { window.print(); }, 500);
    </script>
</body>
</html>
    `);
    printWindow.document.close();
}

function findTaskTagForMember(memberName, logs) {
  const sortedLogs = [...logs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const log = sortedLogs.find(l => 
    l.tag && l.tag.startsWith('#') && 
    l.members && l.members.toLowerCase().includes(memberName.toLowerCase())
  );
  if (log) {
    const match = log.tag.match(/^#\d+/);
    return match ? match[0] : null;
  }
  return null;
}

function buildIncidentTimesReport() {
  const container = document.getElementById('interactive-form-container');
  if (!container) return;
  container.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'form-grid-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Member</th>
        <th>Enroute</th>
        <th>On-Scene</th>
        <th>Leave-Scene</th>
        <th>Home/Hotel</th>
      </tr>
    </thead>
    <tbody id="incident-times-body"></tbody>
  `;
  container.appendChild(table);

  const tableBody = document.getElementById('incident-times-body');
  if (!tableBody) return;
  tableBody.innerHTML = '';

  const bundle = loadBundle();
  const logs = bundle.activityLog || [];
  
  // Sort logs by timestamp ascending to process them chronologically
  const sortedLogs = [...logs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  
  const memberSessions = {}; // { memberName: [ { enroute, onScene, leaveScene, homeHotel } ] }
  const currentStatus = {}; // { memberName: status }
  const activeSession = {}; // { memberName: sessionIndex }

  sortedLogs.forEach(log => {
    if (!log.action) return;
    
    // We are looking for status changes
    // Regex to match: "Name status changed to Status at ..." or "Name status changed from Old to New at ..."
    const statusMatch = log.action.match(/^(.*?) status changed (?:from .*? )?to (.*?) at/i);
    if (statusMatch) {
      const memberName = statusMatch[1].trim().replace(/\*$/, ''); // Remove lead marker if present
      const newStatus = statusMatch[2].trim();
      const timestamp = log.timestamp;
      const dateTimeStr = `${log.date} ${log.time}`;

      if (!memberSessions[memberName]) {
        memberSessions[memberName] = [];
        currentStatus[memberName] = 'Off Duty';
      }

      const prevStatus = currentStatus[memberName];
      currentStatus[memberName] = newStatus;

      // Start a new session if moving from Off Duty to something else
      if (prevStatus === 'Off Duty' && newStatus !== 'Off Duty') {
        memberSessions[memberName].push({
          enroute: '',
          onScene: '',
          leaveScene: '',
          homeHotel: '',
          onSceneTS: null,
          leaveSceneTS: null
        });
        activeSession[memberName] = memberSessions[memberName].length - 1;
      }

      const sessionIdx = activeSession[memberName];
      if (sessionIdx !== undefined) {
        const session = memberSessions[memberName][sessionIdx];
        if (newStatus === 'Enroute' && !session.enroute) {
          session.enroute = dateTimeStr;
          session.enrouteLogId = log.id;
        } else if (newStatus === 'On-Scene' && !session.onScene) {
          session.onScene = dateTimeStr;
          session.onSceneTS = timestamp;
          session.onSceneLogId = log.id;
        } else if (prevStatus === 'On-Scene' && newStatus !== 'On-Scene' && !session.leaveScene) {
          session.leaveScene = dateTimeStr;
          session.leaveSceneTS = timestamp;
          session.leaveSceneLogId = log.id;
        } 
        
        if (['Hotel', 'Arrived Home', 'Arrived home', 'hotel'].some(s => newStatus.toLowerCase().includes(s.toLowerCase()))) {
          session.homeHotel = dateTimeStr;
          session.homeHotelLogId = log.id;
        }

        if (newStatus === 'Off Duty') {
           // If they went off duty but never officially "left scene", mark it now if they were on scene
           if (prevStatus === 'On-Scene' && !session.leaveScene) {
             session.leaveScene = dateTimeStr;
             session.leaveSceneTS = timestamp;
             session.leaveSceneLogId = log.id;
           }
           delete activeSession[memberName];
        }
      } else {
        // No active session, but maybe it's a home/hotel entry for the last closed session?
        if (['Hotel', 'Arrived Home', 'Arrived home', 'hotel'].some(s => newStatus.toLowerCase().includes(s.toLowerCase()))) {
          const sessions = memberSessions[memberName];
          if (sessions && sessions.length > 0) {
            const lastSession = sessions[sessions.length - 1];
            if (!lastSession.homeHotel) {
              lastSession.homeHotel = dateTimeStr;
              lastSession.homeHotelLogId = log.id;
            }
          }
        }
      }
    }
  });

  // Collect all sessions into a flat list for sorting
  const reportRows = [];
  for (const memberName in memberSessions) {
    memberSessions[memberName].forEach(session => {
      reportRows.push({
        name: memberName,
        ...session
      });
    });
  }

  // Sort by name
  reportRows.sort((a, b) => a.name.localeCompare(b.name));

  if (reportRows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.opacity = '0.5';
    td.style.padding = '40px';
    td.textContent = 'No incident time records found.';
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  reportRows.forEach(row => {
    const tr = document.createElement('tr');
    
    const tdMember = document.createElement('td');
    tdMember.dataset.label = 'Member';
    tdMember.className = 'regions-td';
    
    const namePill = document.createElement('div');
    namePill.className = 'pill-cell readonly-pill';
    namePill.style.display = 'flex';
    namePill.style.alignItems = 'center';
    namePill.style.minHeight = '46px';
    namePill.style.padding = '8px 15px';
    
    const textWrap = document.createElement('div');
    textWrap.style.display = 'flex';
    textWrap.style.flexDirection = 'column';
    textWrap.style.flex = '1';
    textWrap.innerHTML = `<strong>${row.name}</strong>`;
    
    if (row.onSceneTS && row.leaveSceneTS) {
      // Check for overrides that might change duration calculation
      let startStr = row.onScene;
      let endStr = row.leaveScene;
      
      const taskTag = findTaskTagForMember(row.name, logs);
      if (taskTag) {
          const taskNum = taskTag.substring(1);
          const taskForm = bundle.forms?.[taskNum];
          if (taskForm && taskForm.overrides) {
              if (taskForm.overrides.beginSearch) startStr = `${row.onScene.split(' ')[0]} ${taskForm.overrides.beginSearch}`;
              if (taskForm.overrides.completeSearch) endStr = `${row.leaveScene.split(' ')[0]} ${taskForm.overrides.completeSearch}`;
          }
      }

      const startTS = new Date(`${startStr.split(' ')[0].split('-')[2]}-${startStr.split(' ')[0].split('-')[0]}-${startStr.split(' ')[0].split('-')[1]}T${startStr.split(' ')[1]}:00`).getTime();
      const endTS = new Date(`${endStr.split(' ')[0].split('-')[2]}-${endStr.split(' ')[0].split('-')[0]}-${endStr.split(' ')[0].split('-')[1]}T${endStr.split(' ')[1]}:00`).getTime();

      const diffMs = endTS - startTS;
      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.round((diffMs % 3600000) / 60000);
      const durationStr = `${diffHrs}h ${diffMins}m`;
      textWrap.innerHTML += `<div style="font-size: 0.8rem; color: var(--muted); margin-top: 4px;">Time On Scene: ${durationStr}</div>`;
    }
    namePill.appendChild(textWrap);

    // Hover trash icon to delete the entire row (associated logs)
    const trashIcon = document.createElement('div');
    trashIcon.className = 'pill-hover-trash no-print';
    trashIcon.title = 'Delete Incident Row';
    trashIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
    trashIcon.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete incident time row for ${row.name}? This will remove the associated activity logs.`)) {
            const b = loadBundle();
            const logIdsToRemove = [row.enrouteLogId, row.onSceneLogId, row.leaveSceneLogId, row.homeHotelLogId].filter(id => id);
            if (logIdsToRemove.length > 0) {
                b.activityLog = (b.activityLog || []).filter(l => !logIdsToRemove.includes(l.id));
                saveBundle(b);
                buildIncidentTimesReport();
            }
        }
    };
    namePill.appendChild(trashIcon);
    
    tdMember.appendChild(namePill);
    tr.appendChild(tdMember);
    
    const columns = [
      { key: 'enroute', logIdKey: 'enrouteLogId', label: 'Enroute' },
      { key: 'onScene', logIdKey: 'onSceneLogId', label: 'On-Scene' },
      { key: 'leaveScene', logIdKey: 'leaveSceneLogId', label: 'Leave-Scene' },
      { key: 'homeHotel', logIdKey: 'homeHotelLogId', label: 'Home/Hotel' }
    ];

    columns.forEach(col => {
      const td = document.createElement('td');
      td.dataset.label = col.label;
      td.className = 'regions-td';
      td.style.textAlign = 'center';
      td.style.verticalAlign = 'middle';
      
      const log = bundle.activityLog[logId ? bundle.activityLog.findIndex(l => l.id === logId) : -1];
      const dateTimeStr = log ? `${log.date} ${log.time}` : `${row.date || ''} ${row.time || ''}`.trim();

      // Check for manual overrides from task form
      let displayTime = dateTimeStr;
      if (log && log.tag && log.tag.startsWith('#')) {
          const taskNumMatch = log.tag.match(/^#(\d+)/);
          if (taskNumMatch) {
              const taskNum = taskNumMatch[1];
              const taskForm = bundle.forms?.[taskNum];
              if (taskForm && taskForm.overrides) {
                  let overrideVal = null;
                  const actionLower = log.action.toLowerCase();
                  if (actionLower.includes('leaving base') || actionLower.includes('leave base')) {
                      overrideVal = taskForm.overrides.leaveBase;
                  } else if (actionLower.includes('beginning search') || actionLower.includes('begin search') || actionLower.includes('beginning assignment') || actionLower.includes('begin assignment') || actionLower.includes('started search')) {
                      overrideVal = taskForm.overrides.beginSearch;
                  } else if (actionLower.includes('finished search') || actionLower.includes('finish search') || actionLower.includes('finished assignment') || actionLower.includes('finish assignment')) {
                      overrideVal = taskForm.overrides.completeSearch;
                  } else if (actionLower.includes('arrived at base')) {
                      overrideVal = taskForm.overrides.returnBase;
                  }
                  
                  if (overrideVal) {
                      displayTime = `${log.date} ${overrideVal}`;
                  }
              }
          }
      }

      if (val) {
        const parts = displayTime.split(' ');
        const datePart = parts[0];
        const timePart = parts[1];
        
        const cellContainer = document.createElement('div');
        cellContainer.className = 'pill-cell readonly-pill';
        cellContainer.style.display = 'flex';
        cellContainer.style.flexDirection = 'column';
        cellContainer.style.alignItems = 'center';
        cellContainer.style.justifyContent = 'center';
        cellContainer.style.gap = '2px';
        cellContainer.style.minHeight = '46px';
        cellContainer.style.padding = '4px 8px';
        
        const datePill = document.createElement('button');
        datePill.className = 'mini-pill';
        datePill.style.fontSize = '0.65rem';
        datePill.style.padding = '0px 6px';
        datePill.style.border = 'none';
        datePill.style.background = 'rgba(255,255,255,0.05)';
        datePill.textContent = datePart;
        datePill.onclick = () => editIncidentTimestamp(logId);
        
        const timePill = document.createElement('button');
        timePill.className = 'mini-pill';
        timePill.style.fontSize = '0.75rem';
        timePill.style.padding = '2px 10px';
        timePill.style.fontWeight = 'bold';
        timePill.textContent = timePart;
        timePill.onclick = () => editIncidentTimestamp(logId);
        
        cellContainer.appendChild(datePill);
        cellContainer.appendChild(timePill);
        td.appendChild(cellContainer);
      } else {
        const cellContainer = document.createElement('div');
        cellContainer.className = 'pill-cell readonly-pill';
        cellContainer.style.display = 'flex';
        cellContainer.style.alignItems = 'center';
        cellContainer.style.justifyContent = 'center';
        cellContainer.style.minHeight = '46px';

        const plusBtn = document.createElement('button');
        plusBtn.className = 'mini-pill';
        plusBtn.style.fontSize = '0.75rem';
        plusBtn.style.padding = '2px 10px';
        plusBtn.textContent = '+';
        plusBtn.style.opacity = '0.6';
        plusBtn.onclick = () => addIncidentTimestamp(row.name, col.key);
        cellContainer.appendChild(plusBtn);
        td.appendChild(cellContainer);
      }
      
      tr.appendChild(td);
    });
    
    tableBody.appendChild(tr);
  });
}

function editIncidentTimestamp(logId) {
  if (!logId) return;
  const bundle = loadBundle();
  const logIndex = bundle.activityLog.findIndex(l => l.id === logId);
  if (logIndex === -1) {
    alert("Log entry not found.");
    return;
  }
  const log = bundle.activityLog[logIndex];

  const popup = createPopup('Edit Timestamp');
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');

  const container = document.createElement('div');
  container.className = 'popup-input-container';
  container.style.flexDirection = 'column';
  container.style.gap = '15px';
  container.style.marginBottom = '20px';

  const dateGroup = document.createElement('div');
  dateGroup.style.width = '100%';
  const dateLabel = document.createElement('label');
  dateLabel.textContent = 'Date (MM-DD-YYYY)';
  dateLabel.style.display = 'block';
  dateLabel.style.marginBottom = '5px';
  const dateInput = document.createElement('input');
  dateInput.type = 'text';
  dateInput.className = 'pill-input';
  dateInput.style.width = '100%';
  dateInput.value = log.date;
  dateInput.oninput = () => {
    let cursor = dateInput.selectionStart;
    let oldVal = dateInput.value;
    let val = dateInput.value.replace(/\D/g, '');
    let newVal = '';
    if (val.length > 0) newVal += val.substring(0, 2);
    if (val.length > 2) newVal += '-' + val.substring(2, 4);
    if (val.length > 4) newVal += '-' + val.substring(4, 8);
    dateInput.value = newVal;
    if (cursor === oldVal.length) dateInput.setSelectionRange(newVal.length, newVal.length);
  };
  dateGroup.appendChild(dateLabel);
  dateGroup.appendChild(dateInput);

  const timeGroup = document.createElement('div');
  timeGroup.style.width = '100%';
  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Time (HH:MM)';
  timeLabel.style.display = 'block';
  timeLabel.style.marginBottom = '5px';
  const timeInput = document.createElement('input');
  timeInput.type = 'text';
  timeInput.className = 'pill-input';
  timeInput.style.width = '100%';
  timeInput.value = log.time;
  timeInput.oninput = () => {
    let cursor = timeInput.selectionStart;
    let oldVal = timeInput.value;
    let val = timeInput.value.replace(/\D/g, '');
    let newVal = '';
    if (val.length > 0) newVal += val.substring(0, 2);
    if (val.length > 2) newVal += ':' + val.substring(2, 4);
    timeInput.value = newVal;
    if (cursor === oldVal.length) timeInput.setSelectionRange(newVal.length, newVal.length);
  };
  timeGroup.appendChild(timeLabel);
  timeGroup.appendChild(timeInput);

  container.appendChild(dateGroup);
  container.appendChild(timeGroup);
  content.insertBefore(container, btnContainer);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'popup-btn primary';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = async () => {
    await withSaveButtonFeedback(saveBtn, async () => {
      const newDate = dateInput.value.trim();
      const newTime = timeInput.value.trim();

      if (!/^\d{2}-\d{2}-\d{4}$/.test(newDate)) {
        alert("Invalid date format. Please use MM-DD-YYYY.");
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(newTime)) {
        alert("Invalid time format. Please use HH:MM.");
        return;
      }

      // Update log
      log.date = newDate;
      log.time = newTime;

      // Recalculate timestamp for sorting
      const dateParts = newDate.split('-');
      const tsDateStr = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}T${newTime}:00`;
      log.timestamp = new Date(tsDateStr).getTime();

      // Load fresh bundle to ensure we don't overwrite other changes
      const currentBundle = loadBundle();
      const idx = currentBundle.activityLog.findIndex(l => l.id === logId);
      if (idx !== -1) {
        currentBundle.activityLog[idx] = log;
        // Re-sort the activity log by timestamp (descending)
        currentBundle.activityLog.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        saveBundle(currentBundle);
      }

      closePopup(popup);
      buildIncidentTimesReport();
    });
  };
  btnContainer.appendChild(saveBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'popup-btn';
  clearBtn.style.color = 'var(--error)';
  clearBtn.textContent = 'Clear';
  clearBtn.onclick = () => {
    if (confirm("Are you sure you want to clear this timestamp? This will remove the status change entry from the activity log.")) {
      const currentBundle = loadBundle();
      const idx = currentBundle.activityLog.findIndex(l => l.id === logId);
      if (idx !== -1) {
        currentBundle.activityLog.splice(idx, 1);
        saveBundle(currentBundle);
      }
      closePopup(popup);
      buildIncidentTimesReport();
    }
  };
  btnContainer.appendChild(clearBtn);
}

function addIncidentRow() {
  const bundle = loadBundle();
  const roster = bundle.pages.page3 || [];
  const memberNames = roster.map(m => m[0]).filter(Boolean).sort();

  if (memberNames.length === 0) {
    alert("No members found in the roster (Page 3).");
    return;
  }

  const popup = createPopup('Add Member to Report');
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');

  const container = document.createElement('div');
  container.className = 'popup-input-container';
  container.style.flexDirection = 'column';
  container.style.gap = '15px';
  container.style.marginBottom = '20px';

  const label = document.createElement('label');
  label.textContent = 'Select Member';
  label.style.display = 'block';
  label.style.marginBottom = '5px';

  const select = document.createElement('select');
  select.className = 'pill-input';
  select.style.width = '100%';
  memberNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  container.appendChild(label);
  container.appendChild(select);
  content.insertBefore(container, btnContainer);

  const addBtn = document.createElement('button');
  addBtn.className = 'popup-btn primary';
  addBtn.textContent = 'Add Row';
  addBtn.onclick = async () => {
    const memberName = select.value;
    if (!memberName) return;

    // To create a row, we need a status change log. 
    // We'll add an "Enroute" entry with current time to start a session.
    let memberTeam = 'Unassigned';
    for (const row of roster) {
      if (row[0] === memberName) {
        memberTeam = row[1] || 'Unassigned';
        break;
      }
    }

    const now = new Date();
    const dateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()}`;
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const ts = now.getTime();

    addActivityLogEntry(memberTeam, `${memberName} status changed to Enroute at ${timeStr}`, null, null, dateStr, timeStr, ts);
    
    closePopup(popup);
    buildIncidentTimesReport();
  };
  btnContainer.appendChild(addBtn);
}

function addIncidentTimestamp(memberName, columnKey) {
  let status = '';
  if (columnKey === 'enroute') status = 'Enroute';
  else if (columnKey === 'onScene') status = 'On-Scene';
  else if (columnKey === 'leaveScene') status = 'Off Duty';
  else if (columnKey === 'homeHotel') status = 'Arrived Home';
  
  if (!status) return;

  const now = new Date();
  const defaultDate = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()}`;
  const defaultTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const popup = createPopup(`Add ${status} Time`);
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');

  const container = document.createElement('div');
  container.className = 'popup-input-container';
  container.style.flexDirection = 'column';
  container.style.gap = '15px';
  container.style.marginBottom = '20px';

  const dateGroup = document.createElement('div');
  dateGroup.style.width = '100%';
  const dateLabel = document.createElement('label');
  dateLabel.textContent = 'Date (MM-DD-YYYY)';
  dateLabel.style.display = 'block';
  dateLabel.style.marginBottom = '5px';
  const dateInput = document.createElement('input');
  dateInput.type = 'text';
  dateInput.className = 'pill-input';
  dateInput.style.width = '100%';
  dateInput.value = defaultDate;
  dateInput.oninput = () => {
    let cursor = dateInput.selectionStart;
    let oldVal = dateInput.value;
    let val = dateInput.value.replace(/\D/g, '');
    let newVal = '';
    if (val.length > 0) newVal += val.substring(0, 2);
    if (val.length > 2) newVal += '-' + val.substring(2, 4);
    if (val.length > 4) newVal += '-' + val.substring(4, 8);
    dateInput.value = newVal;
    if (cursor === oldVal.length) dateInput.setSelectionRange(newVal.length, newVal.length);
  };
  dateGroup.appendChild(dateLabel);
  dateGroup.appendChild(dateInput);

  const timeGroup = document.createElement('div');
  timeGroup.style.width = '100%';
  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Time (HH:MM)';
  timeLabel.style.display = 'block';
  timeLabel.style.marginBottom = '5px';
  const timeInput = document.createElement('input');
  timeInput.type = 'text';
  timeInput.className = 'pill-input';
  timeInput.style.width = '100%';
  timeInput.value = defaultTime;
  timeInput.oninput = () => {
    let cursor = timeInput.selectionStart;
    let oldVal = timeInput.value;
    let val = timeInput.value.replace(/\D/g, '');
    let newVal = '';
    if (val.length > 0) newVal += val.substring(0, 2);
    if (val.length > 2) newVal += ':' + val.substring(2, 4);
    timeInput.value = newVal;
    if (cursor === oldVal.length) timeInput.setSelectionRange(newVal.length, newVal.length);
  };
  timeGroup.appendChild(timeLabel);
  timeGroup.appendChild(timeInput);

  container.appendChild(dateGroup);
  container.appendChild(timeGroup);
  content.insertBefore(container, btnContainer);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'popup-btn primary';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = async () => {
    await withSaveButtonFeedback(saveBtn, async () => {
      const newDate = dateInput.value.trim();
      const newTime = timeInput.value.trim();

      if (!/^\d{2}-\d{2}-\d{4}$/.test(newDate)) {
        alert("Invalid date format. Please use MM-DD-YYYY.");
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(newTime)) {
        alert("Invalid time format. Please use HH:MM.");
        return;
      }

      // Add log entry
      let action = `${memberName} status changed to ${status} at ${newTime}`;
      
      // Determine team for the member if possible, otherwise use 'System'
      const bundle = loadBundle();
      let memberTeam = 'System';
      for (const team in bundle.teamMembers) {
        if (bundle.teamMembers[team].some(m => m[0] === memberName)) {
          memberTeam = team;
          break;
        }
      }

      const dateParts = newDate.split('-');
      const tsDateStr = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}T${newTime}:00`;
      const ts = new Date(tsDateStr).getTime();

      if (status === 'Enroute') action = `${memberName} status changed to Enroute at ${newTime}`;
      else if (status === 'On-Scene') action = `${memberName} status changed to On-Scene at ${newTime}`;
      else if (status === 'Off Duty') action = `${memberName} status changed from On-Scene to Off Duty at ${newTime}`;
      else if (status === 'Arrived Home') action = `${memberName} status changed to Arrived Home at ${newTime}`;

      addActivityLogEntry(memberTeam, action, null, null, newDate, newTime, ts);

      closePopup(popup);
      buildIncidentTimesReport();
    });
  };
  btnContainer.appendChild(saveBtn);
}

function buildTaskAssignmentForm() {
  const pillsContainer = document.getElementById('task-pills-container');
  const container = document.getElementById('interactive-form-container');
  if (!pillsContainer || !container) return;

  const bundle = loadBundle();
  const searchLog = bundle.pages.page4 || [];
  
  // Identify unfinished tasks
  const unfinishedTasks = new Set();
  if (bundle.currentAssignments && bundle.teamStatuses) {
    for (const team in bundle.currentAssignments) {
      const status = bundle.teamStatuses[team] || '';
      const assignment = bundle.currentAssignments[team] || '';
      if (!status.includes('at base') && assignment !== 'Base' && assignment !== 'None' && assignment !== '') {
        const match = assignment.match(/#(\d+)/);
        if (match) unfinishedTasks.add(match[1]);
      }
    }
  }

  const tasks = [];
  searchLog.forEach(row => {
    if (row[0] && row[0].startsWith('#')) {
      const num = row[0].substring(1);
      const region = row[3] || '';
      const segment = row[4] || '';
      const teamWithCount = row[7] || '';
      let teamName = teamWithCount;
      if (teamWithCount.includes(' (')) {
        teamName = teamWithCount.split(' (')[0];
      }

      if (!tasks.some(t => t.num === num)) {
        tasks.push({ num, region, segment, teamName });
      }
    }
  });
  tasks.sort((a, b) => parseInt(a.num) - parseInt(b.num));

  pillsContainer.innerHTML = '';
  tasks.forEach(task => {
    const btn = document.createElement('button');
    btn.className = 'mini-pill';
    btn.textContent = `#${task.num} ${task.region} ${task.segment} ${task.teamName}`;
    
    const isUnfinished = unfinishedTasks.has(task.num);
    const form = bundle.forms?.[task.num];
    const isComplete = form && form.completed;

    if (isUnfinished) {
       btn.style.opacity = '0.5';
       btn.style.background = 'rgba(128, 128, 128, 0.2)';
    } else if (!isComplete) {
       btn.style.background = 'rgba(255, 140, 0, 0.25)';
       btn.style.borderColor = 'rgba(255, 140, 0, 0.5)';
       btn.style.color = '#ff8c00';
    } else {
       // Standard website format
    }

    if (task.num === currentTaskNumber) {
      btn.style.borderWidth = '2px';
      btn.style.boxShadow = '0 0 8px var(--accent)';
    }

    btn.onclick = () => {
      currentTaskNumber = task.num;
      buildTaskAssignmentForm();
    };
    pillsContainer.appendChild(btn);
  });

  if (!currentTaskNumber) {
    container.innerHTML = '<div style="text-align: center; color: var(--text); opacity: 0.6; margin-top: 100px;">Select a Task # above to manage its form.</div>';
    return;
  }

  if (!bundle.forms) bundle.forms = {};
  if (!bundle.forms[currentTaskNumber]) {
    const searchRow = searchLog.find(row => row[0] === '#' + currentTaskNumber);
    const dateStamp = searchRow ? searchRow[1] : '';
    const teamNameWithCount = searchRow ? searchRow[7] : '';
    
    let teamName = '';
    if (teamNameWithCount) {
       const match = teamNameWithCount.match(/^(.*)\s\(\d+\)$/);
       teamName = match ? match[1] : teamNameWithCount;
    }

    const members = getTeamMembers(teamName).map(m => ({
      name: m[0],
      leader: m[2] === m[0],
      gps: false,
      radio: false,
      medic: false
    }));
    
    bundle.forms[currentTaskNumber] = {
      incidentNumber: '',
      opPeriod: '1',
      dateTime: dateStamp,
      lostPersonName: '',
      lostPersonAge: '',
      lostPersonGender: '',
      lostPersonDescription: '',
      lostPersonClothing: '',
      lostPersonPhysical: '',
      onSceneFamily: false,
      onSceneMedia: false,
      briefedBy: '',
      radioNumber: '',
      gpsNumber: '',
      leaveBase: '',
      beginSearch: '',
      completeSearch: '',
      returnBase: '',
      teamType: '', // Now using checklist
      teamTypes: { hasty: false, grid: false, area: false, k9: false, atv: false, argo: false, drone: false, boat: false, other: false },
      otherTeamType: '',
      instructions: '',
      teamName: teamName,
      teamMembers: members,
      statusUpdates: Array.from({length: 8}, () => ({time: '', clue: '', usng: ''}))
    };
    saveBundle(bundle);
    addActivityLogEntry(teamName, 'Task Form auto-created for #' + currentTaskNumber);
  }

  renderTaskForm(container, currentTaskNumber, bundle.forms[currentTaskNumber]);
}

function renderTaskForm(container, taskNum, formData) {
  const bundle = loadBundle();
  const profile = bundle.profile || {};
  const taskTag = '#' + taskNum;

  container.innerHTML = '';
  
  const form = document.createElement('div');
  form.className = 'task-form';
  
  const save = () => {
    const b = loadBundle();
    b.forms[taskNum] = formData;
    saveBundle(b);
  };

  // 1. Auto-fill from Profile if blank
  let changed = false;
  if (!formData.incidentNumber && profile.incidentNumber) { formData.incidentNumber = profile.incidentNumber; changed = true; }
  if (!formData.lostPersonName && profile.lostPersonName) { formData.lostPersonName = profile.lostPersonName; changed = true; }
  if (!formData.lostPersonAge && profile.lostPersonAge) { formData.lostPersonAge = profile.lostPersonAge; changed = true; }
  if (!formData.lostPersonGender && profile.lostPersonGender) { formData.lostPersonGender = profile.lostPersonGender; changed = true; }
  if (!formData.lostPersonDescription && profile.lostPersonDescription) { formData.lostPersonDescription = profile.lostPersonDescription; changed = true; }
  if (!formData.lostPersonClothing && profile.lostPersonClothing) { formData.lostPersonClothing = profile.lostPersonClothing; changed = true; }
  if (!formData.lostPersonPhysical && profile.lostPersonPhysical) { formData.lostPersonPhysical = profile.lostPersonPhysical; changed = true; }

  // 2. Auto-fill Timestamps from logs
  if (!formData.overrides) formData.overrides = {};

  const findLog = (actionPart) => {
    return bundle.activityLog.find(l => 
      (l.tag === taskTag || l.tag.startsWith(taskTag + ' - ')) && 
      l.action.toLowerCase().includes(actionPart.toLowerCase())
    );
  };

  const lLeave = findLog('leaving base') || findLog('leave base');
  if (lLeave) {
    const lTime = lLeave.time;
    const val = formData.overrides.leaveBase !== undefined ? formData.overrides.leaveBase : lTime;
    if (formData.leaveBase !== val) {
      formData.leaveBase = val; 
      changed = true; 
    }
  } else if (formData.overrides.leaveBase !== undefined) {
    if (formData.leaveBase !== formData.overrides.leaveBase) {
      formData.leaveBase = formData.overrides.leaveBase;
      changed = true;
    }
  }

  const lBegin = findLog('beginning search') || findLog('begin search') || findLog('beginning assignment') || findLog('begin assignment') || findLog('started search'); 
  if (lBegin) {
    const lTime = lBegin.time;
    const val = formData.overrides.beginSearch !== undefined ? formData.overrides.beginSearch : lTime;
    if (formData.beginSearch !== val) {
      formData.beginSearch = val; 
      changed = true; 
    }
  } else if (formData.overrides.beginSearch !== undefined) {
    if (formData.beginSearch !== formData.overrides.beginSearch) {
      formData.beginSearch = formData.overrides.beginSearch;
      changed = true;
    }
  }

  const lComplete = findLog('finished search') || findLog('finish search') || findLog('finished assignment') || findLog('finish assignment'); 
  if (lComplete) {
    const lTime = lComplete.time;
    const val = formData.overrides.completeSearch !== undefined ? formData.overrides.completeSearch : lTime;
    if (formData.completeSearch !== val) {
      formData.completeSearch = val; 
      changed = true; 
    }
  } else if (formData.overrides.completeSearch !== undefined) {
    if (formData.completeSearch !== formData.overrides.completeSearch) {
      formData.completeSearch = formData.overrides.completeSearch;
      changed = true;
    }
  }

  if (!formData.briefedBy) {
    const log = bundle.activityLog.find(l => 
      (l.tag === taskTag || l.tag.startsWith(taskTag + ' - ') || (l.tag.startsWith('base') && l.action.includes(taskTag))) && 
      (l.action.toLowerCase().includes('form auto-created') || l.action.toLowerCase().includes('form marked as completed'))
    );
    if (log) {
      const parts = log.tag.split(' - ');
      if (parts.length > 1) {
        formData.briefedBy = parts[1];
        changed = true;
      }
    }
  }
  
  const finishLog = findLog('finish') || findLog('complete') || findLog('returning to base');
  let arriveLog;
  if (finishLog) {
      const finishIdx = bundle.activityLog.indexOf(finishLog);
      arriveLog = [...bundle.activityLog.slice(0, finishIdx)].reverse().find(l => l.action.toLowerCase().includes('arrived at base') && l.team === formData.teamName);
  } else {
      arriveLog = bundle.activityLog.find(l => l.action.toLowerCase().includes('arrived at base') && l.team === formData.teamName);
  }
  if (arriveLog) {
     const lTime = arriveLog.time;
     const val = formData.overrides.returnBase !== undefined ? formData.overrides.returnBase : lTime;
     if (formData.returnBase !== val) {
       formData.returnBase = val;
       changed = true;
     }
  } else if (formData.overrides.returnBase !== undefined) {
    if (formData.returnBase !== formData.overrides.returnBase) {
      formData.returnBase = formData.overrides.returnBase;
      changed = true;
    }
  }

  // 3. 20 Minute Status (Par Checks)
    formData.parChecksRaw = [...bundle.activityLog]
    .filter(l => (l.tag === taskTag || l.tag.startsWith(taskTag + ' - ')) && (l.action.toLowerCase().includes('par check') || l.action.toLowerCase().includes('check-in')))
    .reverse();

  if (changed) save();

  let currentCard = null;

  const addSection = (title) => {
    currentCard = document.createElement('div');
    currentCard.className = 'form-card';
    form.appendChild(currentCard);

    const sec = document.createElement('div');
    sec.className = 'form-section';
    sec.innerHTML = `<h3>${title}</h3>`;
    currentCard.appendChild(sec);
  };

  const addGroup = (label, key, type = 'text', readonly = false) => {
    const grp = document.createElement('div');
    grp.className = 'form-group';
    grp.dataset.key = key;
    
    const labelContainer = document.createElement('div');
    labelContainer.style.display = 'flex';
    labelContainer.style.justifyContent = 'space-between';
    labelContainer.style.alignItems = 'center';
    labelContainer.style.width = '100%';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    labelContainer.appendChild(lbl);

    const isOverridden = ['leaveBase', 'beginSearch', 'completeSearch', 'returnBase'].includes(key) && formData.overrides?.[key] !== undefined;
    if (isOverridden) {
        const resetBtn = document.createElement('button');
        resetBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>';
        resetBtn.className = 'clear-btn';
        resetBtn.style.padding = '2px';
        resetBtn.style.marginLeft = '8px';
        resetBtn.title = 'Reset to activity log value';
        resetBtn.onclick = (e) => {
            e.preventDefault();
            delete formData.overrides[key];
            save();
            buildTaskAssignmentForm();
        };
        labelContainer.appendChild(resetBtn);
    }

    let inp;
    if (type === 'textarea') {
      inp = document.createElement('textarea');
      inp.style.minHeight = '60px';
    } else {
      inp = document.createElement('input');
      inp.type = type;
    }
    inp.className = 'form-input';
    inp.value = formData[key] || '';
    if (readonly) inp.readOnly = true;
    inp.oninput = () => {
      formData[key] = inp.value;
      if (['leaveBase', 'beginSearch', 'completeSearch', 'returnBase'].includes(key)) {
          if (!formData.overrides) formData.overrides = {};
          formData.overrides[key] = inp.value;
      }
      save();
    };
    grp.appendChild(labelContainer);
    grp.appendChild(inp);
    (currentCard || form).appendChild(grp);
  };

  addSection('Incident Information');
  addGroup('Incident #', 'incidentNumber');
  addGroup('OP Period', 'opPeriod');
  addGroup('Date/Time', 'dateTime');
  addGroup('Task #', 'taskNumDisplay', 'text', true);
  formData.taskNumDisplay = '#' + taskNum;

  addSection('Lost Person Information');
  addGroup('Name', 'lostPersonName');
  addGroup('Age', 'lostPersonAge');
  addGroup('Gender', 'lostPersonGender');
  addGroup('Description', 'lostPersonDescription');
  addGroup('Clothing', 'lostPersonClothing');
  addGroup('Physical / Medical', 'lostPersonPhysical');
  
  const cbGroup = document.createElement('div');
  cbGroup.className = 'form-checkbox-group';
  cbGroup.style.gridColumn = 'span 4';
  
  const addCB = (label, key) => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '10px';
    wrap.style.background = 'rgba(0,0,0,0.1)';
    wrap.style.padding = '8px 15px';
    wrap.style.borderRadius = '8px';
    wrap.style.border = '1px solid var(--line)';
    
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'pill-checkbox';
    cb.id = 'cb-' + key + '-' + taskNum;
    cb.checked = !!formData[key];
    cb.onchange = () => {
      formData[key] = cb.checked;
      save();
    };
    
    const lbl = document.createElement('label');
    lbl.setAttribute('for', cb.id);
    lbl.style.fontWeight = 'bold';
    lbl.style.cursor = 'pointer';
    lbl.style.fontSize = '0.9rem';
    lbl.textContent = label;
    
    wrap.appendChild(cb);
    wrap.appendChild(lbl);
    cbGroup.appendChild(wrap);
  };
  addCB('On Scene: Family', 'onSceneFamily');
  addCB('On Scene: Media', 'onSceneMedia');
  currentCard.appendChild(cbGroup);

  addSection('Assignment Details');
  addGroup('Briefed By', 'briefedBy');
  addGroup('Radio #', 'radioNumber');
  addGroup('GPS #', 'gpsNumber');
  
  // Team Type Checklist
  const ttSection = document.createElement('div');
  ttSection.className = 'form-group';
  ttSection.dataset.key = 'teamTypes';
  ttSection.style.gridColumn = 'span 4';
  ttSection.innerHTML = '<label>Team Type (Check all that apply)</label>';
  const ttWrap = document.createElement('div');
  ttWrap.style.display = 'flex';
  ttWrap.style.gap = '15px';
  ttWrap.style.flexWrap = 'wrap';
  ttWrap.style.marginTop = '5px';
  
  const types = ['hasty', 'grid', 'area', 'k9', 'atv', 'argo', 'drone', 'boat', 'other'];
  types.forEach(type => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '10px';
    wrap.style.background = 'rgba(0,0,0,0.1)';
    wrap.style.padding = '6px 12px';
    wrap.style.borderRadius = '8px';
    wrap.style.border = '1px solid var(--line)';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'pill-checkbox';
    chk.id = 'chk-' + type + '-' + taskNum;
    chk.checked = !!(formData.teamTypes && formData.teamTypes[type]);
    chk.onchange = () => {
      if (!formData.teamTypes) formData.teamTypes = {};
      formData.teamTypes[type] = chk.checked;
      save();
    };
    
    const lbl = document.createElement('label');
    lbl.setAttribute('for', chk.id);
    lbl.style.fontWeight = 'bold';
    lbl.style.cursor = 'pointer';
    lbl.style.fontSize = '0.85rem';
    const labels = {
      hasty: 'Hasty',
      grid: 'Grid',
      area: 'Area',
      k9: 'K9',
      atv: 'ATV',
      argo: 'Argo',
      drone: 'Drone',
      boat: 'Boat',
      other: 'Other'
    };
    lbl.textContent = labels[type] || (type.charAt(0).toUpperCase() + type.slice(1));
    
    wrap.appendChild(chk);
    wrap.appendChild(lbl);
    ttWrap.appendChild(wrap);
  });
  ttSection.appendChild(ttWrap);
  currentCard.appendChild(ttSection);
  addGroup('Other Type Description', 'otherTeamType');

  addSection('Operational Times');
  addGroup('Leave Base', 'leaveBase');
  addGroup('Begin Search', 'beginSearch');
  addGroup('Complete Search', 'completeSearch');
  addGroup('Return Base', 'returnBase');
  
  const parSec = document.createElement('div');
  parSec.className = 'form-group';
  parSec.dataset.key = 'parChecks';
  parSec.style.gridColumn = 'span 4';
  parSec.innerHTML = '<label>20 Minute Status (Par Checks)</label>';
  currentCard.appendChild(parSec);
  const parWrap = document.createElement('div');
  parWrap.style.display = 'flex';
  parWrap.style.flexDirection = 'column';
  parWrap.style.gap = '8px';
  parWrap.style.marginTop = '10px';

  (formData.parChecksRaw || []).forEach(log => {
     const row = document.createElement('div');
     row.className = 'pill-cell clickable-pill';
     row.style.display = 'flex';
     row.style.alignItems = 'center';
     row.style.gap = '10px';
     row.style.padding = '8px 15px';
     row.style.marginBottom = '5px';
     row.style.width = '100%';
     row.style.boxSizing = 'border-box';
     
     // 1. Log (Action)
     const actionText = document.createElement('span');
     actionText.textContent = log.action;
     actionText.style.fontSize = '0.9rem';
     actionText.style.flex = '1';
     row.appendChild(actionText);

     // 2. Timestamp
     const timePill = document.createElement('div');
     timePill.className = 'pill-cell readonly-pill';
     timePill.style.background = 'rgba(255,255,255,0.1)';
     timePill.textContent = log.time;
     row.appendChild(timePill);
     
     // 3. Team Members (Team Names)
     if (log.members) {
       const mContainer = document.createElement('div');
       mContainer.style.display = 'flex';
       mContainer.style.gap = '5px';
       log.members.split(', ').forEach(m => {
         const mPill = document.createElement('div');
         mPill.className = 'mini-pill';
         mPill.style.fontSize = '0.75rem';
         mPill.style.cursor = 'default';
         if (m.endsWith('*')) {
           mPill.style.background = 'var(--pill-focus)';
           mPill.style.borderColor = 'var(--accent)';
         }
         mPill.textContent = m;
         mContainer.appendChild(mPill);
       });
       row.appendChild(mContainer);
     }
     
     row.onclick = () => {
        const popup = createPopup('Edit Log Entry');
        const content = popup.querySelector('.popup-content');
        const btnContainer = popup.querySelector('.popup-buttons');
        
        const area = document.createElement('textarea');
        area.className = 'form-input';
        area.style.minHeight = '100px';
        area.style.marginBottom = '20px';
        area.value = log.action;
        content.insertBefore(area, btnContainer);
        
        const saveBtn = document.createElement('button');
        saveBtn.className = 'popup-btn primary';
        saveBtn.textContent = 'Save';
         saveBtn.onclick = async () => {
             await withSaveButtonFeedback(saveBtn, async () => {
                 const b = loadBundle();
                 const found = b.activityLog.find(l => l.id === log.id);
                 if (found) {
                     found.action = area.value.trim();
                     saveBundle(b);
                     closePopup(popup);
                     renderTaskForm(container, taskNum, formData);
                 } else {
                     // Fallback if no ID (for old logs)
                     const oldFound = b.activityLog.find(l => l.time === log.time && l.team === log.team && l.action === log.action);
                     if (oldFound) {
                         oldFound.action = area.value.trim();
                         saveBundle(b);
                         closePopup(popup);
                         renderTaskForm(container, taskNum, formData);
                     }
                 }
             });
        };
        btnContainer.appendChild(saveBtn);
     };
     
     parWrap.appendChild(row);
  });
  parSec.appendChild(parWrap);
  
  addSection('Personnel');
  const pContainer = document.createElement('div');
  pContainer.className = 'form-personnel-list';
  pContainer.style.gridColumn = 'span 4';
  pContainer.style.display = 'flex';
  pContainer.style.flexDirection = 'column';
  pContainer.style.gap = '8px';
  pContainer.style.marginTop = '10px';
  
  const renderPersonnelRow = (m, idx) => {
    const row = document.createElement('div');
    row.className = 'pill-cell';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '15px';
    row.style.padding = '8px 20px';
    row.style.width = '100%';
    row.style.boxSizing = 'border-box';
    
    if (m.leader) {
      row.style.background = 'var(--pill-focus)';
      row.style.borderColor = 'var(--accent)';
    }

    const nameSpan = document.createElement('span');
    nameSpan.contentEditable = 'true';
    nameSpan.textContent = m.name || '-- Empty --';
    nameSpan.style.flex = '1';
    nameSpan.style.fontWeight = '700';
    nameSpan.style.minWidth = '120px';
    nameSpan.onblur = () => {
      const oldName = m.name;
      m.name = nameSpan.textContent.trim();
      if (m.name !== oldName) {
        save();
        renderTaskForm(container, taskNum, formData);
      }
    };
    nameSpan.onkeydown = (e) => { 
      if(e.key === 'Enter') {
        e.preventDefault();
        nameSpan.blur();
      }
    };
    row.appendChild(nameSpan);

    // Hover trash icon inside the pill
    const trashIcon = document.createElement('div');
    trashIcon.className = 'pill-hover-trash no-print';
    trashIcon.title = 'Remove Member';
    trashIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
    trashIcon.onclick = (e) => {
       e.stopPropagation();
       if (confirm(`Remove ${m.name || 'this member'}?`)) {
         formData.teamMembers.splice(idx, 1);
         save();
         renderTaskForm(container, taskNum, formData);
       }
    };
    row.appendChild(trashIcon);

    const rolesWrap = document.createElement('div');
    rolesWrap.style.display = 'flex';
    rolesWrap.style.gap = '15px';
    rolesWrap.style.alignItems = 'center';

    const addRoleCB = (label, key) => {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '6px';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pill-checkbox';
      cb.id = `role-${key}-${idx}-${taskNum}`;
      cb.checked = !!m[key];
      cb.onchange = () => { 
        m[key] = cb.checked; 
        save(); 
        if (key === 'leader') renderTaskForm(container, taskNum, formData);
      };
      
      const lbl = document.createElement('label');
      lbl.setAttribute('for', cb.id);
      lbl.textContent = label;
      lbl.style.fontSize = '0.8rem';
      lbl.style.fontWeight = '600';
      lbl.style.color = 'var(--muted)';
      lbl.style.cursor = 'pointer';

      wrap.appendChild(cb);
      wrap.appendChild(lbl);
      rolesWrap.appendChild(wrap);
    };

    addRoleCB('Leader', 'leader');
    addRoleCB('GPS', 'gps');
    addRoleCB('Radio', 'radio');
    addRoleCB('Medic', 'medic');
    
    row.appendChild(rolesWrap);

    return row;
  };

  formData.teamMembers.forEach((m, idx) => {
    if (m.name) {
      pContainer.appendChild(renderPersonnelRow(m, idx));
    }
  });
  currentCard.appendChild(pContainer);

  // Add row button for personnel
  const addRowContainer = document.createElement('div');
  addRowContainer.style.gridColumn = 'span 4';
  addRowContainer.style.textAlign = 'right';
  addRowContainer.style.marginTop = '10px';
  const addPBtn = document.createElement('button');
  addPBtn.className = 'mini-pill';
  addPBtn.style.padding = '5px 15px';
  addPBtn.textContent = '+ Add Member';
  addPBtn.onclick = () => {
    // Show popup with all members not on this team
    const popup = createPopup('Add Team Member');
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');
    
    const roster = loadBundle().pages.page3 || [];
    const currentMemberNames = formData.teamMembers.map(m => m.name);
    const availableMembers = roster.filter(m => m[0] && !currentMemberNames.includes(m[0]));
    
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexWrap = 'wrap';
    list.style.gap = '10px';
    list.style.maxHeight = '300px';
    list.style.overflowY = 'auto';
    list.style.marginBottom = '20px';
    
    availableMembers.forEach(m => {
       const mBtn = document.createElement('button');
       mBtn.className = 'mini-pill';
       mBtn.textContent = m[0];
       mBtn.onclick = () => {
         formData.teamMembers.push({
           name: m[0],
           leader: m[0] === m[2],
           gps: m[3] === 'true',
           radio: m[4] === 'true',
           medic: m[5] === 'true'
         });
         save();
         popup.remove();
         renderTaskForm(container, taskNum, formData);
       };
       list.appendChild(mBtn);
    });
    
    if (availableMembers.length === 0) {
      list.innerHTML = '<p style="opacity: 0.6;">No more members available.</p>';
    }
    
    content.insertBefore(list, btnContainer);
  };
  addRowContainer.appendChild(addPBtn);
  currentCard.appendChild(addRowContainer);

  addSection('Assignment Instructions');
  const instGrp = document.createElement('div');
  instGrp.className = 'form-group';
  instGrp.dataset.key = 'instructions';
  instGrp.style.gridColumn = 'span 4';
  const instArea = document.createElement('textarea');
  instArea.className = 'form-input';
  instArea.style.minHeight = '150px';
  instArea.value = formData.instructions || '';
  instArea.oninput = () => { formData.instructions = instArea.value; save(); };
  instGrp.appendChild(instArea);
  currentCard.appendChild(instGrp);

  addSection('Form Completion');
  
  const compWrap = document.createElement('div');
  compWrap.className = 'form-group';
  compWrap.style.gridColumn = 'span 4';
  compWrap.style.display = 'flex';
  compWrap.style.alignItems = 'center';
  compWrap.style.gap = '12px';
  compWrap.style.background = 'rgba(125, 198, 255, 0.1)';
  compWrap.style.padding = '10px 20px';
  compWrap.style.borderRadius = '8px';
  compWrap.style.border = '1px solid var(--accent)';
  compWrap.style.width = 'fit-content';
  
  const compCheck = document.createElement('input');
  compCheck.type = 'checkbox';
  compCheck.className = 'pill-checkbox';
  compCheck.id = 'form-completed-check';
  compCheck.checked = !!formData.completed;
  
  const compLabel = document.createElement('label');
  compLabel.setAttribute('for', 'form-completed-check');
  compLabel.style.cursor = 'pointer';
  compLabel.style.fontWeight = '700';
  compLabel.textContent = formData.completedBy ? `Form Completed by ${formData.completedBy}` : 'Mark Form as Completed';
  
  compCheck.onchange = () => {
    if (compCheck.checked) {
      const user = getCurrentUser();
      const userName = user ? getAccountName(user) : 'Unknown User';

      formData.completed = true;
      formData.completedBy = userName;
      save();
      
      addActivityLogEntry(formData.teamName || 'N/A', `Form #${taskNum} marked as completed by ${userName}`);
      
      renderTaskForm(container, taskNum, formData);
      checkParChecksAndNotify(); // Refresh header if needed
      
      // Refresh Task Assignment pills immediately if on that page
      if (typeof buildTaskAssignmentForm === 'function') {
        buildTaskAssignmentForm();
      }
    } else {
      formData.completed = false;
      formData.completedBy = '';
      save();
      compLabel.textContent = 'Mark Form as Completed';
      checkParChecksAndNotify();
      
      // Refresh Task Assignment pills immediately if on that page
      if (typeof buildTaskAssignmentForm === 'function') {
        buildTaskAssignmentForm();
      }
    }
  };
  
  compLabel.onclick = () => compCheck.click();
  
  compWrap.appendChild(compCheck);
  compWrap.appendChild(compLabel);
  currentCard.appendChild(compWrap);

  container.appendChild(form);
}

const TASK_FORM_PRINT_STYLES = `
    @page { size: auto; margin: 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; margin: 0; padding: 0; }
    .print-container { max-width: 8.5in; margin: 0 auto; }
    .print-section { page-break-after: always; padding: 20px 0; }
    .print-section:last-child { page-break-after: auto; }
    
    h1 { font-size: 20pt; border-bottom: 2px solid #000; margin: 0 0 15px 0; padding-bottom: 5px; }
    h2 { font-size: 14pt; border-bottom: 1px solid #333; margin: 20px 0 10px 0; padding-bottom: 2px; }
    
    .task-form { border: 2px solid #000; padding: 15px; margin-bottom: 20px; position: relative; }
    .form-header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; margin-bottom: 15px; padding-bottom: 5px; }
    .form-section { margin-bottom: 12px; }
    .form-section-title { background: #eee !important; -webkit-print-color-adjust: exact; font-weight: bold; padding: 3px 8px; margin-bottom: 8px; font-size: 11pt; border: 1px solid #ccc; }
    .form-row { display: flex; gap: 15px; margin-bottom: 8px; }
    .form-field { flex: 1; border-bottom: 1px solid #999; min-height: 1.2em; padding-bottom: 2px; }
    .field-label { font-size: 8pt; color: #444; font-weight: bold; display: block; margin-bottom: 1px; text-transform: uppercase; }
    .field-value { font-size: 11pt; }

    .par-check-item { border-bottom: 1px dotted #ccc; padding: 4px 0; display: flex; align-items: baseline; }
    .par-check-time { font-weight: bold; width: 60px; font-size: 9pt; color: #444; }
    .par-check-action { flex: 1; font-size: 10pt; }
    
    @media screen {
        body { background: #f0f2f5; padding: 40px 0; }
        .print-container { background: #fff; padding: 40px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        .no-print { display: block; text-align: center; margin-bottom: 20px; }
    }
    @media print {
        .no-print { display: none; }
    }
`;

function getTaskFormPrintHTML(num, f) {
    const members = (f.teamMembers || []).map(m => {
        const details = [];
        if (m.leader) details.push('L');
        if (m.radio) details.push('R');
        if (m.gps) details.push('G');
        if (m.medic) details.push('M');
        const detailStr = details.length > 0 ? ` (${details.join(',')})` : '';
        return `${m.name}${detailStr}`;
    }).join(', ');
    
    // Team Types string
    const activeTypes = [];
    if (f.teamTypes) {
        Object.entries(f.teamTypes).forEach(([type, active]) => {
            if (active) {
                activeTypes.push(type === 'other' ? (f.otherTeamType || 'Other') : type.toUpperCase());
            }
        });
    }
    const teamTypeStr = activeTypes.length > 0 ? activeTypes.join(', ') : '';

    return `
                <div class="task-form">
                    <div class="form-header">
                        <span style="font-weight: bold; font-size: 16pt;">Task Assignment Form</span>
                        <span style="font-weight: bold; font-size: 16pt;">Task # ${num}</span>
                    </div>
                    
                    <div class="form-section">
                        <div class="form-section-title">1. INCIDENT OVERVIEW</div>
                        <div class="form-row">
                            <div class="form-field"><span class="field-label">Incident Name</span><div class="field-value">${f.incidentNumber || ''}</div></div>
                            <div class="form-field" style="flex:0.3;"><span class="field-label">Op Period</span><div class="field-value">${f.opPeriod || ''}</div></div>
                            <div class="form-field" style="flex:0.5;"><span class="field-label">Date/Time</span><div class="field-value">${f.dateTime || ''}</div></div>
                        </div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-title">2. SUBJECT INFORMATION</div>
                        <div class="form-row">
                             <div class="form-field"><span class="field-label">Subject Name</span><div class="field-value">${f.lostPersonName || ''}</div></div>
                             <div class="form-field" style="flex:0.2;"><span class="field-label">Age</span><div class="field-value">${f.lostPersonAge || ''}</div></div>
                             <div class="form-field" style="flex:0.2;"><span class="field-label">Gender</span><div class="field-value">${f.lostPersonGender || ''}</div></div>
                        </div>
                        <div class="form-row">
                             <div class="form-field"><span class="field-label">Description / Clothing</span><div class="field-value">${f.lostPersonDescription || ''} ${f.lostPersonClothing || ''}</div></div>
                        </div>
                        <div class="form-row">
                             <div class="form-field"><span class="field-label">Physical / Medical Information</span><div class="field-value">${f.lostPersonPhysical || ''}</div></div>
                             <div class="form-field" style="flex:0.4;"><span class="field-label">On Scene</span><div class="field-value">${[f.onSceneFamily ? 'Family' : '', f.onSceneMedia ? 'Media' : ''].filter(Boolean).join(', ') || 'None'}</div></div>
                        </div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-title">3. ASSIGNMENT DETAILS</div>
                        <div class="form-row">
                             <div class="form-field"><span class="field-label">Region/Segment</span><div class="field-value">${f.segment || ''}</div></div>
                             <div class="form-field"><span class="field-label">Team ID</span><div class="field-value">${f.teamName || ''}</div></div>
                             <div class="form-field" style="flex:0.6;"><span class="field-label">Team Type</span><div class="field-value">${teamTypeStr}</div></div>
                        </div>
                        <div class="form-row">
                             <div class="form-field"><span class="field-label">Task Objective</span><div class="field-value">${f.instructions || ''}</div></div>
                        </div>
                        <div class="form-row">
                             <div class="form-field"><span class="field-label">Briefed By</span><div class="field-value">${f.briefedBy || ''}</div></div>
                             <div class="form-field" style="flex:0.3;"><span class="field-label">Radio #</span><div class="field-value">${f.radioNumber || ''}</div></div>
                             <div class="form-field" style="flex:0.3;"><span class="field-label">GPS #</span><div class="field-value">${f.gpsNumber || ''}</div></div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <div class="form-section-title">4. PERSONNEL</div>
                        <div class="form-field"><span class="field-label">Team Members</span><div class="field-value">${members}</div></div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-title">5. TIMESTAMPS</div>
                        <div class="form-row">
                             <div class="form-field"><span class="field-label">Leave Base</span><div class="field-value">${f.leaveBase || ''}</div></div>
                             <div class="form-field"><span class="field-label">Begin Search</span><div class="field-value">${f.beginSearch || ''}</div></div>
                             <div class="form-field"><span class="field-label">Finish Search</span><div class="field-value">${f.completeSearch || ''}</div></div>
                             <div class="form-field"><span class="field-label">Return Base</span><div class="field-value">${f.returnBase || ''}</div></div>
                        </div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-title">6. PAR CHECKS (20 MINUTE STATUS)</div>
                        <div id="par-checks-${num}">
                            ${(f.parChecksRaw || []).length > 0 ? 
                                f.parChecksRaw.map(l => '<div class="par-check-item"><div class="par-check-time">' + l.time + '</div><div class="par-check-action">' + l.action + '</div></div>').join('') : 
                                '<div style="font-style: italic; color: #888; padding: 5px;">No par checks recorded for this task.</div>'
                            }
                        </div>
                    </div>

                    <div style="font-size: 8pt; color: #555; margin-top: 20px; border-top: 1px solid #eee; padding-top: 5px;">
                        * Personnel Markers: (L) Team Lead, (R) Radio, (G) GPS, (M) Medic
                    </div>
                </div>
    `;
}

function printSingleTaskForm(taskNum) {
    const bundle = loadBundle();
    const f = bundle.forms ? bundle.forms[taskNum] : null;
    if (!f) {
        alert("Form data not found.");
        return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Please allow popups to view the printout.");
        return;
    }

    printWindow.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Task Assignment Form - Task #${taskNum}</title>
    <style>${TASK_FORM_PRINT_STYLES}</style>
</head>
<body>
    <div class="no-print">
        <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 999px;">Print PDF</button>
        <p style="font-size: 12px; color: #666;">Note: Use "Save as PDF" in the print dialog for a digital copy.</p>
    </div>
    <div class="print-container">
        <div class="print-section">
            ${getTaskFormPrintHTML(taskNum, f)}
        </div>
    </div>
    <script>
        setTimeout(() => { window.print(); }, 500);
    </script>
</body>
</html>
    `);
    printWindow.document.close();
}

function downloadAllForms() {
  const bundle = loadBundle();
  const forms = bundle.forms || {};
  const taskNums = Object.keys(forms).sort((a,b) => parseInt(a) - parseInt(b));
  
  if (taskNums.length === 0) {
    alert("No forms found to download.");
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("Please allow popups to view the printout.");
    return;
  }

  let formsHTML = '';
  taskNums.forEach(num => {
    formsHTML += `<div class="print-section">${getTaskFormPrintHTML(num, forms[num])}</div>`;
  });

  printWindow.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <title>All Task Assignment Forms</title>
    <style>${TASK_FORM_PRINT_STYLES}</style>
</head>
<body>
    <div class="no-print">
        <button id="print-all-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 999px;">Print PDF</button>
        <p style="font-size: 12px; color: #666;">Note: Use "Save as PDF" in the print dialog for a digital copy.</p>
    </div>
    <div class="print-container">
        ${formsHTML}
    </div>
    <script>
        document.getElementById('print-all-btn').onclick = () => { window.print(); };
        setTimeout(() => { window.print(); }, 500);
    </script>
</body>
</html>
  `);
  printWindow.document.close();
}

function printSearchFile() {
    recalculateEverything();
    const bundle = loadBundle();
    const fileName = (bundle.fileName || "Search_File").replace('.json', '');
    
    const startTs = new Date(selectedChartStart).getTime();
    const endTs = new Date(selectedChartEnd).getTime();

    // Calculate metrics for charts using current chart settings
    const metrics = calculateHourlyMetrics(startTs, endTs);
    const psrcData = metrics.map(m => m.totalPSRc);
    const posData = metrics.map(m => m.totalPOS);

    const forms = bundle.forms || {};
    const taskFormsHTML = Object.keys(forms)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(num => `<div class="print-section">${getTaskFormPrintHTML(num, forms[num])}</div>`)
        .join('');

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Please allow popups to view the printout.");
        return;
    }

    printWindow.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Search File Printout - ${fileName}</title>
    <style>
        @page { size: auto; margin: 10mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; margin: 0; padding: 0; }
        .print-container { max-width: 8.5in; margin: 0 auto; }
        .print-section { page-break-after: always; padding: 20px 0; }
        .print-section:last-child { page-break-after: auto; }
        
        h1 { font-size: 20pt; border-bottom: 2px solid #000; margin: 0 0 15px 0; padding-bottom: 5px; }
        h2 { font-size: 14pt; border-bottom: 1px solid #333; margin: 20px 0 10px 0; padding-bottom: 2px; }
        
        .search-log-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 20px; }
        .search-log-table th, .search-log-table td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
        .search-log-table th { background: #eee !important; -webkit-print-color-adjust: exact; }
        
        .activity-log { font-size: 10pt; line-height: 1.0; }
        .activity-log-entry { margin-bottom: 1px; }
        .activity-log-time { font-weight: bold; margin-right: 5px; }

        .charts-container { display: flex; gap: 20px; margin-bottom: 20px; height: 180px; }
        .chart-item { flex: 1; display: flex; flex-direction: column; border: 1px solid #ddd; padding: 10px; border-radius: 8px; }
        .chart-label { font-size: 9pt; font-weight: bold; margin-bottom: 5px; color: #555; text-align: center; }
        .chart-svg-wrap { flex: 1; min-height: 140px; }

        .task-form { border: 2px solid #000; padding: 15px; margin-bottom: 20px; position: relative; }
        .form-header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; margin-bottom: 15px; padding-bottom: 5px; }
        .form-section { margin-bottom: 12px; }
        .form-section-title { background: #eee !important; -webkit-print-color-adjust: exact; font-weight: bold; padding: 3px 8px; margin-bottom: 8px; font-size: 11pt; border: 1px solid #ccc; }
        .form-row { display: flex; gap: 15px; margin-bottom: 8px; }
        .form-field { flex: 1; border-bottom: 1px solid #999; min-height: 1.2em; padding-bottom: 2px; }
        .field-label { font-size: 8pt; color: #444; font-weight: bold; display: block; margin-bottom: 1px; text-transform: uppercase; }
        .field-value { font-size: 11pt; }

        .par-check-item { border-bottom: 1px dotted #ccc; padding: 4px 0; display: flex; align-items: baseline; }
        .par-check-time { font-weight: bold; width: 60px; font-size: 9pt; color: #444; }
        .par-check-action { flex: 1; font-size: 10pt; }
        
        @media screen {
            body { background: #f0f2f5; padding: 40px 0; }
            .print-container { background: #fff; padding: 40px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            .no-print { display: block; text-align: center; margin-bottom: 20px; }
        }
        @media print {
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="no-print">
        <button id="print-file-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 999px;">Print PDF</button>
        <p style="font-size: 12px; color: #666;">Note: Use "Save as PDF" in the print dialog for a digital copy.</p>
    </div>

    <div class="print-container">
        <!-- Search Log & Charts -->
        <div class="print-section">
            <h1>Search Log: ${fileName}</h1>
            
            <div class="charts-container">
                <div class="chart-item">
                    <div class="chart-label">PSRc Sum Chart</div>
                    <div id="psrc-chart" class="chart-svg-wrap"></div>
                </div>
                <div class="chart-item">
                    <div class="chart-label">POS Sum Chart</div>
                    <div id="pos-chart" class="chart-svg-wrap"></div>
                </div>
            </div>

            <table class="search-log-table">
                <thead>
                    <tr>
                        <th>Task #</th><th>Date</th><th>Time</th><th>Region</th><th>Segment</th>
                        <th>PSR Before</th><th>PSR After</th><th>Team</th><th>Width</th><th>Sweeps</th>
                    </tr>
                </thead>
                <tbody id="sl-body"></tbody>
            </table>
        </div>

        <!-- Activity Log -->
        <div class="print-section">
            <h1>Activity Log</h1>
            <div id="al-body" class="activity-log"></div>
        </div>

        <!-- Task Forms -->
        <div id="forms-body">
            ${taskFormsHTML}
        </div>
    </div>

    <script>
        document.getElementById('print-file-btn').onclick = () => { window.print(); };
        const bundle = ${JSON.stringify(bundle)};
        const psrcData = ${JSON.stringify(psrcData)};
        const posData = ${JSON.stringify(posData)};
        const startTimeTs = ${startTs};
        const endTimeTs = ${endTs};

        // Render Search Log
        const slBody = document.getElementById('sl-body');
        (bundle.pages.page4 || []).forEach(row => {
            const tr = document.createElement('tr');
            for(let i=0; i<10; i++) {
                const td = document.createElement('td');
                td.textContent = row[i] || '';
                tr.appendChild(td);
            }
            slBody.appendChild(tr);
        });

        // Render Activity Log
        const alBody = document.getElementById('al-body');
        (bundle.activityLog || []).forEach(entry => {
            const tagPart = entry.tag || 'base';
            const displayTag = tagPart.split(' - ')[0];
            const userName = tagPart.includes(' - ') ? tagPart.split(' - ')[1] : '';
            const div = document.createElement('div');
            div.className = 'activity-log-entry';
            div.innerHTML = '<span class="activity-log-time">[' + entry.date + ' ' + entry.time + ' ' + displayTag + (userName ? ' (' + userName + ')' : '') + ']</span> Team ' + entry.team + ' (' + (entry.members || '') + '): ' + entry.action;
            alBody.appendChild(div);
        });

        // Charts
        function formatHourOffset(ts) {
            const date = new Date(ts);
            if (isNaN(date.getTime())) return '00:00';
            return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
        }

        function drawLineChart(containerId, data, color, isPOS) {
            const container = document.getElementById(containerId);
            const width = container.clientWidth || 350;
            const height = container.clientHeight || 140;
            const padding = { top: 10, right: 10, bottom: 30, left: 45 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            const max = Math.max(...data, isPOS ? 0.01 : 1);

            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("width", "100%");
            svg.setAttribute("height", "100%");
            svg.setAttribute("viewBox", "0 0 " + width + " " + height);
            
            // Y-axis ticks
            for (let i = 0; i <= 4; i++) {
                const val = (max / 4) * i;
                const y = height - padding.bottom - (val / max) * chartHeight;
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", padding.left - 5);
                text.setAttribute("y", y + 3);
                text.setAttribute("text-anchor", "end");
                text.setAttribute("font-size", "8");
                text.setAttribute("fill", "#666");
                text.textContent = isPOS ? (val * 100).toFixed(0) + '%' : val.toFixed(1);
                svg.appendChild(text);
                
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute("x1", padding.left); line.setAttribute("y1", y);
                line.setAttribute("x2", width - padding.right); line.setAttribute("y2", y);
                line.setAttribute("stroke", "#eee");
                svg.appendChild(line);
            }

            // X-axis ticks
            const numXTicks = 10;
            const durationMs = endTimeTs - startTimeTs;
            for (let i = 0; i <= numXTicks; i++) {
                const tickTs = startTimeTs + (i / numXTicks) * durationMs;
                const x = padding.left + (i / numXTicks) * chartWidth;
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", x);
                text.setAttribute("y", height - 10);
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("font-size", "7");
                text.setAttribute("fill", "#666");
                text.textContent = formatHourOffset(tickTs);
                svg.appendChild(text);
            }

            // Path
            if (data.length > 1) {
                const points = data.map((val, i) => ({
                    x: padding.left + (i / (data.length - 1)) * chartWidth,
                    y: height - padding.bottom - (val / max) * chartHeight
                }));
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                let d = 'M ' + points[0].x + ' ' + points[0].y;
                for (let i = 0; i < points.length - 1; i++) {
                    const curr = points[i]; const next = points[i + 1];
                    const cp1x = curr.x + (next.x - curr.x) / 3;
                    const cp2x = curr.x + 2 * (next.x - curr.x) / 3;
                    d += ' C ' + cp1x + ' ' + curr.y + ', ' + cp2x + ' ' + next.y + ', ' + next.x + ' ' + next.y;
                }
                path.setAttribute("d", d); path.setAttribute("fill", "none");
                path.setAttribute("stroke", color); path.setAttribute("stroke-width", "2");
                svg.appendChild(path);
            }
            container.appendChild(svg);
        }
        drawLineChart('psrc-chart', psrcData, '#007bff', false);
        drawLineChart('pos-chart', posData, '#fd7e14', true);

        // Auto-print
        setTimeout(() => {
            window.print();
        }, 1000);
    </script>
</body>
</html>
    `);
    printWindow.document.close();
}

function buildManageFormsTable() {
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  if (!tableHead || !tableBody) return;

  const bundle = loadBundle();
  const searchLog = bundle.pages.page4 || [];
  const forms = bundle.forms || {};

  const unfinishedTasks = new Set();
  if (bundle.currentAssignments && bundle.teamStatuses) {
    for (const team in bundle.currentAssignments) {
      const status = bundle.teamStatuses[team] || '';
      const assignment = bundle.currentAssignments[team] || '';
      if (!status.includes('at base') && assignment !== 'Base' && assignment !== 'None' && assignment !== '') {
        const match = assignment.match(/#(\d+)/);
        if (match) unfinishedTasks.add(match[1]);
      }
    }
  }
  
  const taskMap = new Map();
  searchLog.forEach(row => {
    if (row[0] && row[0].startsWith('#')) {
      const num = row[0].substring(1);
      taskMap.set(num, {
        num: num,
        timestamp: row[1] + ' ' + (row[2] || ''),
        region: row[3],
        segment: row[4]
      });
    }
  });

  // Also include forms that might not be in search log (if any manual additions)
  Object.keys(forms).forEach(num => {
    if (!taskMap.has(num)) {
       taskMap.set(num, {
         num: num,
         timestamp: forms[num].dateTime || 'Manual',
         region: 'Manual',
         segment: 'Manual'
       });
    }
  });

  let tasks = Array.from(taskMap.values()).sort((a, b) => parseInt(a.num) - parseInt(b.num));

  if (highlightedRowIndex === -2 && window.lastAddedTaskNum) {
      highlightedRowIndex = tasks.findIndex(t => t.num === window.lastAddedTaskNum);
      window.lastAddedTaskNum = null;
  }

  // Requirement: "should have only one empty row" if no tasks
  if (tasks.length === 0) {
     tasks.push({ num: '?', timestamp: '', region: 'N/A', segment: 'N/A', isEmpty: true });
  }

  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  const headers = ['Task #', 'Region/Segment', 'Timestamp', 'Edit', 'Download'];
  const headerRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.className = 'fixed-header';
    headerRow.appendChild(th);
  });
  tableHead.appendChild(headerRow);

  tasks.forEach((task, idx) => {
    const tr = document.createElement('tr');
    animateNewRow(tr, idx);

    const tdTask = document.createElement('td');
    tdTask.setAttribute('data-label', 'Task #');
    const taskCell = document.createElement('div');
    taskCell.className = 'pill-cell readonly-pill';
    taskCell.textContent = task.isEmpty ? '-' : '#' + task.num;
    tdTask.appendChild(taskCell);
    tr.appendChild(tdTask);

    const tdInfo = document.createElement('td');
    tdInfo.setAttribute('data-label', 'Region/Segment');
    const infoCell = document.createElement('div');
    infoCell.className = 'pill-cell readonly-pill';
    infoCell.textContent = task.isEmpty ? '-' : `${task.region} - ${task.segment}`;
    tdInfo.appendChild(infoCell);
    tr.appendChild(tdInfo);

    const tdTime = document.createElement('td');
    tdTime.setAttribute('data-label', 'Timestamp');
    const timeCell = document.createElement('div');
    timeCell.className = 'pill-cell readonly-pill';
    timeCell.textContent = task.timestamp || '-';
    tdTime.appendChild(timeCell);
    tr.appendChild(tdTime);

    const tdEdit = document.createElement('td');
    tdEdit.setAttribute('data-label', 'Edit');
    const editBtn = document.createElement('button');
    editBtn.className = 'row-delete-btn update-pill';
    editBtn.textContent = 'Edit';
    if (task.isEmpty) editBtn.disabled = true;

    // Apply color highlighting
    const isUnfinished = unfinishedTasks.has(task.num);
    const form = forms[task.num];
    const isComplete = form && form.completed;
    if (isUnfinished) {
       editBtn.style.opacity = '0.5';
       editBtn.style.background = 'rgba(128, 128, 128, 0.2)';
    } else if (isComplete) {
       editBtn.style.background = 'rgba(76, 175, 80, 0.25)';
       editBtn.style.borderColor = 'rgba(76, 175, 80, 0.5)';
       editBtn.style.color = '#4caf50';
    } else if (!isComplete) {
       editBtn.style.background = 'rgba(255, 140, 0, 0.25)';
       editBtn.style.borderColor = 'rgba(255, 140, 0, 0.5)';
       editBtn.style.color = '#ff8c00';
    }

    editBtn.onclick = () => {
       currentTaskNumber = task.num;
       currentFormsSubpage = 'task-assignment';
       buildFormsPage();
    };
    tdEdit.appendChild(editBtn);
    tr.appendChild(tdEdit);

    const tdDown = document.createElement('td');
    tdDown.setAttribute('data-label', 'Download');
    const downBtn = document.createElement('button');
    downBtn.className = 'row-delete-btn update-pill';
    downBtn.textContent = 'Download';
    if (task.isEmpty) downBtn.disabled = true;

    if (isUnfinished) {
       downBtn.style.opacity = '0.5';
       downBtn.style.background = 'rgba(128, 128, 128, 0.2)';
    } else if (isComplete) {
       downBtn.style.background = 'rgba(76, 175, 80, 0.25)';
       downBtn.style.borderColor = 'rgba(76, 175, 80, 0.5)';
       downBtn.style.color = '#4caf50';
    } else if (!isComplete) {
       downBtn.style.background = 'rgba(255, 140, 0, 0.25)';
       downBtn.style.borderColor = 'rgba(255, 140, 0, 0.5)';
       downBtn.style.color = '#ff8c00';
    }

    downBtn.onclick = () => {
       const oldTitle = document.title;
       document.title = `SAR_TASK_ASSIGNMENT_FORM_Task_${task.num}`;
       currentTaskNumber = task.num;
       currentFormsSubpage = 'task-assignment';
       buildFormsPage();
       setTimeout(() => {
           window.print();
           document.title = oldTitle;
       }, 500);
    };
    tdDown.appendChild(downBtn);
    tr.appendChild(tdDown);

    tableBody.appendChild(tr);
  });

  // Requirement: "be able to add rows"
  const addRowContainer = document.createElement('div');
  addRowContainer.className = 'add-row-container';
  const addRowBtn = document.createElement('button');
  addRowBtn.className = 'add-row-btn';
  addRowBtn.textContent = '+ Create New Task Form Manually';
  addRowBtn.onclick = () => {
    const nextNum = getNextTaskNumber();
    const b = loadBundle();
    if (!b.forms) b.forms = {};
    const now = new Date();
    const dateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    b.forms[nextNum] = {
      incidentNumber: '',
      opPeriod: '1',
      dateTime: dateStr,
      lostPersonName: '',
      lostPersonAge: '',
      lostPersonGender: '',
      lostPersonDescription: '',
      lostPersonClothing: '',
      lostPersonPhysical: '',
      onSceneFamily: false,
      onSceneMedia: false,
      briefedBy: '',
      radioNumber: '',
      gpsNumber: '',
      leaveBase: '',
      beginSearch: '',
      completeSearch: '',
      returnBase: '',
      teamType: 'Manual Entry',
      instructions: '',
      teamMembers: Array.from({length: 8}, () => ({name: '', leader: false, gps: false, radio: false, medic: false})),
      statusUpdates: Array.from({length: 8}, () => ({time: '', clue: '', usng: ''}))
    };
    logCreation('Task Form', '#' + nextNum, b);
    saveBundle(b);
    highlightedRowIndex = -2;
    window.lastAddedTaskNum = nextNum;
    buildManageFormsTable();
  };
  addRowContainer.appendChild(addRowBtn);
  const existing = document.querySelector('.add-row-container');
  if (existing) existing.remove();
  tableBody.parentElement.after(addRowContainer);
}

function isTaskUnfinished(taskWithHash) {
  const bundle = loadBundle();
  if (!bundle.currentAssignments || !bundle.teamStatuses) return false;
  for (const team in bundle.currentAssignments) {
    const status = bundle.teamStatuses[team] || '';
    const assignment = bundle.currentAssignments[team] || '';
    if (!status.includes('at base') && assignment !== 'Base' && assignment !== 'None' && assignment !== '') {
      const match = assignment.match(/#(\d+)/);
      if (match && '#' + match[1] === taskWithHash) return true;
    }
  }
  return false;
}

function getLogSweepsDue() {
  const bundle = loadBundle();
  const searchLog = bundle.pages.page4 || [];
  const due = [];
  searchLog.forEach(row => {
    const taskNum = row[0];
    const numSweeps = row[9];
    if ((!numSweeps || numSweeps.toString().trim() === '') && !isTaskUnfinished(taskNum)) {
      due.push({
        taskNum: taskNum,
        region: row[3],
        segment: row[4],
        fullRow: row
      });
    }
  });
  return due;
}

function showLogSweepsPopup(taskNumWithHash) {
  const bundle = loadBundle();
  const searchLog = bundle.pages.page4 || [];
  const row = searchLog.find(r => r[0] === taskNumWithHash);
  if (!row) return;

  const popup = createPopup('Log Sweeps');
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');
  
  const info = document.createElement('div');
  info.style.marginBottom = '20px';
  info.style.display = 'flex';
  info.style.flexDirection = 'column';
  info.style.gap = '8px';
  
  // Create a display similar to the search log row
  const rowData = [
    { label: 'Task #', val: row[0] },
    { label: 'Date', val: row[1] },
    { label: 'Time', val: row[2] },
    { label: 'Region', val: row[3] },
    { label: 'Segment', val: row[4] },
    { label: 'Team', val: row[7] }
  ];
  
  rowData.forEach(d => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.innerHTML = `<span style="color:var(--muted);">${d.label}:</span> <span>${d.val}</span>`;
    info.appendChild(item);
  });
  
  const inputGrp = document.createElement('div');
  inputGrp.style.marginTop = '15px';
  inputGrp.innerHTML = `<label style="display:block; margin-bottom: 5px; font-weight: bold;">Number of Sweeps:</label>`;
  const sweepInput = document.createElement('input');
  sweepInput.type = 'number';
  sweepInput.className = 'pill-input';
  sweepInput.style.width = '100%';
  sweepInput.placeholder = 'Enter sweep count';
  inputGrp.appendChild(sweepInput);
  info.appendChild(inputGrp);
  
  content.insertBefore(info, btnContainer);
  
  const submitBtn = document.createElement('button');
  submitBtn.className = 'popup-btn primary';
  submitBtn.textContent = 'Submit';
  submitBtn.onclick = () => {
    const val = sweepInput.value.trim();
    if (!val) {
      alert("Please enter a sweep count.");
      return;
    }
    
    const b = loadBundle();
    const log = b.pages.page4 || [];
    const target = log.find(r => r[0] === taskNumWithHash);
    if (target) {
      target[9] = val; // Num of Sweeps is at index 9
      saveBundle(b);
      
      // Update local sortedData if we are on the segments page to avoid waiting for full rebuild if needed
      // Actually, refreshCurrentPageTable will handle it, but let's make sure it's smooth.
      
      recalculateEverything(); // Trigger cascading PSR recalculation
      closePopup(popup);
      
      // If we are on segments page, we can try to find the row and animate it out before refresh
      if (isSegmentsPage()) {
          const row = Array.from(document.querySelectorAll('#table-body tr')).find(tr => {
              const cells = tr.querySelectorAll('.pill-cell');
              return cells.length >= 2 && cells[0].textContent === target[3] && cells[1].textContent === target[4];
          });
          if (row) {
              row.style.transition = 'all 0.4s ease';
              row.classList.remove('log-sweeps-due');
              const btn = row.querySelector('.row-search-btn');
              if (btn) {
                  btn.style.transition = 'all 0.4s ease';
                  btn.classList.remove('log-sweeps-active');
                  btn.textContent = 'search';
              }
              // Wait for transition before full refresh to keep it smooth
              setTimeout(() => {
                  refreshCurrentPageTable();
              }, 400);
          } else {
              refreshCurrentPageTable();
          }
      } else {
          refreshCurrentPageTable();
      }
    }
  };
  btnContainer.appendChild(submitBtn);
}

function checkParChecksAndNotify(skipTableRefresh = false) {
  const bundle = loadBundle();
  const now = Date.now();
  const freqMs = (bundle.parCheckFrequency || 20) * 60 * 1000;
  
  if (!window._notifiedParChecks) window._notifiedParChecks = {};

  const data = bundle.pages.page3 || [];
  const teamsMap = new Map();
  const baseTeamNames = ['Base Support', 'Off Duty', 'Command'];
  
  data.forEach(row => {
    if (row[1] && isActiveMemberStatus(row[6]) && !baseTeamNames.includes(row[1])) {
      teamsMap.set(row[1], true);
    }
  });

  let totalDue = 0;

  teamsMap.forEach((_, teamName) => {
    const status = bundle.teamStatuses[teamName] || '';
    if (status.startsWith('at base')) return; // Skip teams at base

    const lastPar = bundle.parChecks?.[teamName];
    const leaveTime = bundle.teamLeaveTimes?.[teamName];
    const assignTime = bundle.teamAssignmentTimes?.[teamName];
    
    let startTime = 0;
    if (lastPar) startTime = Math.max(startTime, lastPar.lastTime);
    if (leaveTime) startTime = Math.max(startTime, leaveTime);
    if (assignTime) startTime = Math.max(startTime, assignTime);

    if (startTime > 0 && (now - startTime) >= freqMs) {
      totalDue++;
      
      const notifyKey = teamName + '_' + (lastPar?.lastTime || startTime);
      if (!window._notifiedParChecks[notifyKey]) {
        if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
          try {
            const membersData = getTeamMembers(teamName);
            const leadRow = membersData.find(m => m[0] === m[2]);
            const leadName = leadRow ? leadRow[0] : 'Unknown Lead';
            const otherMembers = membersData.filter(m => m[0] !== leadName).map(m => m[0]);
            
            let membersListStr = leadName;
            if (otherMembers.length > 0) {
              membersListStr += ` and ${otherMembers.join(', ')}`;
            }
            
            // Get last log entry for this team's task assignment
            let latestLogEntry = 'No log entry found.';
            if (bundle.activityLog) {
              const currentAssignment = bundle.currentAssignments[teamName] || '';
              const match = currentAssignment.match(/#(\d+)/);
              const currentTag = match ? match[0] : 'base';
              
              const teamLogs = bundle.activityLog.filter(l => l.team === teamName && (l.tag === currentTag || l.tag.startsWith(currentTag + ' - ')));
              if (teamLogs.length > 0) {
                latestLogEntry = teamLogs[0].action;
              }
            }

            const title = `Par Check Due`;
            const body = `${teamName}, ${membersListStr} Par Check is due; latest update was ${latestLogEntry}`;
            
            new Notification(title, { body: body });
            
            // Also show custom toast
            showToastNotification(title, body, () => navigateToPage('page3.html'), 'par-check-due');
            
            window._notifiedParChecks[notifyKey] = true;
          } catch (e) {}
        }
      }
    }
  });

  const parCheckDot = document.getElementById('par-check-dot');
  if (parCheckDot) {
    if (totalDue > 0) {
      parCheckDot.classList.add('active');
    } else {
      parCheckDot.classList.remove('active');
    }
  }

  const navPersonnel = document.getElementById('nav-personnel');
  if (navPersonnel) {
    if (totalDue > 0) {
      navPersonnel.title = `Par Checks Due - ${totalDue}`;
      navPersonnel.classList.add('par-check-due');
    } else {
      navPersonnel.title = 'Personnel';
      navPersonnel.classList.remove('par-check-due');
    }
  }

  const navSearchLog = document.getElementById('nav-search-log');
  if (navSearchLog) {
    const logSweepsDue = getLogSweepsDue();
    if (logSweepsDue.length > 0) {
      navSearchLog.title = 'Log Sweeps';
      navSearchLog.classList.add('log-sweeps-due');
    } else {
      navSearchLog.title = 'Search Log';
      navSearchLog.classList.remove('log-sweeps-due');
    }
  }

  const navProfile = document.getElementById('nav-profile');
  if (navProfile) {
    if (!bundle.profile || !bundle.profile.completed) {
      navProfile.classList.add('profile-incomplete');
    } else {
      navProfile.classList.remove('profile-incomplete');
    }
  }

  const downloadAllBtn = document.getElementById('download-all-forms-btn');
  if (downloadAllBtn) {
    const forms = bundle.forms || {};
    const taskNums = Object.keys(forms);
    let allCompleted = taskNums.length > 0;
    taskNums.forEach(num => {
      if (!forms[num].completed) allCompleted = false;
    });

    if (taskNums.length === 0) {
      downloadAllBtn.innerHTML = 'Download All Forms';
      downloadAllBtn.className = 'sub-nav-btn';
      downloadAllBtn.style.backgroundColor = '';
      downloadAllBtn.style.color = '';
      downloadAllBtn.style.borderColor = '';
    } else if (allCompleted) {
      downloadAllBtn.innerHTML = '✓ Download All Forms';
      downloadAllBtn.className = 'sub-nav-btn active';
      downloadAllBtn.style.background = 'rgba(46, 204, 113, 0.15)';
      downloadAllBtn.style.color = '#2ecc71';
      downloadAllBtn.style.borderColor = 'rgba(46, 204, 113, 0.45)';
    } else {
      downloadAllBtn.innerHTML = '⚠️ Download All Forms';
      downloadAllBtn.className = 'sub-nav-btn active';
      downloadAllBtn.style.background = 'rgba(255, 165, 0, 0.15)';
      downloadAllBtn.style.color = '#ffa500';
      downloadAllBtn.style.borderColor = 'rgba(255, 165, 0, 0.45)';
    }
  }

  updateNotifications();

  if (!skipTableRefresh && isPersonnelPage()) {
    refreshCurrentPageTable();
  }
}

function showToastNotification(title, text, action, extraClass = '') {
    const toast = document.createElement('div');
    toast.className = 'notif-toast ' + extraClass;
    
    // Position toasts further down if there are others
    const existingToasts = document.querySelectorAll('.notif-toast');
    let offset = 20;
    existingToasts.forEach(t => {
        offset += t.offsetHeight + 10;
    });
    toast.style.top = offset + 'px';

    const toastKey = title + text;

    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent); flex-shrink:0;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        <div style="flex-grow:1; margin-right:10px;">
            <div style="font-weight:700; font-size:0.9rem;">${title}</div>
            <div style="font-size:0.8rem; opacity:0.8;">${text}</div>
        </div>
        <button class="toast-close-btn" title="Dismiss" style="background:none; border:none; color:inherit; cursor:pointer; padding:5px; margin:-5px; opacity:0.6;">✕</button>
    `;

    const dismiss = () => {
        if (toast.classList.contains('dismissing')) return;
        toast.classList.add('dismissing');
        setTimeout(() => {
            toast.remove();
            repositionToasts();
        }, 400);
    };

    const closeBtn = toast.querySelector('.toast-close-btn');
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        const bundle = loadBundle();
        if (!bundle.dismissedNotifications.includes(toastKey)) {
            bundle.dismissedNotifications.push(toastKey);
            saveBundle(bundle);
        }
        dismiss();
    };

    toast.onclick = () => {
        action();
        dismiss();
    };
    document.body.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) {
            dismiss();
        }
    }, 5000);
}

function repositionToasts() {
    const toasts = document.querySelectorAll('.notif-toast');
    let offset = 20;
    toasts.forEach(t => {
        t.style.top = offset + 'px';
        offset += t.offsetHeight + 10;
    });
}

function promptMemberOffScene(member) {
  showTimePrompt('Mark Off Scene', (date, time) => {
    const bundle = loadBundle();
    const data = bundle.pages.page3 || [];
    const memberName = member[0];
    const originalRow = data.find(row => row[0] === memberName);
    
    if (originalRow) {
      originalRow[6] = 'false'; // On Scene = false
      // Do not clear team when marking off scene to allow assignment
      
      saveBundle(bundle);
      addActivityLogEntry('Personnel', `${memberName} is now Off Scene at ${date} ${time}`, null, memberName);
      refreshCurrentPageTable();
    }
  });
}

function updateNotifications() {
  const list = document.getElementById('notif-list');
  const dot = document.getElementById('notif-dot');
  if (!list) return;
  
  list.innerHTML = '';
  let count = 0;
  const bundle = loadBundle();

  if (!window._shownToasts) window._shownToasts = new Set();

  const add = (title, text, action, extraClass = '') => {
    count++;
    const item = document.createElement('div');
    item.className = 'notification-item ' + extraClass;
    item.innerHTML = `
      <div style="display:flex; gap:10px; align-items:flex-start; width:100%;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        <div style="flex-grow:1;">
          <div class="notification-item-title">${title}</div>
          <div class="notification-item-text">${text}</div>
        </div>
      </div>
    `;
    item.onclick = () => {
      action();
      document.getElementById('notif-sidebar').classList.remove('open');
    };
    list.appendChild(item);

    const toastKey = title + text;
    if (!window._shownToasts.has(toastKey) && !bundle.dismissedNotifications.includes(toastKey)) {
        window._shownToasts.add(toastKey);
        showToastNotification(title, text, action, extraClass);
    }
  };

  const sweeps = getLogSweepsDue();
  sweeps.forEach(d => {
    add('Log Sweeps', `Task ${d.taskNum} (${d.region}/${d.segment}) needs sweep count.`, () => {
      navigateToPage('page4.html');
    }, 'log-sweeps-due');
  });

  const teamsMap = new Map();
  const data = bundle.pages.page3 || [];
  const baseTeamNames = ['Base Support', 'Off Duty', 'Command'];
  data.forEach(row => {
    if (row[1] && isActiveMemberStatus(row[6]) && !baseTeamNames.includes(row[1])) {
       if (!teamsMap.has(row[1])) teamsMap.set(row[1], true);
    }
  });
  teamsMap.forEach((_, teamName) => {
    if (isParCheckDue(teamName, bundle)) {
      add('Par Check Due', `Team ${teamName} is due for a par check.`, () => {
        navigateToPage('page3.html');
      }, 'par-check-due');
    }
  });

  const searchLog = bundle.pages.page4 || [];
  const forms = bundle.forms || {};
  searchLog.forEach(row => {
    if (row[0] && row[0].startsWith('#')) {
      const num = row[0].substring(1);
      if (!isTaskUnfinished(row[0]) && (!forms[num] || !forms[num].completed)) {
        add('Fill Form', `Task #${num} (${row[3]}/${row[4]}) form needs completion.`, () => {
          navigateToPage(`page5.html?task=${num}`);
        });
      }
    }
  });

  if (!bundle.profile || !bundle.profile.completed) {
    add('Fill Incident Profile', 'Incident profile is not marked as completed.', () => {
      navigateToPage('page6.html');
    }, 'profile-incomplete');
  }

  if (dot) {
    if (count > 0) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  }
}

const PAGE_ORDER = [
  'home.html',
  'index.html',
  'page2.html',
  'page3.html',
  'page4.html',
  'page5.html',
  'page6.html',
  'page7.html',
  'page8.html',
  'page9.html',
  'settings.html'
];

function navigateToPage(targetUrl) {
    window.location.href = targetUrl;
}

function initPageTransitions() {
    document.addEventListener('click', e => {
        const a = e.target.closest('a');
        if (a && a.href && a.href.includes(window.location.origin) && !a.hasAttribute('download') && a.target !== '_blank') {
            const targetUrl = a.getAttribute('href');
            if (targetUrl !== '#' && !targetUrl.startsWith('javascript:')) {
                e.preventDefault();
                navigateToPage(targetUrl);
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initPageTransitions();
    
    if (!getSyncBucket()) {
        showBucketPromptPopup();
        return; // Stop initialization until bucket is set
    }
    
    // For new devices, attempt an immediate sync to get the latest file from the server
    if (!localStorage.getItem(BUNDLE_STORAGE_KEY)) {
        await syncWithServer();
    }
    
    const bundle = loadBundle();
    applyTheme(bundle);
    applyBackground(bundle);
    applyTipsVisibility(bundle);
    updateFileNameDisplay();
    updateHeaderProfile();
    syncMobileBottomNav();

    const currentUser = getCurrentUser();
    if (!currentUser) {
        const superAdmin = (bundle.accounts || []).find(a => a.pin === '1976');
        if (superAdmin) {
            setCurrentUser(superAdmin);
            checkAccess();
        } else {
            showLoginPopup();
        }
    } else {
        checkAccess();
    }

  const bell = document.getElementById('notif-bell');
  const sidebar = document.getElementById('notif-sidebar');
  const closeNotif = document.getElementById('close-notif');
  if (bell && sidebar) {
    bell.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg><div class="notification-dot" id="notif-dot"></div>';
    bell.onclick = () => sidebar.classList.toggle('open');
  }
  if (closeNotif && sidebar) {
    closeNotif.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeNotif.onclick = () => sidebar.classList.remove('open');
  }

  if (typeof Notification !== 'undefined' && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Remove Gummy Bear from permanent personnel if present
  const globalPersonnel = getPermanentPersonnel();
  if (globalPersonnel['Gummy Bear']) {
    delete globalPersonnel['Gummy Bear'];
    setPermanentPersonnel(globalPersonnel);
    // If we are on page3, we might need to refresh data to remove it from current view
    if (isPersonnelPage()) {
        const bundle = loadBundle();
        if (bundle.pages.page3) {
            bundle.pages.page3 = Array.isArray(bundle.pages.page3) ? bundle.pages.page3.filter(row => row[0] !== 'Gummy Bear') : bundle.pages.page3;
            saveBundle(bundle);
            buildPersonnelTable();
        }
    }
  }
  
  checkParChecksAndNotify();
  setInterval(checkParChecksAndNotify, 60000);

  // Auto-save every 5 minutes to the file list on the home page
  setInterval(() => {
    const bundle = loadBundle();
    if (bundle.fileName) {
      saveBundle(bundle);
      const statusEl = document.getElementById('save-status') || document.getElementById('home-status');
      if (statusEl) {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        statusEl.textContent = `Auto-saved at ${timestamp}`;
      }
      if (isHomePage()) {
        buildSavedFilesTable();
      }
    }
  }, 300000);

  if (isHomePage()) {
    buildHomePage();
    return;
  }

  if (isSettingsPage()) {
    buildSettingsPage();
    return;
  }

  if (isRegionsPage()) {
    buildRegionsTable();
  } else if (isSegmentsPage()) {
    buildSegmentsTable();
  } else if (isPersonnelPage()) {
    buildPersonnelTable();
    initBaseTeamsAccordion();
    initSearchTeamsAccordion();
  } else if (isSearchLogPage()) {
    buildSearchLogTable();
  } else if (isFormsPage()) {
    buildFormsPage();
      initTaskAssignmentMobileLayout();
  } else if (isProfilePage()) {
    buildProfilePage();
  } else if (isPage8()) {
    buildUserAccountPage();
  } else if (isPage9()) {
    buildUserManagementPage();
  } else if (isMapsPage()) {
    buildMapsPage();
  } else if (isUploadsPage()) {
    buildUploadsPage();
  } else {
    buildStandardTable();
  }
});

function initBaseTeamsAccordion() {
  const accordionHeader = document.getElementById('base-teams-accordion-header');
  const accordionContainer = document.getElementById('base-teams-container-header');
  if (!accordionHeader || !accordionContainer) return;

  // Restore state from localStorage
  const isCollapsed = localStorage.getItem('baseTeamsCollapsed') === 'true';
  if (isCollapsed) {
    accordionContainer.classList.add('collapsed');
  }

  accordionHeader.onclick = () => {
    accordionContainer.classList.toggle('collapsed');
    localStorage.setItem('baseTeamsCollapsed', accordionContainer.classList.contains('collapsed'));
  };
}

function initSearchTeamsAccordion() {
  const accordionHeader = document.getElementById('search-teams-accordion-header');
  const accordionContainer = document.getElementById('search-teams-container');
  if (!accordionHeader || !accordionContainer) return;

  // Restore state from localStorage
  const isCollapsed = localStorage.getItem('searchTeamsCollapsed') === 'true';
  if (isCollapsed) {
    accordionContainer.classList.add('collapsed');
  }

  accordionHeader.onclick = () => {
    accordionContainer.classList.toggle('collapsed');
    localStorage.setItem('searchTeamsCollapsed', accordionContainer.classList.contains('collapsed'));
  };
}

function buildUploadsPage() {
  const tableBody = document.getElementById('uploads-table-body');
  const uploadInput = document.getElementById('file-upload-input');
  const saveStatus = document.getElementById('save-status');
  if (!tableBody || !uploadInput) return;

  let bundle = loadBundle();
  if (!bundle.uploads) bundle.uploads = [];

  const render = () => {
    tableBody.innerHTML = '';
    bundle.uploads.forEach((file, index) => {
      const tr = document.createElement('tr');
      animateNewRow(tr, index);
      
      const tdName = document.createElement('td');
      tdName.dataset.label = 'File Name';
      const namePill = document.createElement('div');
      namePill.className = 'pill-cell readonly-pill';
      namePill.textContent = file.name;
      tdName.appendChild(namePill);
      tr.appendChild(tdName);
      
      const tdType = document.createElement('td');
      tdType.dataset.label = 'Type';
      const typePill = document.createElement('div');
      typePill.className = 'pill-cell readonly-pill';
      typePill.textContent = file.type || 'unknown';
      tdType.appendChild(typePill);
      tr.appendChild(tdType);
      
      const tdSize = document.createElement('td');
      tdSize.dataset.label = 'Size';
      const sizePill = document.createElement('div');
      sizePill.className = 'pill-cell readonly-pill';
      sizePill.textContent = (file.size / 1024).toFixed(2) + ' KB';
      tdSize.appendChild(sizePill);
      tr.appendChild(tdSize);
      
      const tdActions = document.createElement('td');
      tdActions.dataset.label = 'Actions';
      const btnContainer = document.createElement('div');
      btnContainer.className = 'tool-actions';
      btnContainer.style.justifyContent = 'center';
      
      const downBtn = document.createElement('button');
      downBtn.className = 'row-delete-btn update-pill';
      downBtn.textContent = 'Download';
      downBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = file.content;
        link.download = file.name;
        link.click();
      };
      
      const delBtn = document.createElement('button');
      delBtn.className = 'row-delete-btn update-pill';
      delBtn.style.color = 'var(--accent)';
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => {
        const fileName = bundle.uploads[index].name;
        bundle.uploads.splice(index, 1);
        logDeletion('Upload', fileName);
        saveBundle(bundle);
        render();
      };
      
      btnContainer.appendChild(downBtn);
      btnContainer.appendChild(delBtn);
      tdActions.appendChild(btnContainer);
      tr.appendChild(tdActions);
      
      tableBody.appendChild(tr);
    });
  };

  uploadInput.onchange = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    if (saveStatus) saveStatus.textContent = 'Uploading...';
    
    let processedCount = 0;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (re) => {
        bundle.uploads.push({
          name: file.name,
          type: file.type,
          size: file.size,
          content: re.target.result
        });
        logCreation('Upload', file.name, bundle);
        processedCount++;
        if (processedCount === files.length) {
          saveBundle(bundle);
          if (saveStatus) saveStatus.textContent = 'Saved.';
          render();
        }
      };
      reader.onerror = () => {
         processedCount++;
         if (saveStatus) saveStatus.textContent = 'Some uploads failed.';
         if (processedCount === files.length) {
            saveBundle(bundle);
            render();
         }
      };
      reader.readAsDataURL(file);
    });
  };

  render();
}

const R_MILES = 3958.8;

const haversine = (p1, p2) => {
    const lon1 = p1[0], lat1 = p1[1];
    const lon2 = p2[0], lat2 = p2[1];
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return 2 * R_MILES * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const polygonArea = (rings) => {
    let totalArea = 0;
    for (const ring of rings) {
        if (ring.length < 3) continue;
        let area = 0;
        const latRef = ring[0][1];
        const k = Math.cos(latRef * Math.PI / 180);
        for (let i = 0; i < ring.length - 1; i++) {
            const p1 = ring[i];
            const p2 = ring[i+1];
            const x1 = p1[0] * k * 69.172; // miles per degree lon
            const y1 = p1[1] * 69.172; // miles per degree lat
            const x2 = p2[0] * k * 69.172;
            const y2 = p2[1] * 69.172;
            area += (x1 * y2 - x2 * y1);
        }
        totalArea += Math.abs(area) / 2;
    }
    return totalArea * 640; // in acres
};

const getBoundingBoxDimensions = (coords) => {
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const process = (c) => {
        if (typeof c[0] === 'number') {
            if (c[0] < minLon) minLon = c[0];
            if (c[0] > maxLon) maxLon = c[0];
            if (c[1] < minLat) minLat = c[1];
            if (c[1] > maxLat) maxLat = c[1];
        } else {
            c.forEach(process);
        }
    };
    process(coords);
    if (minLon > maxLon) return { width: 0, height: 0 };
    const midLat = (minLat + maxLat) / 2;
    const width = haversine([minLon, midLat], [maxLon, midLat]);
    const height = haversine([0, minLat], [0, maxLat]);
    return { width, height };
};

const calculateGeometry = (item) => {
    let geom = item.geometry || item.properties?.geometry || item.attributes?.geometry || item;
    let props = item.properties || item.attributes || item;

    // Normalize CalTopo internal format to GeoJSON-like
    const isAssignment = props.class === 'Assignment' || props.type === 'Assignment' || geom.type === 'Assignment';
    if (['Shape', 'Assignment', 'Track', 'Route', 'Area', 'Sector', 'Buffer', 'Graphic', 'graphic'].includes(geom.type || props.class) && (item.vertices || props.vertices || item.pts || props.pts || item.coords || props.coords || item.coordinates || props.coordinates)) {
        const vertices = item.vertices || props.vertices || item.pts || props.pts || item.coords || props.coords || item.coordinates || props.coordinates;
        const isClosed = item.closed === true || props.closed === true || (isAssignment && (item.closed !== false && props.closed !== false));
        geom = {
            type: isClosed ? 'Polygon' : 'LineString',
            coordinates: isClosed ? [vertices] : vertices
        };
    } else if (['Marker', 'Clue', 'Point'].includes(geom.type || props.class) && (item.position || props.position)) {
        geom = {
            type: 'Point',
            coordinates: item.position || props.position
        };
    }

    if (geom.type === 'Point' && props.buffer > 0) {
        const radiusMi = props.buffer / 1609.34; // meters to miles
        const areaAcres = Math.PI * Math.pow(radiusMi, 2) * 640;
        const diameterMi = radiusMi * 2;
        return { area: areaAcres, length: diameterMi, width: diameterMi, height: diameterMi };
    }

    if (!geom || !geom.type || (!geom.coordinates && !geom.geometries)) return { area: 0, length: 0, width: 0, height: 0 };

    let area = 0;
    let length = 0;
    let width = 0;
    let height = 0;

    if (geom.type === 'LineString' || geom.type === 'MultiLineString' || geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        const dims = getBoundingBoxDimensions(geom.coordinates);
        width = dims.width;
        height = dims.height;
        length = Math.max(width, height);
        
        if (geom.type === 'Polygon') {
            area = polygonArea(geom.coordinates);
        } else if (geom.type === 'MultiPolygon') {
            area = 0;
            for (const poly of geom.coordinates) {
                area += polygonArea(poly);
            }
        } else {
            area = 0; // Actual area of a line is 0
        }
    } else if (geom.type === 'GeometryCollection') {
        let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
        const process = (c) => {
            if (typeof c[0] === 'number') {
                if (c[0] < minLon) minLon = c[0];
                if (c[0] > maxLon) maxLon = c[0];
                if (c[1] < minLat) minLat = c[1];
                if (c[1] > maxLat) maxLat = c[1];
            } else {
                c.forEach(process);
            }
        };
        for (const g of (geom.geometries || [])) {
            if (g.coordinates) process(g.coordinates);
            const res = calculateGeometry(g);
            area += res.area;
        }
        if (minLon <= maxLon) {
            const midLat = (minLat + maxLat) / 2;
            width = haversine([minLon, midLat], [maxLon, midLat]);
            height = haversine([0, minLat], [0, maxLat]);
            length = Math.max(width, height);
        }
    }

    return { area, length, width, height };
};

function buildCalTopoSegmentImportItem(feature) {
    const attrs = feature.attributes || feature.properties || {};
    const geometry = feature.geometry || feature;
    const name = attrs.name || attrs.label || attrs.title || 'Unnamed Graphic';
    const metrics = calculateGeometry(feature);

    return {
        region: '',
        segment: name,
        area: metrics.area > 0 ? metrics.area.toFixed(2) : '',
        length: metrics.length > 0 ? metrics.length.toFixed(2) : '',
        sweep: 20,
        typeKey: getCalTopoFeatureTypeKey(feature),
        typeLabel: getCalTopoFeatureTypeLabel(feature),
        width: metrics.width > 0 ? metrics.width.toFixed(2) : '0.00',
        height: metrics.height > 0 ? metrics.height.toFixed(2) : '0.00',
        feature,
        geometryType: geometry.type || attrs.class || attrs.type || 'Graphic'
    };
}

function showSegmentsImportPreviewPopup(segments, options = {}) {
    const popup = createPopup(options.title || 'Import Segments', null);
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');

    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.maxHeight = '90vh';
    content.style.width = '90vw';
    content.style.maxWidth = '1100px';

    const bodyContainer = document.createElement('div');
    bodyContainer.style.flex = '1';
    bodyContainer.style.display = 'flex';
    bodyContainer.style.flexDirection = 'column';
    bodyContainer.style.overflow = 'hidden';
    content.insertBefore(bodyContainer, btnContainer);

    bodyContainer.innerHTML = `
      <p style="margin-bottom: 15px; opacity: 0.8; flex-shrink: 0;">${options.description || 'Review segments to be imported:'}</p>
      <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" id="check-all-preview" checked style="width: 18px; height: 18px; cursor: pointer;">
          <label for="check-all-preview" style="cursor: pointer; font-weight: bold;">Check / Uncheck All</label>
      </div>
  `;

    const tableWrap = document.createElement('div');
    tableWrap.style.overflowX = 'auto';
    tableWrap.style.flex = '1';
    tableWrap.style.overflowY = 'auto';
    tableWrap.style.background = 'rgba(0,0,0,0.1)';
    tableWrap.style.borderRadius = '12px';

    const table = document.createElement('table');
    table.className = 'grid-table';
    table.style.width = '100%';

    const thead = document.createElement('thead');
    const headers = ['', 'Region', 'Segment', 'Area (acres)', 'Length (mi)', 'Sweep (ft)', 'Time per Sweep (hr)', 'PSRi', 'PSRc', 'CalTopo'];
    const htr = document.createElement('tr');
    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        th.style.padding = '12px';
        htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    segments.forEach((seg, idx) => {
        const tr = document.createElement('tr');
        const lengthVal = parseFloat(seg.length) || 0;
        const timeVal = lengthVal / 0.5;

        const tdCheck = document.createElement('td');
        tdCheck.style.textAlign = 'center';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'preview-checkbox';
        chk.dataset.index = idx;
        chk.checked = true;
        chk.style.width = '18px';
        chk.style.height = '18px';
        chk.style.cursor = 'pointer';
        tdCheck.appendChild(chk);
        tr.appendChild(tdCheck);

        const rowData = [
            seg.region || '',
            seg.segment,
            seg.area ? seg.area + ' ac' : '',
            seg.length ? seg.length + ' mi' : '',
            (seg.sweep || 20) + ' ft',
            timeVal > 0 ? timeVal.toFixed(2) + ' hr' : '',
            '',
            '',
            seg.feature?.attributes?.id || ''
        ];

        rowData.forEach((val) => {
            const td = document.createElement('td');
            const pill = document.createElement('div');
            pill.className = 'pill-cell readonly-pill';
            pill.style.padding = '8px 12px';
            pill.textContent = val;
            td.appendChild(pill);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    bodyContainer.appendChild(tableWrap);

    const checkAll = bodyContainer.querySelector('#check-all-preview');
    const checkboxes = bodyContainer.querySelectorAll('.preview-checkbox');
    checkAll.onchange = () => {
        checkboxes.forEach(cb => cb.checked = checkAll.checked);
    };

    btnContainer.innerHTML = '';
    btnContainer.style.display = 'flex';
    btnContainer.style.flexDirection = 'row';
    btnContainer.style.justifyContent = 'flex-end';
    btnContainer.style.marginTop = '20px';
    btnContainer.style.flexShrink = '0';
    btnContainer.style.gap = '12px';

    if (typeof options.onBack === 'function') {
        const backBtn = document.createElement('button');
        backBtn.className = 'popup-btn';
        backBtn.style.flex = '1';
        backBtn.textContent = options.backLabel || 'Back';
        backBtn.onclick = () => {
            closePopup(popup);
            options.onBack();
        };
        btnContainer.appendChild(backBtn);
    } else {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'popup-btn';
        cancelBtn.style.flex = '1';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => closePopup(popup);
        btnContainer.appendChild(cancelBtn);
    }

    const submitBtn = document.createElement('button');
    submitBtn.className = 'popup-btn primary';
    submitBtn.style.flex = '1';
    submitBtn.textContent = 'Submit Import';
    submitBtn.onclick = () => {
        const selected = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => segments[parseInt(cb.dataset.index)]);

        if (selected.length === 0) {
            alert('No segments selected.');
            return;
        }

        importSegmentsAction(selected);
        closePopup(popup);
    };
    btnContainer.appendChild(submitBtn);
}

function importSegmentsAction(segments) {
    const b = loadBundle();
    const segmentRows = ensureSegmentsPageRows(b);

    const importedNames = [];
    segments.forEach(seg => {
        const lengthVal = parseFloat(seg.length) || 0;
        const timeVal = lengthVal / 0.5;
        const newRow = [
            '',
            seg.segment,
            seg.area ? seg.area + ' ac' : '',
            seg.length ? seg.length + ' mi' : '',
            (seg.sweep || 20) + ' ft',
            timeVal > 0 ? timeVal.toFixed(2) + ' hr' : '',
            '',
            '',
            '',
            seg.feature?.attributes?.id || ''
        ];
        segmentRows.push(newRow);
        newlyImportedSegments.add(`|${seg.segment}`);
        importedNames.push(seg.segment);
    });

    if (importedNames.length > 0) {
        addActivityLogEntry('System', 'Imported segments: ' + importedNames.join(', '), b);
    }

    saveBundle(b);
    recalculateEverything();
    if (isSegmentsPage()) buildSegmentsTable();

    setTimeout(() => {
        newlyImportedSegments.clear();
        if (isSegmentsPage()) buildSegmentsTable();
    }, 7000);
}

async function showCalTopoLinkPopup(originalIdx) {
    const bundle = loadBundle();
    const map = bundle.maps?.[0];
    if (!map || !map.id) {
        alert('Please add a CalTopo map first on the Maps page.');
        return;
    }

    let features = map.features || [];
    if (features.length === 0) {
        const confirmFetch = confirm('No CalTopo features loaded. Fetch them now?');
        if (confirmFetch) {
            try {
                const fetchBtn = document.getElementById('fetch-shapes-btn');
                if (fetchBtn) fetchBtn.click(); // If on maps page
                else await caltopo_request(null, {silent: false});
                
                const updatedBundle = loadBundle();
                features = updatedBundle.maps?.[0]?.features || [];
                if (features.length === 0) {
                    alert('Still no features found after fetch.');
                    return;
                }
            } catch (err) {
                alert('Error fetching shapes: ' + err.message);
                return;
            }
        } else {
            return;
        }
    }

    const assignments = features.filter(f => getCalTopoFeatureTypeKey(f) === 'assignment');
    if (assignments.length === 0) {
        alert('No assignment shapes (polygons) found on this map.');
        return;
    }

    const popup = createPopup('Link Segment to CalTopo', null);
    const content = popup.querySelector('.popup-content');
    
    content.innerHTML = `
        <p style="margin-bottom: 15px; opacity: 0.8;">Select a CalTopo assignment to link with this segment. This ID will be used for color updates.</p>
        <div style="max-height: 400px; overflow-y: auto; background: rgba(0,0,0,0.1); border-radius: 12px; border: 1px solid var(--line);">
            <table class="grid-table" style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="padding: 12px; text-align: left; background: var(--header-bg); position: sticky; top: 0;">Name</th>
                        <th style="padding: 12px; text-align: left; background: var(--header-bg); position: sticky; top: 0;">ID</th>
                        <th style="padding: 12px; text-align: center; background: var(--header-bg); position: sticky; top: 0;">Action</th>
                    </tr>
                </thead>
                <tbody id="caltopo-link-list"></tbody>
            </table>
        </div>
    `;
    
    const tbody = content.querySelector('#caltopo-link-list');
    assignments.forEach(feat => {
        const tr = document.createElement('tr');
        const attrs = feat.attributes || {};
        const name = attrs.name || 'Unnamed Graphic';
        const id = attrs.id;
        
        tr.innerHTML = `
            <td style="padding: 12px; border-bottom: 1px solid var(--line);">${name}</td>
            <td style="padding: 12px; border-bottom: 1px solid var(--line); font-family: monospace; font-size: 0.8rem; color: var(--muted);">${id}</td>
            <td style="padding: 12px; border-bottom: 1px solid var(--line); text-align: center;">
                <button class="mini-pill select-link" style="cursor: pointer; padding: 6px 12px;">Link</button>
            </td>
        `;
        
        tr.querySelector('.select-link').onclick = () => {
            const bundleToUpdate = loadBundle();
            const data = bundleToUpdate.pages.page2;
            if (data && data[originalIdx]) {
                data[originalIdx][9] = id;
                saveBundle(bundleToUpdate);
                popup.remove();
                buildSegmentsTable();
                addActivityLogEntry('System', `Linked segment to CalTopo feature "${name}" (${id})`);
            }
        };
        
        tbody.appendChild(tr);
    });
}

function showImportSegmentsPopup() {
  const bundle = loadBundle();
  const uploads = bundle.uploads || [];
  const jsonFiles = uploads.filter(f => f.name.toLowerCase().endsWith('.json'));

  if (jsonFiles.length === 0) {
    alert("No JSON files found in uploads. Please upload JSON files on the Uploads page first.");
    return;
  }

  const popup = createPopup('Import Segments from JSON', null);
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');

  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.maxHeight = '90vh';

  const bodyContainer = document.createElement('div');
  bodyContainer.style.flex = '1';
  bodyContainer.style.display = 'flex';
  bodyContainer.style.flexDirection = 'column';
  bodyContainer.style.overflow = 'hidden';
  content.insertBefore(bodyContainer, btnContainer);

  function renderFileSelection() {
    bodyContainer.innerHTML = '<p style="margin-bottom: 15px; opacity: 0.8; flex-shrink: 0;">Select one or more JSON files to import as segments:</p>';
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '10px';
    list.style.flex = '1';
    list.style.overflowY = 'auto';
    list.style.paddingRight = '5px';

    jsonFiles.forEach((file, index) => {
      const label = document.createElement('label');
      label.className = 'pill-cell-container clickable-pill';
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '15px';
      label.style.padding = '12px 20px';
      label.style.background = 'rgba(255,255,255,0.03)';
      label.style.border = '1px solid var(--pill-border)';
      label.style.borderRadius = '999px';
      label.style.cursor = 'pointer';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'pill-checkbox';
      chk.dataset.index = index;
      
      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML = `<div style="font-weight:700;">${file.name}</div><div style="font-size:0.8rem; opacity:0.6;">${(file.size / 1024).toFixed(2)} KB</div>`;
      
      label.appendChild(chk);
      label.appendChild(info);
      list.appendChild(label);
    });

    bodyContainer.appendChild(list);

    btnContainer.innerHTML = '';
    btnContainer.style.display = 'flex';
    btnContainer.style.flexDirection = 'row';
    btnContainer.style.justifyContent = 'flex-end';
    btnContainer.style.marginTop = '20px';
    btnContainer.style.flexShrink = '0';
    btnContainer.style.gap = '12px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'popup-btn';
    cancelBtn.style.flex = '1';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => closePopup(popup);
    btnContainer.appendChild(cancelBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'popup-btn primary';
    nextBtn.style.flex = '1';
    nextBtn.textContent = 'Preview Import';
    nextBtn.onclick = () => {
      const selectedIndices = Array.from(bodyContainer.querySelectorAll('.pill-checkbox:checked')).map(cb => parseInt(cb.dataset.index));
      if (selectedIndices.length === 0) {
        alert("Please select at least one file.");
        return;
      }
      processFiles(selectedIndices.map(i => jsonFiles[i]));
    };
    btnContainer.appendChild(nextBtn);
  }

  function processFiles(files) {
    const segmentsToImport = [];

    const findProp = (item, keys) => {
      const p = item.properties || item.attributes || item.fields || {};
      for (const k of keys) {
        const found = Object.keys(p).find(x => x.toLowerCase() === k.toLowerCase());
        if (found && p[found] !== undefined && p[found] !== null && p[found] !== '') return { value: p[found], key: found };
        const foundTop = Object.keys(item).find(x => x.toLowerCase() === k.toLowerCase());
        if (foundTop && item[foundTop] !== undefined && item[foundTop] !== null && item[foundTop] !== '') return { value: item[foundTop], key: foundTop };
      }
      return null;
    };

    const calculateGeometryLocal = (item) => {
        return calculateGeometry(item);
    };

    const areaKeys = ['acres', 'area', 'size', 'sqmi', 'sq_mi', 'shape_area', 'st_area', 'hectares', 'ha', 'gis_acres', 'acres_total', 'sqft', 'sq_ft', 'sqkm', 'sq_km', 'total_acres'];
    const lengthKeys = ['length', 'len', 'leng', 'shape_leng', 'distance', 'mi', 'miles', 'shape_length', 'st_length', 'dist', 'width', 'height', 'ft', 'feet', 'km', 'meters', 'm', 'shape_len'];

    files.forEach(file => {
      let jsonText = '';
      try {
        if (file.content.startsWith('data:')) {
          const base64 = file.content.split(',')[1];
          const binString = atob(base64);
          const bytes = Uint8Array.from(binString, c => c.charCodeAt(0));
          jsonText = new TextDecoder().decode(bytes);
        } else {
          jsonText = file.content;
        }
      } catch (e) {
        console.error("Failed to decode file", file.name, e);
        return;
      }

      let data;
      try {
        data = JSON.parse(jsonText);
      } catch (e) {
        console.error("Failed to parse JSON", file.name, e);
        return;
      }

      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.features && Array.isArray(data.features)) {
        items = data.features;
      } else {
        items = [data];
      }

      items.forEach((item, idx) => {
        let name = file.name.replace(/\.json$/i, '');
        if (items.length > 1) {
            const innerNameRes = findProp(item, ['name', 'segment', 'label', 'title']);
            if (innerNameRes) {
                name = String(innerNameRes.value);
            } else {
                name += ` - ${idx + 1}`;
            }
        }
        
        const areaRes = findProp(item, areaKeys);
        const lengthRes = findProp(item, lengthKeys);
        
        let areaDefaultUnit = 'ac';
        if (areaRes) {
          const lk = areaRes.key.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (lk.includes('sqmi')) areaDefaultUnit = 'sqmi';
          else if (lk.includes('ha') || lk.includes('hectare')) areaDefaultUnit = 'ha';
          else if (lk.includes('sqkm')) areaDefaultUnit = 'sqkm';
          else if (lk.includes('sqm') || lk.includes('starea') || lk.includes('shapearea')) areaDefaultUnit = 'sqm';
          else if (lk.includes('sqft')) areaDefaultUnit = 'sqft';
        }

        let lengthDefaultUnit = 'mi';
        if (lengthRes) {
          const lk = lengthRes.key.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (lk.includes('km')) lengthDefaultUnit = 'km';
          else if (lk.includes('ft') || lk.includes('feet')) lengthDefaultUnit = 'ft';
          else if (lk.includes('mi') && !lk.includes('sqmi')) lengthDefaultUnit = 'mi';
          else if (lk.includes('m') && !lk.includes('mi')) lengthDefaultUnit = 'm';
          else if (lk.includes('stlength') || lk.includes('shapelength') || lk.includes('shapeleng') || lk.includes('perimeter')) lengthDefaultUnit = 'm';
        }
        
        let area = areaRes ? parseWithUnits(String(areaRes.value), areaDefaultUnit) : 0;
        let lengthVal = lengthRes ? parseWithUnits(String(lengthRes.value), lengthDefaultUnit) : 0;
        
        // If still 0, try geometry calculation
        if (area === 0 || lengthVal === 0) {
            const geomRes = calculateGeometryLocal(item);
            if (area === 0 && geomRes.area > 0) area = geomRes.area;
            if (lengthVal === 0 && geomRes.length > 0) lengthVal = geomRes.length;
        }

        // Fallback for length if not found but width/height exist
        if (lengthVal === 0) {
          const w = findProp(item, ['width']);
          const h = findProp(item, ['height']);
          if (w || h) {
             const wv = w ? parseWithUnits(String(w.value), 'mi') : 0;
             const hv = h ? parseWithUnits(String(h.value), 'mi') : 0;
             lengthVal = Math.max(wv, hv);
          }
        }
        
        segmentsToImport.push({
          region: '',
          segment: name,
          area: area > 0 ? area.toFixed(2) : '',
          length: lengthVal > 0 ? lengthVal.toFixed(2) : '',
          sweep: 20
        });
      });
    });

      closePopup(popup);
      showSegmentsImportPreviewPopup(segmentsToImport, {
          title: 'Import Segments from JSON',
          onBack: showImportSegmentsPopup
      });
  }

  function parseWithUnits(valStr, defaultUnit) {
    if (!valStr) return 0;
    // Clean string for parsing numeric value: handle commas as thousand separators
    const cleanStr = String(valStr).replace(/,/g, '');
    const val = parseFloat(cleanStr);
    if (isNaN(val)) return 0;

    const lower = String(valStr).toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // String contains units - they override defaultUnit
    if (lower.includes('sqkm') || lower.includes('squarekilometer')) return val * 247.105;
    if (lower.includes('sqm') || lower.includes('m2') || lower.includes('squaremeter')) return val * 0.000247105;
    if (lower.includes('ha') || lower.includes('hectare')) return val * 2.47105;
    if (lower.includes('sqft') || lower.includes('ft2') || lower.includes('squarefeet')) return val / 43560;
    if (lower.includes('sqmi') || lower.includes('squaremiles')) return val * 640;
    if (lower.includes('acres') || (lower.includes('ac') && !lower.includes('active'))) {
        if (!lower.includes('sqm') && !lower.includes('ha') && !lower.includes('sqft') && !lower.includes('sqmi')) {
            return val;
        }
    }

    if (lower.includes('km') || lower.includes('kilometers')) return val * 0.621371;
    if (lower.includes('ft') || lower.includes('feet')) return val / 5280;
    if (lower.includes('meters') || (lower.includes('m') && !lower.includes('mi') && !lower.includes('km'))) return val * 0.000621371;

    // No units in string, use defaultUnit
    if (defaultUnit === 'sqkm') return val * 247.105;
    if (defaultUnit === 'sqm') return val * 0.000247105;
    if (defaultUnit === 'ha') return val * 2.47105;
    if (defaultUnit === 'sqft') return val / 43560;
    if (defaultUnit === 'sqmi') return val * 640;
    if (defaultUnit === 'km') return val * 0.621371;
    if (defaultUnit === 'm') return val * 0.000621371;
    if (defaultUnit === 'ft') return val / 5280;
    
    return val;
  }

  renderFileSelection();
}

function startCalTopoSetupWalkthrough(step = 1) {
    let title = "CalTopo Setup Guide (1/4)";
    let body = "";
    let btnText = "Next";
    let nextStep = step + 1;

    if (step === 1) {
        title = "Welcome to CalTopo Integration (1/4)";
        body = `
      <p>This guide will help you set up <strong>CalTopo</strong> integration correctly.</p>
      <p style="margin-top:10px;">To fetch shapes (polygons and assignments) directly from CalTopo, we use a <strong>Web Proxy</strong> to avoid browser security (CORS) issues.</p>
      <p style="margin-top:10px;"><strong>Goal:</strong> Get your map data flowing into the Segments table without needing to run any scripts locally!</p>
    `;
    } else if (step === 2) {
        title = "Step 1: Web-Hosted Middleman (2/4)";
        body = `
      <p>We have moved the "middleman" to the web. You no longer need to run <code>middleman.py</code> on your computer.</p>
      <p style="margin-top:10px;">The proxy is hosted at:</p>
      <code style="display:block; padding: 10px; background: rgba(0,0,0,0.05); border-radius: 4px; margin: 10px 0;">https://sarwebtheory2-production.up.railway.app</code>
      <p style="margin-top:10px; font-size: 0.9rem; color: var(--muted);">This service handles all CalTopo traffic securely and enables this site to fetch your private or public map data.</p>
    `;
    } else if (step === 3) {
        title = "Step 2: Configure Proxy URL (3/4)";
        body = `
      <p>Now, ensure this software knows where to find the web proxy.</p>
      <ul style="margin-left: 20px; margin-top: 10px; line-height: 1.6;">
        <li>Go to the <strong>Settings</strong> page.</li>
        <li>Look for <strong>CalTopo Proxy Settings</strong>.</li>
        <li>Ensure it is set to <code>https://sarwebtheory2-production.up.railway.app/api/proxy</code></li>
        <li>Click <strong>Save Proxy Settings</strong>.</li>
      </ul>
      <div style="margin-top:15px; padding: 10px; background: rgba(255,165,0,0.1); border-radius: 4px; font-size: 0.9rem;">
        <strong>Note:</strong> If you are already on the Settings page, you can do this now!
      </div>
    `;
    } else if (step === 4) {
        title = "Step 3: Add Map & Fetch Shapes (4/4)";
        body = `
      <p>Final Step: Connect your map!</p>
      <ol style="margin-left: 20px; margin-top: 10px; line-height: 1.6;">
        <li>Go to the <strong>Maps</strong> page.</li>
        <li>Check the <strong>Proxy Status</strong> indicator (it should be green/Online).</li>
        <li>Enter your <strong>Map ID</strong> and click <strong>Add Map</strong>.</li>
        <li>Click <strong>Fetch Shapes</strong>. All data now flows securely through the web middleman!</li>
      </ol>
      <p style="margin-top:10px;">If the status is "Offline", check your internet connection or the Proxy URL in Settings.</p>
    `;
        btnText = "Finish";
        nextStep = null;
    }

    const popup = createPopup(title, null);
    const content = popup.querySelector('.popup-content');
    const btnContainer = popup.querySelector('.popup-buttons');

    const bodyEl = document.createElement('div');
    bodyEl.style.padding = '10px 0';
    bodyEl.style.lineHeight = '1.5';
    bodyEl.innerHTML = body;
    content.insertBefore(bodyEl, btnContainer);

    btnContainer.innerHTML = '';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'popup-btn';
    nextBtn.style.flex = '1';
    nextBtn.textContent = btnText;
    nextBtn.onclick = () => {
        closePopup(popup);
        if (nextStep) {
            setTimeout(() => startCalTopoSetupWalkthrough(nextStep), 300);
        }
    };
    btnContainer.appendChild(nextBtn);
}

function showCalTopoShapesPopup(features) {
    const popup = createPopup('Import Shapes from CalTopo', null);
  const content = popup.querySelector('.popup-content');
  const btnContainer = popup.querySelector('.popup-buttons');

  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.maxHeight = '90vh';
  content.style.width = '90vw';
  content.style.maxWidth = '1100px';

  const bodyContainer = document.createElement('div');
  bodyContainer.style.flex = '1';
  bodyContainer.style.display = 'flex';
  bodyContainer.style.flexDirection = 'column';
  bodyContainer.style.overflow = 'hidden';
  content.insertBefore(bodyContainer, btnContainer);

    const segmentsToPreview = features.map(buildCalTopoSegmentImportItem);
    let activeFilter = 'all';
    const selectionState = new Map(segmentsToPreview.map((seg, index) => [index, true]));

    const renderTable = () => {
        const visibleSegments = getFilteredSegmentImports(segmentsToPreview, activeFilter);
        const selectedVisibleCount = visibleSegments.filter(seg => selectionState.get(seg.featureIndex) !== false).length;
        const allVisibleChecked = visibleSegments.length > 0 && selectedVisibleCount === visibleSegments.length;

        bodyContainer.innerHTML = `
      <p style="margin-bottom: 15px; opacity: 0.8; flex-shrink: 0;">Select the shapes you want to import as segments, then click <strong>Submit Import</strong> to open the same import preview used on the Segments page.</p>
      <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; align-items: center;">
        <span style="opacity: 0.8; font-size: 0.95rem;">Filter:</span>
        <button type="button" class="mini-pill caltopo-filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">All (${segmentsToPreview.length})</button>
        <button type="button" class="mini-pill caltopo-filter-btn ${activeFilter === 'marker' ? 'active' : ''}" data-filter="marker">Markers (${segmentsToPreview.filter(seg => seg.typeKey === 'marker').length})</button>
        <button type="button" class="mini-pill caltopo-filter-btn ${activeFilter === 'assignment' ? 'active' : ''}" data-filter="assignment">Assignments (${segmentsToPreview.filter(seg => seg.typeKey === 'assignment').length})</button>
        <button type="button" class="mini-pill caltopo-filter-btn ${activeFilter === 'track' ? 'active' : ''}" data-filter="track">Tracks (${segmentsToPreview.filter(seg => seg.typeKey === 'track').length})</button>
        <span style="margin-left: auto; opacity: 0.7; font-size: 0.85rem;">Showing ${visibleSegments.length} of ${segmentsToPreview.length}</span>
      </div>
      <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" id="check-all-shapes" ${allVisibleChecked ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
          <label for="check-all-shapes" style="cursor: pointer; font-weight: bold;">Check / Uncheck Visible</label>
      </div>
    `;

        const tableWrap = document.createElement('div');
        tableWrap.style.overflowX = 'auto';
        tableWrap.style.flex = '1';
        tableWrap.style.overflowY = 'auto';
        tableWrap.style.background = 'rgba(0,0,0,0.1)';
        tableWrap.style.borderRadius = '12px';

        const table = document.createElement('table');
        table.className = 'grid-table';
        table.style.width = '100%';

        const thead = document.createElement('thead');
        thead.innerHTML = `
      <tr>
          <th style="width: 40px; text-align: center; padding: 12px;"></th>
          <th style="padding: 12px;">Name</th>
          <th style="padding: 12px;">Type</th>
          <th style="padding: 12px;">Max Dim (mi)</th>
          <th style="padding: 12px;">Area (acres)</th>
          <th style="padding: 12px;">W x H (mi)</th>
      </tr>
    `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (visibleSegments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 28px; color: var(--muted);">No shapes match the current filter.</td></tr>';
        } else {
            visibleSegments.forEach(seg => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td style="text-align: center;"><input type="checkbox" class="shape-checkbox" data-index="${seg.featureIndex}" ${selectionState.get(seg.featureIndex) !== false ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;"></td>
          <td><div class="pill-cell readonly-pill" style="padding: 8px 12px;">${seg.segment}</div></td>
          <td><div class="pill-cell readonly-pill" style="padding: 8px 12px;">${seg.typeLabel}</div></td>
          <td><div class="pill-cell readonly-pill" style="padding: 8px 12px;">${seg.length || '0.00'} mi</div></td>
          <td><div class="pill-cell readonly-pill" style="padding: 8px 12px;">${seg.area || '0.00'} ac</div></td>
          <td><div class="pill-cell readonly-pill" style="padding: 8px 12px; font-size: 0.8rem;">${seg.width} x ${seg.height}</div></td>
        `;
                tbody.appendChild(tr);
            });
        }

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        bodyContainer.appendChild(tableWrap);

        bodyContainer.querySelectorAll('.caltopo-filter-btn').forEach(btn => {
            btn.onclick = () => {
                activeFilter = btn.dataset.filter || 'all';
                renderTable();
            };
        });

        const checkAll = bodyContainer.querySelector('#check-all-shapes');
        if (checkAll) {
            checkAll.onchange = () => {
                visibleSegments.forEach(seg => selectionState.set(seg.featureIndex, checkAll.checked));
                renderTable();
            };
        }

        bodyContainer.querySelectorAll('.shape-checkbox').forEach(cb => {
            cb.onchange = () => {
                selectionState.set(parseInt(cb.dataset.index, 10), cb.checked);
            };
        });
  };

  btnContainer.innerHTML = '';
  btnContainer.style.display = 'flex';
  btnContainer.style.gap = '12px';
  btnContainer.style.marginTop = '20px';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'popup-btn';
  cancelBtn.style.flex = '1';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => closePopup(popup);
  btnContainer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'popup-btn primary';
  submitBtn.style.flex = '1';
  submitBtn.textContent = 'Submit Import';
  submitBtn.onclick = () => {
      const selected = segmentsToPreview.filter((seg, index) => selectionState.get(index) !== false);
      if (selected.length === 0) {
          alert('No shapes selected.');
          return;
      }

      closePopup(popup);
      showSegmentsImportPreviewPopup(selected, {
          title: 'Import Segments from CalTopo',
          description: 'Review the selected CalTopo shapes before importing them into Segments.',
          onBack: () => showCalTopoShapesPopup(features)
      });
  };
  btnContainer.appendChild(submitBtn);

    segmentsToPreview.forEach((seg, index) => {
        seg.featureIndex = index;
    });

    renderTable();
}

function importCalTopoSegments(selected) {
    importSegmentsAction(selected.map(seg => ({
        region: seg.region || '',
        segment: seg.segment || seg.name || 'Unnamed Graphic',
        area: seg.area || '',
        length: seg.length || '',
        sweep: seg.sweep || 20
    })));
}

async function caltopo_api_call(method, endpoint, payload = null, domain = null) {
  try {
    return await _execute_caltopo_api_call(method, endpoint, payload, domain);
  } catch (error) {
    console.error('CalTopo API Call Error:', error);
    if (error.message.includes('Unexpected token')) {
       alert('CalTopo API Call Error: The server returned an invalid response (not JSON). This usually happens when the proxy URL is incorrect or the server is down.');
    } else {
       alert('CalTopo API Call Error: ' + error.message);
    }
    return null;
  }
}

async function _execute_caltopo_api_call(method, endpoint, payload, domain) {
  const proxyUrl = getCalTopoProxy();
  if (!proxyUrl) {
    alert('No CalTopo Proxy configured. Please go to Settings and set the Proxy URL.');
    return null;
  }

  const requestBody = { method, endpoint, payload, domain };

  // Ensure we call /api/call - normalizeCalTopoProxyUrl always ends in /api/proxy or is a .php file
  let proxyCallUrl = normalizeCalTopoProxyUrl(proxyUrl);
  if (proxyCallUrl.includes('.php')) {
      proxyCallUrl = proxyCallUrl.split('?')[0] + (proxyCallUrl.includes('?') ? '&' : '?') + 'api_call=1';
  } else {
      proxyCallUrl = proxyCallUrl.replace(/\/api\/proxy\/?$/i, '/api/call').replace(/\/fetch-map\/?$/i, '/api/call');
  }
  
  const response = await fetch(proxyCallUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) {
      if (data.proxyDiagnostics) {
        console.group('CalTopo Proxy Diagnostics');
        console.error('Method:', data.proxyDiagnostics.method);
        console.error('Endpoint:', data.proxyDiagnostics.endpoint);
        console.error('Expires:', data.proxyDiagnostics.expires);
        console.error('Payload Size:', data.proxyDiagnostics.payloadSize);
        console.error('Message signed by proxy:', data.proxyDiagnostics.messageToSign);
        console.groupEnd();
      }
      
      let errorMsg = data.message || data.error || `Server Error ${response.status}`;
      if (data.targetUrl) {
        errorMsg += `\n(Attempted: ${data.targetUrl})`;
      }
      
      // Specific help for 403 / "write rights" errors
      if (response.status === 403 || errorMsg.toLowerCase().includes('write rights')) {
         errorMsg = "CalTopo Permission Error: " + errorMsg + "\n\n" +
                    "This usually means your CalTopo Service Account (Credential ID) has 'READ' access but needs 'UPDATE' or 'MANAGE' access to create maps. " +
                    "Also, ensure your Team ID is correct for the domain you selected (CalTopo vs SARTopo).";
      }
      
      throw new Error(errorMsg);
    }
    return data;
  } else {
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 404) {
        const lowerText = text.toLowerCase();
        if (lowerText.includes("lost") || text.includes("404image.png") || lowerText.includes("not found")) {
           throw new Error(`The CalTopo endpoint '${endpoint}' was not found. This might be because the Team ID is incorrect or the domain '${domain || 'caltopo.com'}' is wrong for this account.`);
        }
        throw new Error(`Endpoint not found (404) at '${proxyCallUrl}'. Your proxy server might be out of date. Please ensure you have the latest sync-server.js running.`);
      }
      
      // Extract title from HTML if possible
      let displayError = text.substring(0, 150);
      const titleMatch = text.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
         displayError = titleMatch[1];
      } else {
         const h2Match = text.match(/<h2>(.*?)<\/h2>/i);
         if (h2Match && h2Match[1]) displayError = h2Match[1];
      }
      
      throw new Error(`Server Error ${response.status}: ${displayError}`);
    }
    // If it's 200 OK but not JSON, still a problem for this API
    throw new Error(`Expected JSON response but got ${contentType || 'text'}.`);
  }
}

async function handleCreateMap() {
  const teamIdInput = document.getElementById('create-team-id');
  const titleInput = document.getElementById('create-map-title');
  const domainInput = document.getElementById('create-map-domain');
  const statusDiv = document.getElementById('create-map-status');
  const submitBtn = document.getElementById('submit-create-map');

  if (!teamIdInput || !titleInput || !statusDiv || !submitBtn || !domainInput) return;

  const teamId = teamIdInput.value.trim();
  const title = titleInput.value.trim();
  const domain = domainInput.value;

  if (!teamId) {
    alert('Please enter a Team ID.');
    return;
  }
  if (!title) {
    alert('Please enter a Map Title.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';
  statusDiv.style.display = 'block';
  statusDiv.style.color = 'var(--accent)';
  statusDiv.textContent = 'Sending request to CalTopo...';

  const payload = {
    properties: {
      title: title
    }
  };

  const endpoint = `/api/v1/acct/${teamId}/CollaborativeMap`;
  const result = await caltopo_api_call('POST', endpoint, payload, domain);

  if (result && result.id) {
    statusDiv.style.color = '#40c057';
    statusDiv.innerHTML = `Success! Map created with ID: <strong>${result.id}</strong><br>Adding to your maps list...`;
    
    // Add to local bundle
    const bundle = loadBundle();
    if (!bundle.maps) bundle.maps = [];
    // Check if it already exists (unlikely for a new map but good practice)
    if (!bundle.maps.find(m => m.id === result.id)) {
        bundle.maps.unshift({
          id: result.id,
          name: title,
          domain: domain,
          teamId: teamId
        });
        saveBundle(bundle);
    }
    
    // Switch to Map tab after a delay
    setTimeout(() => {
      const newUrl = window.location.pathname + '?tab=map';
      window.history.replaceState(null, '', newUrl);
      buildMapsPage();
    }, 2000);
  } else {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Map';
    statusDiv.style.color = '#ff6b6b';
    statusDiv.textContent = 'Failed to create map. Check console for details.';
  }
}

async function verifyCalTopoAccount() {
  const teamIdInput = document.getElementById('create-team-id');
  const domainInput = document.getElementById('create-map-domain');
  const resultSmall = document.getElementById('team-verify-result');
  const verifyBtn = document.getElementById('verify-team-btn');

  if (!teamIdInput || !domainInput || !resultSmall || !verifyBtn) return;

  const teamId = teamIdInput.value.trim();
  const domain = domainInput.value;

  if (!teamId) {
    alert('Please enter a Team ID first.');
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = '...';
  resultSmall.textContent = 'Verifying...';
  resultSmall.style.color = 'var(--muted)';

  const endpoint = `/api/v1/acct/${teamId}/CollaborativeMap`;
  const result = await caltopo_api_call('GET', endpoint, null, domain);
  
  verifyBtn.disabled = false;
  verifyBtn.textContent = 'Verify';
  
  if (result && (Array.isArray(result) || result.features || result.id || (typeof result === 'object' && Object.keys(result).length > 0))) {
      resultSmall.textContent = `✓ Connected! Account access verified.`;
      resultSmall.style.color = '#40c057';
  } else {
      resultSmall.textContent = '✗ Failed to connect. Check Team ID and Domain.';
      resultSmall.style.color = '#ff6b6b';
  }
}

async function caltopo_request(btn = null, options = {}) {
    const {silent = false} = options;
  const bundle = loadBundle();
  const map = bundle.maps ? bundle.maps[0] : null;
  if (!map || !map.id) return;

  const activeMapId = map.id;
  const activeMapDomain = map.domain || 'caltopo.com';

  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Fetching...';
  }

  try {
    const proxyUrl = getCalTopoProxy();
    if (!proxyUrl) {
      alert('No CalTopo Proxy configured. Please go to Settings and set the Proxy URL.');
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const requestBody = { mapId: activeMapId, domain: activeMapDomain };

    const finalProxyUrl = normalizeCalTopoProxyUrl(proxyUrl);
    const buster = finalProxyUrl.includes('?') ? `&_=${Date.now()}` : `?_=${Date.now()}`;
    const proxyResp = await fetch(finalProxyUrl + buster, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (proxyResp.ok) {
      const data = await proxyResp.json();
      console.log('CalTopo Proxy Data:', data);
      
      const features = (data.features || []).filter(f => {
        const props = f.properties || f;
        const hasGeom = !!(f.geometry || f.vertices || f.position || props.geometry || props.vertices || props.position || f.pts || f.coords || f.coordinates || props.pts || props.coords || props.coordinates);
        const rawType = (f.geometry?.type || f.type || props.class || props.type || '').toString().toLowerCase();
        
        console.log(`Checking feature: ${rawType}, hasGeom: ${hasGeom}`, f);
        
        // Very lenient check - if it has geometry/vertices, we probably want it
        // We only exclude things that are clearly not shapes (like Folders, though Folders don't have geometry)
        const allowedTypes = [
          'polygon', 'multipolygon', 'linestring', 'multilinestring', 'point', 'multipoint',
          'shape', 'assignment', 'track', 'route', 'marker', 'clue', 'area', 'line', 'sector', 'buffer', 'graphic', 'feature'
        ];
        
        const isAllowed = allowedTypes.some(t => rawType.includes(t)) || rawType === 'feature' || rawType === 'graphic' || rawType === '';
        return hasGeom && isAllowed;
      }).map((f, idx) => {
        const props = f.properties || f;
        const geom = f.geometry || f;
        const objectId = idx + 1;
        
        let name = props.label || props.title || props.name || props.text;
        
        // Robust naming for Assignments or unnamed features
        if (props.class === 'Assignment' || props.type === 'Assignment' || props.assignment) {
            const a = (typeof props.assignment === 'object') ? props.assignment : props;
            const num = a.number || '';
            const label = a.label || props.title || props.label || '';
            if (num && label) name = `${num} ${label}`;
            else if (num) name = num;
            else if (label) name = label;
        }
        
        if (!name) name = f.id ? `Feature ${f.id}` : `Unnamed Graphic ${objectId}`;

        const feature = {
          geometry: geom,
          attributes: {
            ...props,
            ObjectID: objectId,
            name: name,
            id: f.id || props.id || props.uuid || `gfx-${objectId}`
          }
        };

        // Cleanup: remove redundant nested objects
        delete feature.attributes.geometry;
        delete feature.attributes.properties;
        
        return feature;
      });

      if (features.length === 0) {
        console.warn('CalTopo Proxy Data received but no features filtered:', data);
        const rawCount = (data.state && data.state.features) ? data.state.features.length : 0;
        alert(`No compatible shapes found on this map. (Total objects from proxy: ${rawCount}). Check your service account permissions or object types (polygon, line, marker, assignment).`);
      } else {
        const b = loadBundle();
        if (b.maps && b.maps[0]) {
          b.maps[0].features = features;
          saveBundle(b);
        }
        
        if (isMapsPage()) {
          const urlParams = new URLSearchParams(window.location.search);
          const activeTab = urlParams.get('tab') || 'map';
          if (activeTab === 'features') {
            renderFeaturesList();
          } else if (activeTab === 'arcgis') {
            renderArcGISMap();
          } else if (!silent) {
            showCalTopoShapesPopup(features);
          }
        }
      }
    } else {
      const errData = await proxyResp.json().catch(() => ({}));
      const errMsg = errData.message || errData.error || proxyResp.statusText;
      alert(`Proxy Error: ${errMsg}`);
    }
  } catch (err) {
    console.error(err);
    alert(`Could not fetch shapes: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'Fetch Shapes';
    }
  }
}

let arcgisView = null;

function renderArcGISMap() {
  const mapDiv = document.getElementById('arcgis-map-div');
  if (!mapDiv) return;
  
  const refreshBtn = document.getElementById('refresh-arcgis-btn');
    const psrcToggle = document.getElementById('maps-psrc-overlay-toggle');
  if (refreshBtn && !refreshBtn.onclick) {
    refreshBtn.onclick = () => caltopo_request(refreshBtn);
  }
    if (psrcToggle && !psrcToggle.dataset.bound) {
        psrcToggle.checked = isMapPsrcOverlayEnabled();
        psrcToggle.onchange = () => {
            setMapPsrcOverlayEnabled(psrcToggle.checked);
            renderArcGISMap();
        };
        psrcToggle.dataset.bound = 'true';
    }

  const bundle = loadBundle();
  const currentMap = bundle.maps ? bundle.maps[0] : null;
  const features = currentMap ? (currentMap.features || []) : [];
    const segmentRows = ensureSegmentsPageRows(bundle);
    const segmentDisplaySettings = getSegmentDisplaySettings(bundle);
    const psrcLookup = buildSegmentPsrcLookup(segmentRows, segmentDisplaySettings);
    const activeSearchNames = buildActiveSearchSegmentNameSet(bundle, segmentRows);
    const usePsrcOverlay = isMapPsrcOverlayEnabled();

  if (typeof require === 'undefined') {
    mapDiv.innerHTML = '<p style="padding: 20px;">ArcGIS API not loaded yet. Please check your internet connection.</p>';
    return;
  }

  require([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/layers/GraphicsLayer"
  ], function(Map, MapView, Graphic, GraphicsLayer) {
    
    if (!arcgisView) {
      const map = new Map({
        basemap: "topo-vector"
      });

      arcgisView = new MapView({
        container: mapDiv,
        map: map,
        zoom: 4,
        center: [-98, 39]
      });
    } else {
      // Re-attach to the new DOM element created by buildMapsPage()
      arcgisView.container = mapDiv;
    }

    const map = arcgisView.map;
    let graphicsLayer = map.layers.find(l => l.id === "caltopo-features");
    if (!graphicsLayer) {
      graphicsLayer = new GraphicsLayer({ id: "caltopo-features" });
      map.add(graphicsLayer);
    } else {
      graphicsLayer.removeAll();
    }

    if (features.length === 0) return;

    const arcgisGraphics = features.map(f => {
      const geom = f.geometry || {};
      const attrs = f.attributes || {};
      
      let arcgisGeom = null;
      const vertices = geom.vertices || attrs.vertices || geom.pts || attrs.pts || geom.coords || attrs.coords || geom.coordinates || attrs.coordinates;
      const position = geom.position || attrs.position || (geom.type === 'Point' ? geom.coordinates : null);

      if (geom.type === 'Point' || position) {
        const pos = position || geom.coordinates;
        if (pos && Array.isArray(pos)) {
          arcgisGeom = {
            type: "point",
            longitude: pos[0],
            latitude: pos[1]
          };
        }
      } else if (vertices && Array.isArray(vertices)) {
        const isClosed = geom.closed === true || attrs.closed === true || (attrs.class === 'Assignment' && attrs.closed !== false) || geom.type === 'Polygon';
        if (isClosed) {
          // ArcGIS rings expect array of rings, each ring is array of points
          // If vertices is [ [lon,lat], [lon,lat] ], then [vertices] is one ring
          const rings = (Array.isArray(vertices[0]) && Array.isArray(vertices[0][0])) ? vertices : [vertices];
          arcgisGeom = {
            type: "polygon",
            rings: rings
          };
        } else {
          const paths = (Array.isArray(vertices[0]) && Array.isArray(vertices[0][0])) ? vertices : [vertices];
          arcgisGeom = {
            type: "polyline",
            paths: paths
          };
        }
      }

      if (!arcgisGeom) return null;

        const overlayColor = usePsrcOverlay ? getFeaturePsrcColor(f, psrcLookup, segmentDisplaySettings) : null;
        const isActiveSearch = isFeatureActivelyBeingSearched(f, activeSearchNames);
        const strokeOpacity = resolveDisplayedSegmentOpacity(isActiveSearch, segmentDisplaySettings, overlayColor ? 1 : 0.2);
        const fillOpacity = resolveDisplayedSegmentOpacity(isActiveSearch, segmentDisplaySettings, overlayColor ? 0.42 : 0.4);
        const overlayRgb = overlayColor ? [...overlayColor.rgb, strokeOpacity] : [64, 192, 87, strokeOpacity];
        const overlayFillRgb = overlayColor ? [...overlayColor.rgb, fillOpacity] : [64, 192, 87, fillOpacity];

      let symbol = {
        type: "simple-fill",
          color: overlayFillRgb,
          outline: {color: overlayRgb, width: overlayColor ? 3 : 2}
      };

      if (arcgisGeom.type === 'polyline') {
        symbol = {
          type: "simple-line",
            color: overlayRgb,
            width: overlayColor ? 4 : 3
        };
      } else if (arcgisGeom.type === 'point') {
        symbol = {
          type: "simple-marker",
            color: overlayRgb,
            size: overlayColor ? 10 : 8,
            outline: {color: [255, 255, 255, strokeOpacity], width: 1}
        };
      }

      return new Graphic({
        geometry: arcgisGeom,
        attributes: attrs,
        symbol: symbol,
        popupTemplate: {
          title: "{name}",
          content: [{
            type: "fields",
            fieldInfos: [
              { fieldName: "ObjectID", label: "ID" },
              { fieldName: "id", label: "CalTopo ID" },
              { fieldName: "class", label: "Class" }
            ]
          }]
        }
      });
    }).filter(g => g !== null);

    graphicsLayer.addMany(arcgisGraphics);

    if (arcgisGraphics.length > 0) {
      arcgisView.when(() => {
        arcgisView.goTo(arcgisGraphics).catch(() => {});
      });
    }
  });
}

function renderFeaturesList() {
  const tbody = document.getElementById('features-list-body');
  if (!tbody) return;
  
  const bundle = loadBundle();
  const currentMap = bundle.maps ? bundle.maps[0] : null;
  const features = currentMap ? currentMap.features : [];
    const segmentNames = buildSegmentNameSet(ensureSegmentsPageRows(bundle));

  if (!features || features.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: var(--muted);">No features loaded. Use "Fetch Shapes" to load features from the active map.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  features.forEach(f => {
    const tr = document.createElement('tr');
    const attrs = f.attributes || {};
    const name = attrs.name || 'Unnamed Graphic';
    const type = (f.geometry?.type || attrs.class || attrs.type || (attrs.vertices ? 'Shape' : 'Graphic'));
    const objectId = attrs.ObjectID || 'N/A';
      const existingSegment = segmentNames.has(normalizeSegmentNameForMatch(name));
      const importLabel = existingSegment ? 'Reimport' : 'Import';

    tr.innerHTML = `
      <td><div class="pill-cell readonly-pill" style="padding: 8px 12px; font-family: monospace; font-size: 0.8rem;">${objectId}</div></td>
      <td><div class="pill-cell readonly-pill" style="padding: 8px 12px;">${name}</div></td>
      <td><div class="pill-cell readonly-pill" style="padding: 8px 12px;">${type}</div></td>
      <td style="padding: 8px 12px;">
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button class="mini-pill import-feat" style="background: rgba(64, 192, 87, 0.1); border-color: rgba(64, 192, 87, 0.3); padding: 5px 10px; font-size: 0.8rem; cursor: pointer;">${importLabel}</button>
        </div>
      </td>
    `;

    tr.querySelector('.import-feat').onclick = () => {
        showSegmentsImportPreviewPopup([buildCalTopoSegmentImportItem(f)], {
            title: 'Import Segments from CalTopo',
            description: `Review the selected CalTopo shape before ${existingSegment ? 'reimporting' : 'importing'} "${name}" into Segments.`
        });
    };

    tbody.appendChild(tr);
  });
}

function buildUserAccountPage() {
    const container = document.getElementById('user-account-container');
    const tabContainer = document.getElementById('user-tabs');
    if (!container) return;

    const bundle = loadBundle();
    const urlParams = new URLSearchParams(window.location.search);
    const userPin = urlParams.get('userPin');
    const tab = urlParams.get('tab') || 'account';
    const currentUser = getCurrentUser();

    if (tabContainer) {
        if (isUserAdmin(currentUser)) {
            tabContainer.style.display = 'flex';
            const tabAccount = document.getElementById('tab-account');
            const tabManage = document.getElementById('tab-manage');
            
            tabAccount.classList.toggle('active', tab === 'account');
            tabManage.classList.toggle('active', tab === 'manage');

            tabAccount.onclick = () => {
                const newUrl = window.location.pathname + '?tab=account';
                window.history.replaceState(null, '', newUrl);
                buildUserAccountPage();
            };
            tabManage.onclick = () => {
                const newUrl = window.location.pathname + '?tab=manage';
                window.history.replaceState(null, '', newUrl);
                buildUserAccountPage();
            };
        } else {
            tabContainer.style.display = 'none';
        }
    }

    if (tab === 'manage' && isUserAdmin(currentUser)) {
        renderUserManagement(container, bundle);
        return;
    }
    
    let userToEdit;
    if (userPin && isUserAdmin(currentUser)) {
        userToEdit = (bundle.accounts || []).find(a => a.pin === userPin);
    } else {
        userToEdit = (bundle.accounts || []).find(a => a.pin === (currentUser ? currentUser.pin : ''));
    }

    if (!userToEdit) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: white;">
                <p style="font-size: 1.2rem; margin-bottom: 20px;">User not found.</p>
                <button id="switch-user-btn" class="mini-pill" style="padding: 12px 20px; font-size: 1rem; background: rgba(235, 87, 87, 0.1); border-color: rgba(235, 87, 87, 0.4);">Switch User</button>
            </div>
        `;
        const switchBtn = document.getElementById('switch-user-btn');
        if (switchBtn) {
            switchBtn.onclick = () => {
                sessionStorage.removeItem('sar-current-user');
                window.location.href = 'home.html';
            };
        }
        return;
    }

    container.innerHTML = `
        <div class="profile-form" style="max-width: 800px; margin: 0 auto; background: rgba(0,0,0,0.2); padding: 30px; border-radius: 32px; border: 1px solid rgba(255,255,255,0.1);">
            <div class="form-group small">
                <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: bold;">First Name</label>
                <input type="text" id="user-first-name" class="pill-input" value="${userToEdit.firstName || ''}" style="width: 100%; box-sizing: border-box;">
            </div>
            <div class="form-group small">
                <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: bold;">Last Name</label>
                <input type="text" id="user-last-name" class="pill-input" value="${userToEdit.lastName || ''}" style="width: 100%; box-sizing: border-box;">
            </div>
            <div class="form-group small">
                <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: bold;">User PIN</label>
                <input type="password" id="user-pin" class="pill-input" value="${userToEdit.pin || ''}" style="width: 100%; box-sizing: border-box;">
            </div>
            <div class="form-group small">
                <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: bold;">Handle</label>
                <input type="text" id="user-handle" class="pill-input" value="${userToEdit.handle || ''}" style="width: 100%; box-sizing: border-box;">
            </div>
            <div class="form-group large">
                <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: bold;">Theme Preference</label>
                <div style="display: flex; gap: 10px;">
                    <button id="theme-dark-btn" class="mini-pill ${userToEdit.theme !== 'light' ? 'active' : ''}" style="flex: 1;">Dark Mode</button>
                    <button id="theme-light-btn" class="mini-pill ${userToEdit.theme === 'light' ? 'active' : ''}" style="flex: 1;">Grey Mode</button>
                </div>
            </div>
            <div class="form-group large">
                <label style="display: block; margin-bottom: 12px; color: var(--text); font-weight: bold;">Highlight Color</label>
                <div id="color-selection" style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
                    <!-- Color buttons will be here -->
                </div>
            </div>
            <div class="tool-actions" style="margin-top: 20px; justify-content: center; grid-column: span 6;">
                <button id="save-user-btn" class="update-pill" style="padding: 12px 40px; font-size: 1rem;">Update Account</button>
                <button id="switch-user-btn" class="mini-pill" style="padding: 12px 20px; font-size: 1rem; margin-left: 10px; background: rgba(235, 87, 87, 0.1); border-color: rgba(235, 87, 87, 0.4);">Switch User</button>
            </div>
        </div>
    `;


    const colors = ['none', 'orange', 'yellow', 'red', 'blue', 'green', 'purple', 'brown', 'black', 'white', 'grey', 'maroon'];
    const colorContainer = document.getElementById('color-selection');
    colors.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'pill-cell-btn';
        btn.style.width = '36px';
        btn.style.height = '36px';
        btn.style.borderRadius = '50%';
        btn.style.padding = '0';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'transform 0.2s ease';
        
        const updateUI = () => {
            // Unselect all
            Array.from(colorContainer.children).forEach(b => {
                b.style.border = '1px solid rgba(255,255,255,0.3)';
                b.style.transform = 'scale(1)';
            });
            // Select this one
            btn.style.border = '3px solid white';
            btn.style.transform = 'scale(1.2)';
        };

        if (userToEdit.color === c) {
            btn.style.border = '3px solid white';
            btn.style.transform = 'scale(1.2)';
        } else {
            btn.style.border = '1px solid rgba(255,255,255,0.3)';
        }
        
        if (c === 'none') {
            btn.style.background = 'transparent';
            btn.innerHTML = '<span style="color: white; font-size: 20px;">×</span>';
        } else {
            btn.style.background = HIGHLIGHT_COLORS[c];
        }

        btn.onclick = () => {
            userToEdit.color = c;
            updateUI();
        };
        colorContainer.appendChild(btn);
    });

    const darkBtn = document.getElementById('theme-dark-btn');
    const lightBtn = document.getElementById('theme-light-btn');
    if (darkBtn && lightBtn) {
        darkBtn.onclick = () => {
            userToEdit.theme = 'dark';
            darkBtn.classList.add('active');
            lightBtn.classList.remove('active');
            applyTheme(bundle);
        };
        lightBtn.onclick = () => {
            userToEdit.theme = 'light';
            lightBtn.classList.add('active');
            darkBtn.classList.remove('active');
            applyTheme(bundle);
        };
    }

    const switchBtn = document.getElementById('switch-user-btn');
    if (switchBtn) {
        switchBtn.onclick = () => {
            sessionStorage.removeItem('sar-current-user');
            window.location.href = 'home.html';
        };
    }

    document.getElementById('save-user-btn').onclick = () => {
        const newFirstName = document.getElementById('user-first-name').value;
        const newLastName = document.getElementById('user-last-name').value;
        const newPin = document.getElementById('user-pin').value;
        const newHandle = document.getElementById('user-handle').value;
        
        if (!newFirstName || !newPin) {
            alert('First Name and PIN are required.');
            return;
        }

        const oldPin = userToEdit.pin;
        const oldHandle = userToEdit.handle;
        const oldFullName = (userToEdit.firstName + ' ' + (userToEdit.lastName || '')).trim();

        const idx = (bundle.accounts || []).findIndex(a => a.pin === oldPin);

        userToEdit.firstName = newFirstName;
        userToEdit.lastName = newLastName;
        userToEdit.pin = newPin;
        userToEdit.handle = newHandle;
        
        // Sync name change to Personnel list (page3)
        if (bundle.pages && bundle.pages.page3) {
            const newName = newHandle || (newFirstName + ' ' + (newLastName || '')).trim();
            bundle.pages.page3.forEach(row => {
                const rowName = (row[0] || '').trim();
                const rowPin = (row[8] || '').trim();
                if ((rowPin && rowPin === oldPin) || rowName === oldHandle || rowName === oldFullName) {
                    row[0] = newName;
                    row[8] = newPin;
                }
            });
        }
        
        if (idx >= 0) {
            bundle.accounts[idx] = userToEdit;
        } else {
            bundle.accounts.push(userToEdit);
        }
        
        saveBundle(bundle);
        
        // If we edited our own account, update the session
        if (oldPin === currentUser.pin) {
            setCurrentUser(userToEdit);
        }

        // If PIN changed and we are Admin editing another user, update the URL to prevent duplicate saves
        if (userPin && userPin !== newPin) {
            const newUrl = window.location.pathname + '?userPin=' + newPin;
            window.history.replaceState(null, '', newUrl);
        }
        
        const status = document.getElementById('save-status');
        if (status) {
            status.textContent = 'Account updated successfully!';
            status.style.color = '#4caf50';
            setTimeout(() => status.textContent = 'Ready.', 3000);
        }
        updateHeaderProfile();
    };
}

function renderUserManagement(container, bundle) {
    container.innerHTML = `
        <div class="table-card" style="max-width: 1200px; margin: 0 auto; background: rgba(0,0,0,0.2); border-radius: 15px; border: 1px solid rgba(255,255,255,0.1); overflow-x: auto;">
            <div style="padding: 20px; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--muted); font-size: 0.9rem; text-align: center;">
                User accounts are automatically synchronized with the Personnel list. To add or remove users, please use the Personnel page.
            </div>
            <table class="grid-table" style="width: 100%; border-collapse: collapse; min-width: 600px;">
                <thead>
                    <tr style="background: rgba(255,255,255,0.05);">
                        <th style="padding: 15px; text-align: left; color: var(--accent); width: 45%;">User Name</th>
                        <th style="padding: 15px; text-align: center; color: var(--accent); width: 15%;">File Manager</th>
                        <th style="padding: 15px; text-align: center; color: var(--accent); width: 15%;">PIN</th>
                        <th style="padding: 15px; text-align: center; color: var(--accent); width: 25%;">Actions</th>
                    </tr>
                </thead>
                <tbody id="user-management-body"></tbody>
            </table>
        </div>
        <div style="text-align: center; margin-top: 30px;">
            <button id="switch-user-btn-mgmt" class="mini-pill" style="padding: 12px 20px; font-size: 1rem; background: rgba(235, 87, 87, 0.1); border-color: rgba(235, 87, 87, 0.4);">Switch User</button>
        </div>
    `;

    const switchBtnMgmt = document.getElementById('switch-user-btn-mgmt');
    if (switchBtnMgmt) {
        switchBtnMgmt.onclick = () => {
            sessionStorage.removeItem('sar-current-user');
            window.location.href = 'home.html';
        };
    }

    const tbody = document.getElementById('user-management-body');
    (bundle.accounts || []).forEach(acc => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        
        const tdName = document.createElement('td');
        tdName.style.padding = '12px 15px';
        const nameBtn = document.createElement('button');
        nameBtn.className = 'mini-pill';
        nameBtn.style.fontWeight = 'bold';
        nameBtn.style.whiteSpace = 'normal';
        nameBtn.style.textAlign = 'left';
        nameBtn.style.wordBreak = 'break-word';
        nameBtn.textContent = `${getAccountName(acc)} (@${acc.handle || 'no-handle'})`;
        if (acc.color && acc.color !== 'none') {
            nameBtn.classList.add(`profile-highlight-${acc.color}`);
        }
        nameBtn.onclick = () => {
            const newUrl = window.location.pathname + '?tab=account&userPin=' + acc.pin;
            window.history.replaceState(null, '', newUrl);
            buildUserAccountPage();
        };
        tdName.appendChild(nameBtn);
        tr.appendChild(tdName);
        
        const tdFileManager = document.createElement('td');
        tdFileManager.style.padding = '12px 15px';
        tdFileManager.style.textAlign = 'center';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'pill-checkbox';
        chk.checked = !!acc.isFileManager;
        chk.onchange = () => {
            acc.isFileManager = chk.checked;
            saveBundle(bundle);
        };
        tdFileManager.appendChild(chk);
        tr.appendChild(tdFileManager);

        const tdPin = document.createElement('td');
        tdPin.style.padding = '12px 15px';
        tdPin.style.textAlign = 'center';
        const pinInput = document.createElement('input');
        pinInput.type = 'password';
        pinInput.className = 'pill-input';
        pinInput.style.width = '80px';
        pinInput.style.textAlign = 'center';
        pinInput.value = acc.pin;
        pinInput.onchange = () => {
            const oldPin = acc.pin;
            acc.pin = pinInput.value;
            // Sync to personnel
            if (bundle.pages && bundle.pages.page3) {
                bundle.pages.page3.forEach(row => {
                    if (row[8] === oldPin) row[8] = acc.pin;
                });
            }
            saveBundle(bundle);
        };
        tdPin.appendChild(pinInput);
        tr.appendChild(tdPin);
        
        const tdActions = document.createElement('td');
        tdActions.style.padding = '12px 15px';
        tdActions.style.textAlign = 'center';
        
        const span = document.createElement('span');
        span.textContent = 'Managed via Personnel';
        span.style.color = 'var(--muted)';
        span.style.fontSize = '0.8rem';
        span.style.display = 'block';
        span.style.lineHeight = '1.2';
        tdActions.appendChild(span);

        tr.appendChild(tdActions);
        
        tbody.appendChild(tr);
    });
}

function buildUserManagementPage() {
    navigateToPage('page8.html?tab=manage');
}
function buildMapsPage() {
  const container = document.querySelector('main');
  if (!container) return;

  let bundle = loadBundle();
  if (!bundle.maps) bundle.maps = [];

  const urlParams = new URLSearchParams(window.location.search);
    const requestedTab = urlParams.get('tab') || 'map';
    const activeTab = ['map', 'arcgis', 'features'].includes(requestedTab) ? requestedTab : 'map';

  container.innerHTML = `
    <section class="hero">
      <h1>Maps Management</h1>
      <p>Manage your CalTopo maps here. Add a Map ID to embed and fetch shapes. Polygons are imported as segments, lines are not imported.</p>
      
      <div class="tabs" style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="tab-map" class="mini-pill ${activeTab === 'map' ? 'active' : ''}" style="padding: 10px 24px; font-size: 1rem; cursor: pointer;">CalTopo View</button>
        <button id="tab-arcgis" class="mini-pill ${activeTab === 'arcgis' ? 'active' : ''}" style="padding: 10px 24px; font-size: 1rem; cursor: pointer;">ArcGIS View</button>
        <button id="tab-features" class="mini-pill ${activeTab === 'features' ? 'active' : ''}" style="padding: 10px 24px; font-size: 1rem; cursor: pointer;">Features</button>
      </div>

      <div style="background: rgba(64, 192, 87, 0.1); border-left: 4px solid #40c057; padding: 20px; margin-top: 15px; border-radius: 16px; display: flex; align-items: center;">
        <div id="proxy-status-container" style="font-size: 1rem; display: flex; align-items: center; gap: 30px; flex-wrap: wrap; width: 100%;">
          <div style="display: flex; align-items: center; gap: 10px; padding-left: 20px;">
            <span style="color: var(--muted);">Proxy Status:</span>
            <span id="proxy-status-dot" style="width: 12px; height: 12px; border-radius: 50%; background: #ccc;"></span>
            <span id="proxy-status-text" style="font-weight: 500;">Checking...</span>
          </div>
        </div>
      </div>
    </section>

    <div id="map-view-container" style="display: ${activeTab === 'map' ? 'block' : 'none'};">
      <section id="map-view-section" class="table-card" style="display: none; padding: 0; overflow: hidden; height: 75vh; position: relative; margin-top: 20px; border-radius: 16px;">
        <div class="table-tools" style="padding: 15px; background: var(--header-bg); border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center;">
          <h2 id="current-map-title" style="margin: 0; font-size: 1.2rem;">Map View</h2>
          <div class="tool-actions" style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
            <label style="display: inline-flex; align-items: center; gap: 10px; color: var(--muted); font-size: 0.92rem; cursor: pointer;">
              <span>PSRc Assignment Colors</span>
              <span class="toggle-switch" style="transform: scale(0.9);">
                <input type="checkbox" id="caltopo-assignment-overlay-toggle" ${isCalTopoAssignmentOverlayEnabled() ? 'checked' : ''}>
                <span class="slider"></span>
              </span>
            </label>
            <button id="fetch-shapes-btn" class="clear-btn">Fetch Shapes</button>
          </div>
        </div>
        <iframe id="map-iframe" style="width: 100%; height: calc(100% - 62px); border: none;" allow="geolocation" referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </section>

      <section class="table-card" style="margin-top: 20px;">
        <div class="table-tools">
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; width: 100%;">
            <input id="map-id-input" class="pill-input" type="text" placeholder="Map ID (e.g. 0A1B2)" style="flex: 1.5; min-width: 150px;">
            <input id="team-id-input" class="pill-input" type="text" placeholder="Team ID (6 chars, optional)" style="flex: 1; min-width: 150px;">
            <input id="map-name-input" class="pill-input" type="text" placeholder="Map Name (Optional)" style="flex: 1.5; min-width: 150px;">
            <button id="add-map-btn" class="clear-btn">Add Map</button>
          </div>
        </div>

        <div id="maps-list" style="margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px;">
          <!-- Map cards will be injected here -->
        </div>
      </section>
    </div>

    <div id="arcgis-view-container" style="display: ${activeTab === 'arcgis' ? 'block' : 'none'}; margin-top: 20px;">
      <section class="table-card" style="padding: 0; overflow: hidden; height: 75vh; position: relative; border-radius: 16px;">
        <div class="table-tools" style="padding: 15px; background: var(--header-bg); border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 1.2rem;">ArcGIS Map View</h2>
          <div class="tool-actions" style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
            <label style="display: inline-flex; align-items: center; gap: 10px; color: var(--muted); font-size: 0.92rem; cursor: pointer;">
              <span>PSRc Overlay</span>
              <span class="toggle-switch" style="transform: scale(0.9);">
                <input type="checkbox" id="maps-psrc-overlay-toggle" ${isMapPsrcOverlayEnabled() ? 'checked' : ''}>
                <span class="slider"></span>
              </span>
            </label>
            <button id="refresh-arcgis-btn" class="clear-btn">Refresh Layer</button>
          </div>
        </div>
        <div id="arcgis-map-div" style="width: 100%; height: calc(100% - 62px);"></div>
      </section>
    </div>

    <div id="features-view-container" style="display: ${activeTab === 'features' ? 'block' : 'none'}; margin-top: 20px;">
      <section class="table-card">
        <div class="table-tools">
          <h2 style="margin: 0; font-size: 1.2rem;">Map Features</h2>
          <div class="tool-actions">
            <button id="refresh-features-btn" class="clear-btn">Fetch Shapes</button>
          </div>
        </div>
        <div style="overflow-x: auto; padding-top: 10px;">
          <table class="grid-table" style="width: 100%;">
            <thead>
              <tr>
                <th style="padding: 12px; width: 120px;">ID</th>
                <th style="padding: 12px;">Name</th>
                <th style="padding: 12px;">Type</th>
                <th style="padding: 12px; width: 280px;">Actions</th>
              </tr>
            </thead>
            <tbody id="features-list-body">
              <tr><td colspan="4" style="text-align: center; padding: 40px; color: var(--muted);">No features loaded. Use "Fetch Shapes" to load features from the active map.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
  const addMapBtn = document.getElementById('add-map-btn');
  const mapsList = document.getElementById('maps-list');
  const mapViewSection = document.getElementById('map-view-section');
  const mapIframe = document.getElementById('map-iframe');
  const currentMapTitle = document.getElementById('current-map-title');
  const fetchShapesBtn = document.getElementById('fetch-shapes-btn');
    const caltopoAssignmentOverlayToggle = document.getElementById('caltopo-assignment-overlay-toggle');
  const refreshFeaturesBtn = document.getElementById('refresh-features-btn');
  const tabMap = document.getElementById('tab-map');
  const tabArcGIS = document.getElementById('tab-arcgis');
  const tabFeatures = document.getElementById('tab-features');

  tabMap.onclick = () => {
    const newUrl = window.location.pathname + '?tab=map';
    window.history.replaceState(null, '', newUrl);
    buildMapsPage();
  };

  tabArcGIS.onclick = () => {
    const newUrl = window.location.pathname + '?tab=arcgis';
    window.history.replaceState(null, '', newUrl);
    buildMapsPage();
  };

  tabFeatures.onclick = () => {
    const newUrl = window.location.pathname + '?tab=features';
    window.history.replaceState(null, '', newUrl);
    buildMapsPage();
  };

    const refreshCalTopoIframe = () => {
        if (!mapIframe || !mapIframe.src) return;
        const refreshedUrl = new URL(mapIframe.src);
        refreshedUrl.searchParams.set('_overlayRefresh', String(Date.now()));
        mapIframe.src = refreshedUrl.toString();
  };

    if (caltopoAssignmentOverlayToggle && !caltopoAssignmentOverlayToggle.dataset.bound) {
        caltopoAssignmentOverlayToggle.checked = isCalTopoAssignmentOverlayEnabled();
        caltopoAssignmentOverlayToggle.onchange = async () => {
            const enabled = caltopoAssignmentOverlayToggle.checked;
            caltopoAssignmentOverlayToggle.disabled = true;
            try {
                const result = await updateCalTopoAssignmentOverlay(enabled, {ensureFeaturesLoaded: true});
                setCalTopoAssignmentOverlayEnabled(enabled);
                refreshCalTopoIframe();
                if (result.updatedCount > 0 && activeTab === 'features') {
                    renderFeaturesList();
                }
            } catch (error) {
                console.error(error);
                caltopoAssignmentOverlayToggle.checked = !enabled;
                setCalTopoAssignmentOverlayEnabled(!enabled);
                alert(error.message || 'Unable to update CalTopo assignment colors.');
            } finally {
                caltopoAssignmentOverlayToggle.disabled = false;
            }
        };
        caltopoAssignmentOverlayToggle.dataset.bound = 'true';
    }

  checkProxyHealth();

  let activeMapId = null;
  let activeMapTeamId = null;
  let activeMapDomain = 'caltopo.com';
  let isFullMode = true;

  const renderMaps = (skipScroll = false) => {
    if (!bundle.maps || bundle.maps.length === 0) {
      mapsList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 40px;">No map added yet. Enter a Map ID above.</p>';
      mapsList.style.display = 'grid';
      mapViewSection.style.display = 'none';
      mapIframe.src = '';
      activeMapId = null;
      activeMapTeamId = null;
      return;
    }
    const map = bundle.maps[0];
    mapsList.innerHTML = '';
    mapsList.style.display = 'none';

    viewMap(map.id, map.name, map.domain, map.teamId, skipScroll);
    if (activeTab === 'features') renderFeaturesList();
    if (activeTab === 'arcgis') renderArcGISMap();
  };

  const viewMap = (id, name, domain, teamId, skipScroll = false) => {
    activeMapId = id;
    activeMapTeamId = teamId || null;
    activeMapDomain = domain || 'caltopo.com';
    currentMapTitle.textContent = name || id;
    const suffix = isFullMode ? '' : '/embed';
    mapIframe.src = `https://${activeMapDomain}/m/${id}${suffix}`;
    mapViewSection.style.display = 'block';
    if (!skipScroll && activeTab === 'map') {
      setTimeout(() => mapViewSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  };

  addMapBtn.onclick = () => {
    const mapIdInput = document.getElementById('map-id-input');
    const teamIdInput = document.getElementById('team-id-input');
    const mapNameInput = document.getElementById('map-name-input');
    const rawInput = mapIdInput.value.trim();
    const teamId = teamIdInput.value.trim();
    const name = mapNameInput.value.trim();
    if (!rawInput) {
      alert('Please enter a Map ID or URL');
      return;
    }

    let id = rawInput;
    let domain = 'caltopo.com';
    if (rawInput.includes('sartopo.com')) {
      domain = 'sartopo.com';
    } else if (rawInput.includes('caltopo.com')) {
      domain = 'caltopo.com';
    }

    const urlMatch = rawInput.match(/\/m\/([A-Za-z0-9-]+)/i);
    if (urlMatch) {
      id = urlMatch[1];
    } else if (rawInput.includes('/')) {
      const parts = rawInput.split('/');
      id = parts[parts.length - 1] || parts[parts.length - 2];
    }

    bundle.maps = [{ id, name, domain, teamId }];
    saveBundle(bundle);
    mapIdInput.value = '';
    teamIdInput.value = '';
    mapNameInput.value = '';
    renderMaps();
  };

  fetchShapesBtn.onclick = () => caltopo_request(fetchShapesBtn);
  if (refreshFeaturesBtn) refreshFeaturesBtn.onclick = () => caltopo_request(refreshFeaturesBtn);

  renderMaps(true);
}

let isSyncing = false;

function mergeTableRows(localRows, serverRows) {
    if (!Array.isArray(localRows) || !Array.isArray(serverRows)) return serverRows;
    const merged = [...serverRows];
    const serverMap = new Map();
    serverRows.forEach((row, index) => {
        if (Array.isArray(row) && row[0]) serverMap.set(row[0].toString().trim(), index);
    });

    localRows.forEach(localRow => {
        if (!Array.isArray(localRow) || !localRow[0]) return;
        const id = localRow[0].toString().trim();
        if (serverMap.has(id)) {
            const sIdx = serverMap.get(id);
            const sRow = merged[sIdx];
            // Merge columns: if server is empty, take local. Server wins on conflicts (sMod > lMod)
            for (let c = 1; c < Math.max(localRow.length, sRow.length); c++) {
                if ((sRow[c] === '' || sRow[c] === undefined) && localRow[c] !== '' && localRow[c] !== undefined) {
                    sRow[c] = localRow[c];
                }
            }
        } else {
            // New row locally
            merged.push(localRow);
        }
    });
    return merged;
}

function mergeRegionsData(local, server) {
    if (!local || !server) return server || local;
    const hL = local.headers || [];
    const hS = server.headers || [];
    const allH = ['Region', ...new Set([...hS.filter(h => h !== 'Region' && h !== 'Consensus'), ...hL.filter(h => h !== 'Region' && h !== 'Consensus')]), 'Consensus'];
    
    const rL = local.rows || [];
    const rS = server.rows || [];
    const mergedRows = [];
    const processed = new Set();

    rS.forEach(rowS => {
        const id = rowS[0] ? rowS[0].toString().trim() : '';
        if (!id) { mergedRows.push(rowS); return; }
        processed.add(id);
        const rowL = rL.find(r => r[0] && r[0].toString().trim() === id);
        
        const mergedRow = new Array(allH.length).fill('');
        allH.forEach((h, i) => {
            const sIdx = hS.indexOf(h);
            const lIdx = hL.indexOf(h);
            const vS = sIdx !== -1 ? rowS[sIdx] : '';
            const vL = (lIdx !== -1 && rowL) ? rowL[lIdx] : '';
            mergedRow[i] = (vS !== '' && vS !== undefined) ? vS : (vL || '');
        });
        mergedRows.push(mergedRow);
    });

    rL.forEach(rowL => {
        const id = rowL[0] ? rowL[0].toString().trim() : '';
        if (id && !processed.has(id)) {
            const mergedRow = new Array(allH.length).fill('');
            allH.forEach((h, i) => {
                const lIdx = hL.indexOf(h);
                if (lIdx !== -1) mergedRow[i] = rowL[lIdx] || '';
            });
            mergedRows.push(mergedRow);
        }
    });
    return { headers: allH, rows: mergedRows };
}

function mergeBundles(local, server) {
    const merged = { ...server };
    if (local.pages && server.pages) {
        merged.pages = { ...server.pages };
        for (const key in local.pages) {
            if (server.pages[key]) {
                if (key === 'index') merged.pages[key] = mergeRegionsData(local.pages[key], server.pages[key]);
                else if (Array.isArray(local.pages[key]) && Array.isArray(server.pages[key])) {
                    merged.pages[key] = mergeTableRows(local.pages[key], server.pages[key]);
                }
            } else {
                merged.pages[key] = local.pages[key];
            }
        }
    }
    if (local.arrivedTeams && server.arrivedTeams) {
        merged.arrivedTeams = [...new Set([...server.arrivedTeams, ...local.arrivedTeams])];
    }
    if (local.activityLog && server.activityLog) {
        const logMap = new Map();
        server.activityLog.forEach(item => logMap.set(item.msg + item.time, item));
        local.activityLog.forEach(item => {
            if (!logMap.has(item.msg + item.time)) logMap.set(item.msg + item.time, item);
        });
        merged.activityLog = Array.from(logMap.values()).sort((a, b) => new Date(b.time) - new Date(a.time));
    }
    return merged;
}

function areBundlesEqual(a, b) {
    const aCopy = { ...a, lastModified: '' };
    const bCopy = { ...b, lastModified: '' };
    return JSON.stringify(aCopy) === JSON.stringify(bCopy);
}

async function syncWithServer() {
    if (isSyncing) return;
    const bucket = getSyncBucket();
    const serverUrl = getSyncServerUrl();
    if (!serverUrl) return;

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const apiBase = `${serverUrl.replace(/\/$/, '')}/api/v1/${bucket}`;
    
    isSyncing = true;
    try {
        const isNewDevice = !localStorage.getItem(BUNDLE_STORAGE_KEY);
        
        // 1. Check active user status
        // (Restriction removed)
        
        // 1. Sync entire file list
        const listResp = await fetch(`${apiBase}/all-files?_=${Date.now()}`);
        if (listResp.ok) {
            const serverFiles = await listResp.json();
            const localFiles = getSavedFiles();
            let localChanged = false;
            let serverNeedsUpdate = false;

            for (const [name, sInfo] of Object.entries(serverFiles)) {
                const lInfo = localFiles[name];
                if (!lInfo || (new Date(sInfo.lastModified) > new Date(lInfo.lastModified))) {
                    localFiles[name] = sInfo;
                    localChanged = true;
                } else if (new Date(sInfo.lastModified) < new Date(lInfo.lastModified)) {
                    serverNeedsUpdate = true;
                }
            }

            for (const name of Object.keys(localFiles)) {
                if (!serverFiles[name]) {
                    serverNeedsUpdate = true;
                }
            }

            if (localChanged) {
                localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(localFiles));
                refreshSyncUI();
            }
            if (serverNeedsUpdate) {
                pushFileListToServer(localFiles);
            }
        } else if (listResp.status === 404) {
            const localFiles = getSavedFiles();
            if (Object.keys(localFiles).length > 0) {
                pushFileListToServer(localFiles);
            }
        }

        // 2. Sync active bundle
        const endpoint = isNewDevice ? 'latest' : 'bundle';
        const resp = await fetch(`${apiBase}/${endpoint}?_=${Date.now()}`);
        if (resp.ok) {
            const serverBundle = await resp.json();
            if (serverBundle) {
                const localBundle = loadBundle();
                const sMod = new Date(serverBundle.lastModified || 0);
                const lMod = new Date(localBundle.lastModified || 0);

                if (sMod > lMod) {
                    const merged = mergeBundles(localBundle, serverBundle);
                    if (areBundlesEqual(merged, serverBundle)) {
                        localStorage.setItem(BUNDLE_STORAGE_KEY, JSON.stringify(serverBundle));
                    } else {
                        // Local has some unique data, push the merged result
                        saveBundle(merged, true);
                    }
                    
                    const files = getSavedFiles();
                    if (serverBundle.fileName) {
                        files[serverBundle.fileName] = {
                            bundle: loadBundle(), // Use potentially merged bundle
                            lastModified: loadBundle().lastModified
                        };
                        localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(files));
                    }
                    refreshSyncUI();
                } else if (lMod > sMod && !isNewDevice) {
                    pushBundleToServer(localBundle);
                }
            }
        } else if (resp.status === 404 && !isNewDevice) {
            pushBundleToServer(loadBundle());
        }

        // 4. Discovery step removed to prevent downloading all bundles into localStorage and exceeding quota.
        // The list is fetched directly from the backend dynamically instead.
    } catch (err) {
        console.warn("Sync background check failed:", err);
    } finally {
        isSyncing = false;
    }
}

async function pushBundleToServer(bundle) {
    const bucket = getSyncBucket();
    const serverUrl = getSyncServerUrl();
    if (!serverUrl) return;
    
    const user = getCurrentUser();
    const headers = { 
        'Content-Type': 'application/json',
        'X-User-Name': getAccountName(user),
        'X-User-Pin': user ? user.pin : ''
    };
    
    try {
        const baseUrl = serverUrl.replace(/\/$/, '');
        // 1. Push to the general active bundle endpoint
        const resp = await fetch(`${baseUrl}/api/v1/${bucket}/bundle`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(bundle)
        });

        // 2. Also push to a file-specific endpoint to aid discovery and prevent truncation
        if (bundle.fileName) {
            const fileKey = bundle.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            await fetch(`${baseUrl}/api/v1/${bucket}/${fileKey}`, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(bundle)
            });
        }

        if (!resp.ok) {
            const errorData = await resp.json().catch(() => ({}));
            if (resp.status === 403 && (errorData.message || '').includes('older than server data')) {
                return; // Silently ignore sync conflicts
            }
            console.error("Push bundle failed:", resp.status, errorData.message || '');
        }
    } catch (err) {
        console.error("Push bundle failed:", err);
    }
}

async function pushFileListToServer(files) {
    const bucket = getSyncBucket();
    const serverUrl = getSyncServerUrl();
    if (!serverUrl) return;
    
    const user = getCurrentUser();
    const headers = { 
        'Content-Type': 'application/json',
        'X-User-Name': getAccountName(user),
        'X-User-Pin': user ? user.pin : '',
        'X-Last-Modified': new Date().toISOString()
    };
    
    try {
        const resp = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/${bucket}/all-files`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(files)
        });
        if (!resp.ok) {
            const errorData = await resp.json().catch(() => ({}));
            if (resp.status === 403 && (errorData.message || '').includes('older than server data')) {
                return; // Silently ignore sync conflicts
            }
            console.error("Push file list failed:", resp.status, errorData.message || '');
        }
    } catch (err) {
        console.error("Push file list failed:", err);
    }
}

async function notifyActiveUser(user) {
    const bucket = getSyncBucket();
    const serverUrl = getSyncServerUrl();
    if (!serverUrl || !user || !user.pin) return;

    const headers = {
        'Content-Type': 'application/json',
        'X-User-Name': getAccountName(user),
        'X-User-Pin': user ? user.pin : ''
    };
    
    try {
        const resp = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/${bucket}/user-${user.pin}`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({deviceId: getDeviceId(), lastModified: new Date().toISOString()})
        });
        if (!resp.ok) {
            const errorData = await resp.json().catch(() => ({}));
            if (resp.status === 403 && (errorData.message || '').includes('older than server data')) {
                return; // Silently ignore sync conflicts
            }
            console.error("Notify active user failed:", resp.status, errorData.message || '');
        }
    } catch (err) {
        console.error("Notify active user failed:", err);
    }
}

function refreshSyncUI() {
    if (isHomePage()) buildHomePage();
    else if (isRegionsPage()) buildRegionsTable();
    else if (isSegmentsPage()) buildSegmentsTable();
    else if (isPersonnelPage()) buildPersonnelTable();
    else if (isSearchLogPage()) buildSearchLogTable();
    else if (isFormsPage()) buildFormsPage();
    else if (isProfilePage()) buildProfilePage();
    else if (isPage8()) buildUserAccountPage();
    else if (isPage9()) buildUserManagementPage();
    else if (isMapsPage()) buildMapsPage();
    else if (isUploadsPage()) buildUploadsPage();
    else buildStandardTable();
}

// Start sync loop
setInterval(syncWithServer, 2000);
// Initial sync
setTimeout(syncWithServer, 1000);
