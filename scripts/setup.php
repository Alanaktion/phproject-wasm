<?php
/**
 * phproject-wasm Setup Script
 *
 * This PHP script runs inside the WASM PHP-CGI environment via the service worker.
 * It is preloaded into the WASM filesystem at /config/setup.php.
 *
 * Requires PHP 8.1+ (uses the never return type). The WASM runtime uses PHP 8.3.
 *
 * It performs a one-time setup:
 *   1. Reads the install configuration from /config/install.json
 *   2. Extracts the phproject zip from /persist/phproject.zip
 *   3. Creates an SQLite database with the phproject schema
 *   4. Inserts the admin user and default configuration values
 *   5. Writes config.php so phproject can find its database
 *
 * On success it returns JSON: {"success": true}
 * On failure it returns JSON: {"error": "message"} with a non-200 status.
 */

header('Content-Type: application/json');

$zipPath    = '/persist/phproject.zip';
$configPath = '/config/install.json';
$docroot    = '/persist/phproject';
$dbPath     = '/persist/phproject/phproject.sqlite';

// ── Helper: send an error response ───────────────────────────────────────────
function fail(string $message, int $status = 500): never
{
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit(1);
}

// ── 1. Read install configuration ────────────────────────────────────────────
if (!file_exists($configPath)) {
    fail('Install configuration not found at ' . $configPath, 400);
}
$config = json_decode(file_get_contents($configPath), true);
if (!$config) {
    fail('Could not parse install configuration', 400);
}
$adminUsername = $config['username'] ?? 'admin';
$adminPassword = $config['password'] ?? 'admin';
$adminEmail    = $config['email']    ?? 'admin@localhost';
$siteName      = $config['siteName'] ?? 'Phproject';

// ── 2. Extract phproject zip ──────────────────────────────────────────────────
if (!file_exists($docroot . '/index.php')) {
    if (!file_exists($zipPath)) {
        fail('Phproject zip not found at ' . $zipPath . ' and phproject is not yet extracted', 400);
    }

    if (!is_dir($docroot)) {
        mkdir($docroot, 0777, true);
    }

    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::RDONLY) !== true) {
        fail('Could not open phproject zip archive');
    }

    // Determine the path prefix used inside the zip.
    // GitHub Actions creates zips with the full workspace path, e.g.
    //   home/runner/work/phproject/phproject/index.php
    // Find the directory that contains install.php to use as the strip prefix.
    $prefix = '';
    for ($i = 0; $i < $zip->count(); $i++) {
        $name = $zip->getNameIndex($i);
        if (basename($name) === 'install.php') {
            $dir = dirname($name);
            if ($dir !== '.') {
                $prefix = $dir . '/';
            }
            break;
        }
    }

    // Extract files, stripping the prefix
    $total     = $zip->count();
    $extracted = 0;
    for ($i = 0; $i < $total; $i++) {
        $name = $zip->getNameIndex($i);

        // Skip entries outside the phproject root
        if ($prefix !== '' && strpos($name, $prefix) !== 0) {
            continue;
        }

        $relative = ($prefix !== '') ? substr($name, strlen($prefix)) : $name;
        if ($relative === '' || $relative === false) {
            continue;
        }

        $target = $docroot . '/' . $relative;

        if (substr($name, -1) === '/') {
            // Directory entry
            if (!is_dir($target)) {
                mkdir($target, 0777, true);
            }
        } else {
            // File entry
            $dir = dirname($target);
            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }
            $content = $zip->getFromIndex($i);
            if ($content === false) {
                fail('Could not read zip entry: ' . $name);
            }
            file_put_contents($target, $content);
            $extracted++;
        }
    }

    $zip->close();
    unlink($zipPath);

    if (!file_exists($docroot . '/index.php')) {
        fail('Extraction finished but index.php not found — zip may have an unexpected structure');
    }
}

// ── 3. Create required runtime directories ────────────────────────────────────
foreach (['tmp/cache', 'log', 'uploads'] as $dir) {
    $path = $docroot . '/' . $dir;
    if (!is_dir($path)) {
        mkdir($path, 0777, true);
    }
}

