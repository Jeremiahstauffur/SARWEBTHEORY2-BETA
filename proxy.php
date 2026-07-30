<?php
/**
 * SAR CalTopo Proxy (PHP Version)
 * Use this file if your hosting environment does not support Node.js/Express.
 *
 * This implementation follows CalTopo's Team API signing flow for reading map
 * state from `/api/v1/map/{mapId}/since/0`.
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

function getTrimmedString($value)
{
    return is_string($value) ? trim($value) : '';
}

function getJsonBody()
{
    $rawBody = file_get_contents('php://input');
    if (!$rawBody) {
        return [];
    }

    $decoded = json_decode($rawBody, true);
    return is_array($decoded) ? $decoded : [];
}

function resolveCalTopoCredentials($requestData)
{
    $envCredentialId = getTrimmedString(getenv('CALTOPO_CREDENTIAL_ID') ?: (getenv('SARTOPO_CREDENTIAL_ID') ?: ''));
    $envCredentialSecret = getTrimmedString(getenv('CALTOPO_CREDENTIAL_SECRET') ?: (getenv('CALTOPO_SECRET') ?: (getenv('SARTOPO_SECRET') ?: '')));

    return [
        'credentialId' => $envCredentialId,
        'credentialSecret' => $envCredentialSecret,
        'configured' => $envCredentialId !== '' && $envCredentialSecret !== '',
        'source' => ($envCredentialId !== '' && $envCredentialSecret !== '') ? 'environment' : 'missing'
    ];
}

function ensureHttpsDomain($domain)
{
    $normalized = strtolower(getTrimmedString($domain ?: 'caltopo.com'));
    if ($normalized === '' || strpos($normalized, '/') !== false || strpos($normalized, '\\') !== false || strpos($normalized, '?') !== false) {
        return 'caltopo.com';
    }

    return $normalized;
}

function signRequest($method, $endpoint, $payload, $credentialSecret)
{
    $expires = (int)round(microtime(true) * 1000) + 2 * 60 * 1000;
    $stringToSign = strtoupper($method) . ' ' . $endpoint . "\n" . $expires . "\n" . $payload;
    $signature = base64_encode(hash_hmac('sha256', $stringToSign, base64_decode($credentialSecret), true));

    return [
        'expires' => $expires,
        'signature' => $signature
    ];
}

function normalizeCalTopoState($payload)
{
    if (!is_array($payload)) {
        return [
            'type' => 'FeatureCollection',
            'features' => []
        ];
    }

    if (isset($payload['result']) && is_array($payload['result'])) {
        $result = $payload['result'];

        if ((isset($result['type']) ? $result['type'] : null) === 'FeatureCollection' && isset($result['features']) && is_array($result['features'])) {
            if (!isset($result['timestamp']) && isset($payload['timestamp'])) {
                $result['timestamp'] = $payload['timestamp'];
            }
            return $result;
        }

        if (isset($result['state']) && is_array($result['state']) && ((isset($result['state']['type']) ? $result['state']['type'] : null) === 'FeatureCollection') && isset($result['state']['features']) && is_array($result['state']['features'])) {
            $state = $result['state'];
            if (!isset($state['ids']) && isset($result['ids'])) {
                $state['ids'] = $result['ids'];
            }
            if (!isset($state['timestamp'])) {
                $state['timestamp'] = isset($result['timestamp']) ? $result['timestamp'] : (isset($payload['timestamp']) ? $payload['timestamp'] : null);
            }
            return $state;
        }
    }

    if ((isset($payload['type']) ? $payload['type'] : null) === 'FeatureCollection' && isset($payload['features']) && is_array($payload['features'])) {
        return $payload;
    }

    if (isset($payload['state']) && is_array($payload['state']) && ((isset($payload['state']['type']) ? $payload['state']['type'] : null) === 'FeatureCollection') && isset($payload['state']['features']) && is_array($payload['state']['features'])) {
        return $payload['state'];
    }

    if (isset($payload['features']) && is_array($payload['features'])) {
        return [
            'type' => 'FeatureCollection',
            'features' => $payload['features'],
            'ids' => isset($payload['ids']) ? $payload['ids'] : null,
            'timestamp' => isset($payload['timestamp']) ? $payload['timestamp'] : null
        ];
    }

    return [
        'type' => 'FeatureCollection',
        'features' => []
    ];
}

function performRequest($targetUrl, $params)
{
    $url = $targetUrl . '?' . http_build_query($params);
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    return [
        'response' => $response,
        'httpCode' => $httpCode,
        'error' => $error,
        'url' => $url
    ];
}

$requestBody = getJsonBody();
$requestData = array_merge($_GET, $requestBody);

if (isset($_GET['health']) || (isset($_SERVER['PATH_INFO']) && $_SERVER['PATH_INFO'] === '/api/health')) {
    $creds = resolveCalTopoCredentials($requestData);
    echo json_encode([
        'status' => 'ok',
        'message' => 'PHP proxy is live and ready for signed CalTopo Team API requests using backend environment credentials',
        'version' => '1.3.0',
        'caltopoSigningConfigured' => $creds['configured'],
        'caltopoCredentialSource' => $creds['source'],
        'supportsClientSuppliedCredentials' => false,
        'timestamp' => date('c')
    ]);
    exit;
}

$mapId = getTrimmedString(isset($requestData['mapId']) ? $requestData['mapId'] : '');
$domain = ensureHttpsDomain(isset($requestData['domain']) ? $requestData['domain'] : 'caltopo.com');

if ($mapId === '') {
    http_response_code(400);
    echo json_encode([
        'error' => 'Missing mapId parameter',
        'message' => 'Please ensure your Map ID is correctly entered in the Maps page (e.g., ABCDE).'
    ]);
    exit;
}

$creds = resolveCalTopoCredentials($requestData);
$endpoint = '/api/v1/map/' . rawurlencode($mapId) . '/since/0';
$targetUrl = 'https://' . $domain . $endpoint;

if (!$creds['configured']) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Proxy Not Configured',
        'message' => 'This proxy needs a CalTopo Credential ID and Credential Secret in the server environment to sign the Team API request.',
        'targetUrl' => $targetUrl,
        'mapId' => $mapId,
        'signingRequired' => true,
        'supportsClientSuppliedCredentials' => false
    ]);
    exit;
}

$signatureData = signRequest('GET', $endpoint, '', $creds['credentialSecret']);
$result = performRequest($targetUrl, [
    'id' => $creds['credentialId'],
    'expires' => $signatureData['expires'],
    'signature' => $signatureData['signature'],
    '_' => (int)round(microtime(true) * 1000)
]);

$response = $result['response'];
$httpCode = $result['httpCode'];
$error = $result['error'];
$resolvedUrl = $result['url'];

if ($response === false) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Proxy Connection Error',
        'message' => 'The PHP proxy could not connect to CalTopo. Details: ' . $error,
        'targetUrl' => $resolvedUrl,
        'mapId' => $mapId,
        'signingRequired' => true,
        'credentialSource' => $creds['source']
    ]);
    exit;
}

$decoded = json_decode($response, true);
$detailMessage = is_string($decoded)
    ? substr($decoded, 0, 400)
    : ((is_array($decoded) && isset($decoded['message'])) ? $decoded['message'] : '');

if ($httpCode >= 400) {
    http_response_code($httpCode);
    echo json_encode([
        'error' => 'CalTopo Error ' . $httpCode,
        'message' => $detailMessage !== '' ? $detailMessage : 'The request to CalTopo failed.',
        'targetUrl' => $resolvedUrl,
        'mapId' => $mapId,
        'signingRequired' => true,
        'credentialSource' => $creds['source'],
        'supportsClientSuppliedCredentials' => false,
        'caltopoResponse' => $decoded
    ]);
    exit;
}

$normalizedState = normalizeCalTopoState($decoded);
echo json_encode([
    'type' => isset($normalizedState['type']) ? $normalizedState['type'] : 'FeatureCollection',
    'features' => isset($normalizedState['features']) ? $normalizedState['features'] : [],
    'state' => $normalizedState,
    'source' => 'caltopo-signed-proxy',
    'credentialSource' => $creds['source'],
    'mapId' => $mapId,
    'domain' => $domain
]);
