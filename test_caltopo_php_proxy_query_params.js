const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunctionSource(source, signaturePrefix) {
    const start = source.indexOf(signaturePrefix);
    if (start === -1) {
        throw new Error(`Could not find function signature: ${signaturePrefix}`);
    }

    const openBrace = source.indexOf('{', start);
    if (openBrace === -1) {
        throw new Error(`Could not find opening brace for: ${signaturePrefix}`);
    }

    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(`Could not find closing brace for: ${signaturePrefix}`);
}

async function main() {
    const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
    const normalizeSrc = extractFunctionSource(appSource, 'function normalizeCalTopoProxyUrl(url)');
    const appendQuerySrc = extractFunctionSource(appSource, 'function appendUrlQueryParam(url, key, value = \'1\')');
    const normalizeDomainSrc = extractFunctionSource(appSource, 'function normalizeCalTopoDomain(domain, fallback = \'caltopo.com\')');
    const healthSrc = extractFunctionSource(appSource, 'function getCalTopoProxyHealthUrl(url)');
    const executeSrc = extractFunctionSource(appSource, 'async function _execute_caltopo_api_call(method, endpoint, payload, domain)');

    const sandbox = {
        capturedUrl: null,
        capturedOptions: null,
        console,
        alert: () => {},
        getCalTopoProxy: () => 'https://proxy.example.com/proxy.php?token=abc123',
        fetch: async (url, options = {}) => {
            sandbox.capturedUrl = url;
            sandbox.capturedOptions = options;
            return {
                ok: true,
                status: 200,
                headers: {get: () => 'application/json'},
                json: async () => ({ok: true}),
                text: async () => ''
            };
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(`${normalizeSrc}\n${appendQuerySrc}\n${normalizeDomainSrc}\n${healthSrc}\n${executeSrc}`, sandbox);

    const healthUrl = sandbox.getCalTopoProxyHealthUrl('https://proxy.example.com/proxy.php?token=abc123');
    assert.strictEqual(
        healthUrl,
        'https://proxy.example.com/proxy.php?token=abc123&health=1',
        'Health URL must preserve existing query params when appending health=1'
    );

    await sandbox._execute_caltopo_api_call(
        'POST',
        '/api/v1/map/M123/Shape/shape-1',
        {id: 'shape-1', type: 'Feature', properties: {name: 'Alpha'}},
        'https://sartopo.com/m/ABC123?tab=map'
    );

    assert.strictEqual(
        sandbox.capturedUrl,
        'https://proxy.example.com/proxy.php?token=abc123&api_call=1',
        'API call URL must preserve existing query params when appending api_call=1'
    );

    assert.strictEqual(
        sandbox.capturedOptions.method,
        'POST',
        'Expected POST method when forwarding generic map object updates through proxy'
    );

    const forwardedBody = JSON.parse(sandbox.capturedOptions.body);
    assert.strictEqual(
        forwardedBody.domain,
        'sartopo.com',
        'API call must normalize URL-like domain values to the expected hostname'
    );

    console.log('All PHP proxy query-param and domain normalization checks passed.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