// ── 4. Initialise the SQLite database ────────────────────────────────────────
if (!file_exists($dbPath)) {
    // Read the SQLite schema bundled with phproject
    $schemaFile = $docroot . '/db/database.sqlite.sql';
    if (!file_exists($schemaFile)) {
        fail('SQLite schema file not found: ' . $schemaFile);
    }

    try {
        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Execute schema statements one by one (split on ";")
        $schema = file_get_contents($schemaFile);
        foreach (explode(';', $schema) as $stmt) {
            $stmt = trim($stmt);
            if ($stmt !== '') {
                $pdo->exec($stmt);
            }
        }

        // ── 5. Insert admin user ──────────────────────────────────────────────
        // phproject uses: password = hash('sha1', plaintext . salt)
        // salt is a 40-char hex string (SHA-1 of random data)
        $salt     = hash('sha1', random_bytes(32));
        $password = hash('sha1', $adminPassword . $salt);
        $apiKey   = hash('sha1', random_bytes(32));
        $now      = gmdate('Y-m-d H:i:s');

        $stmt = $pdo->prepare(
            'INSERT INTO user
               (username, email, name, password, salt, role, rank, api_key, created_date)
             VALUES
               (:username, :email, :name, :password, :salt, :role, :rank, :api_key, :created_date)'
        );
        $stmt->execute([
            ':username'     => $adminUsername,
            ':email'        => $adminEmail,
            ':name'         => 'Admin',
            ':password'     => $password,
            ':salt'         => $salt,
            ':role'         => 'admin',
            ':rank'         => 2, // RANK_SUPER in phproject
            ':api_key'      => $apiKey,
            ':created_date' => $now,
        ]);

        // ── 6. Insert default configuration ──────────────────────────────────
        $defaults = [
            'session_lifetime'           => '604800',
            'cache_expire.db'            => '3600',
            'cache_expire.attachments'   => '2592000',
            'parse.ids'                  => '1',
            'parse.hashtags'             => '1',
            'parse.urls'                 => '1',
            'parse.emoticons'            => '1',
            'parse.markdown'             => '1',
            'parse.textile'              => '0',
            'site.name'                  => $siteName,
            'site.description'           => 'A high performance full-featured project management system',
            'site.demo'                  => '1',
            'site.theme'                 => 'css/bootstrap-phproject.css',
            'site.timezone'              => 'Etc/UTC',
            'site.public_registration'   => '0',
            'security.block_ccs'         => '0',
            'security.min_pass_len'      => '6',
            'security.restrict_access'   => '0',
            'issue_type.task'            => '1',
            'issue_type.project'         => '2',
            'issue_type.bug'             => '3',
            'issue_priority.default'     => '0',
            'gravatar.rating'            => 'pg',
            'gravatar.default'           => 'mm',
            'mail.truncate_lines'        => '<--->,--- ---,------------------------------',
            'files.maxsize'              => '2097152',
        ];

        $upsert = $pdo->prepare(
            'INSERT INTO config (attribute, value)
             VALUES (:attribute, :value)
             ON CONFLICT(attribute) DO UPDATE SET value = excluded.value'
        );
        foreach ($defaults as $key => $value) {
            $upsert->execute([':attribute' => $key, ':value' => $value]);
        }

        unset($pdo);
    } catch (PDOException $e) {
        fail('Database setup failed: ' . $e->getMessage());
    }
}

// ── 7. Write config.php ───────────────────────────────────────────────────────
// Intentionally omit 'site.url' so phproject computes it from the request at
// runtime, ensuring it works regardless of the deployment origin.
$phpConfig = [
    'db.engine' => 'sqlite',
    'db.name'   => $dbPath,
];
$configContent = "<?php\nreturn " . var_export($phpConfig, true) . ";\n";
if (file_put_contents($docroot . '/config.php', $configContent) === false) {
    fail('Could not write config.php to ' . $docroot);
}

// ── 8. Clean up ───────────────────────────────────────────────────────────────
if (file_exists($configPath)) {
    unlink($configPath);
}

echo json_encode(['success' => true]);
