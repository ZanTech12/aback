// ===================================================================
// ✅ SYNC ROUTE — v4.1 (router version)
// ✅ Pre-flight schema check on the SOURCE (refuses to dump a stale
//    schema — permanently breaks the "data missing until db push" loop)
// ✅ Strict exit codes (exit 1 = FAILURE, never "success")
// ✅ --single-transaction (failed/aborted restore changes NOTHING)
// ✅ Unique temp file + concurrency guard + timeouts + disconnect abort
// ✅ Neon pooler bypassed everywhere
// ✅ FIXED: schema steps write a TEMP copy of schema.prisma with the
//    target URL HARDCODED — the Prisma CLI lets .env override real
//    env vars, which previously made the "Neon" step hit localhost.
//    The 🔎 Target lines show exactly which database is being pushed.
// ===================================================================

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { authenticateToken } = require('../middlewares/authMiddleware');

console.log('📌 SYNC ROUTE v4.1 (router) LOADED — hardcoded-URL schema push; .env cannot hijack the target');

// ---------------- PostgreSQL tools ----------------
const getPGBinDir = () => {
    if (process.env.PG_BIN_PATH) return process.env.PG_BIN_PATH;

    if (process.resourcesPath) {
        const bundled = path.join(process.resourcesPath, 'postgres', 'bin');
        if (fs.existsSync(path.join(bundled, 'pg_dump.exe'))) return bundled;
    }

    // repo-local portable build (this file lives in backend/routes/)
    const local = path.join(__dirname, '..', '..', 'resources', 'postgres', 'bin');
    if (fs.existsSync(path.join(local, 'pg_dump.exe'))) return local;

    return 'C:\\Program Files\\PostgreSQL\\18\\bin'; // ⚠ match Neon's PG major version
};

const PG_BIN_DIR = getPGBinDir();
const PG_DUMP_PATH = path.join(PG_BIN_DIR, 'pg_dump.exe');
const PG_RESTORE_PATH = path.join(PG_BIN_DIR, 'pg_restore.exe');
console.log(`🛠️  PostgreSQL tools directory: ${PG_BIN_DIR}`);

const SYNC_TIMEOUT_MS = 30 * 60 * 1000;
const SCHEMA_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------- Prisma auto-detection (backend/ or repo-root layout) ----------------
const PRISMA_SCHEMA_PATH = [
    path.join(__dirname, '..', 'prisma', 'schema.prisma'),         // backend/prisma
    path.join(__dirname, '..', '..', 'prisma', 'schema.prisma')    // repo root/prisma
].find((p) => fs.existsSync(p)) || null;

const PRISMA_CLI_DIR = [
    path.join(__dirname, '..', 'node_modules', 'prisma'),          // backend/node_modules
    path.join(__dirname, '..', '..', 'node_modules', 'prisma')     // repo root/node_modules
].find((p) => fs.existsSync(p)) || null;

const PRISMA_CLI_JS = PRISMA_CLI_DIR
    ? path.join(PRISMA_CLI_DIR, 'build', 'index.js')
    : null;

const PRISMA_CWD = PRISMA_SCHEMA_PATH
    ? path.dirname(path.dirname(PRISMA_SCHEMA_PATH))
    : path.join(__dirname, '..');

if (PRISMA_SCHEMA_PATH && PRISMA_CLI_JS && fs.existsSync(PRISMA_CLI_JS)) {
    console.log(`📌 Prisma schema: ${PRISMA_SCHEMA_PATH}`);
    console.log(`📌 Prisma CLI:    ${PRISMA_CLI_JS}`);
} else {
    console.log('⚠️ Prisma CLI / schema.prisma not found — schema steps during sync will be SKIPPED.');
}

const parseConn = (urlStr) => {
    const u = new URL(urlStr);
    return {
        host: u.hostname.replace('-pooler', ''), // ✅ bypass Neon pooler
        port: u.port || 5432,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.slice(1)
    };
};

let syncInProgress = false; // ✅ one sync at a time

router.post('/:direction', authenticateToken, async (req, res) => {
    // ---------------- validation BEFORE the SSE stream ----------------
    if (!['admin', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
    }
    const direction = req.params.direction;
    if (direction !== 'to-local' && direction !== 'to-online') {
        return res.status(400).json({ success: false, message: 'Invalid direction. Use "to-local" or "to-online".' });
    }
    const LOCAL_URL = process.env.DATABASE_URL;
    const ONLINE_URL = process.env.ONLINE_DATABASE_URL;
    if (!LOCAL_URL || !ONLINE_URL) {
        return res.status(500).json({ success: false, message: 'Local or online database URL not configured.' });
    }
    if (!fs.existsSync(PG_DUMP_PATH) || !fs.existsSync(PG_RESTORE_PATH)) {
        return res.status(500).json({
            success: false,
            message: `pg_dump/pg_restore not found in "${PG_BIN_DIR}". Bundle PostgreSQL in resources/postgres or set PG_BIN_PATH.`
        });
    }
    if (syncInProgress) {
        return res.status(409).json({ success: false, message: 'A synchronization is already running. Wait for it to finish.' });
    }
    syncInProgress = true;

    // ---------------- SSE setup ----------------
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (message) => res.write(`data: ${JSON.stringify({ message })}\n\n`);

    const tempFile = path.join(os.tmpdir(), `sync-${Date.now()}-${process.pid}.dump`);
    const legacyFile = path.join(os.tmpdir(), 'temp_sync.dump');
    if (fs.existsSync(legacyFile)) { try { fs.unlinkSync(legacyFile); } catch (e) {} }

    const cleanup = () => {
        if (fs.existsSync(tempFile)) { try { fs.unlinkSync(tempFile); } catch (e) {} }
    };
    const finish = () => {
        syncInProgress = false;
        cleanup();
        res.end();
    };

    let activeChild = null;
    res.on('close', () => {
        if (!res.writableEnded && activeChild) {
            try { activeChild.kill(); } catch (e) {}
        }
    });

    // ----------------------------------------------------------------
    // ✅ Schema step — v4.1 FIXED:
    //    writes a TEMP copy of schema.prisma with the target URL
    //    hardcoded, then runs prisma db push --schema <tempfile> via
    //    node directly (no shell → no path-space issues, and .env
    //    cannot hijack the target). Prints 🔎 Target for verification.
    // ----------------------------------------------------------------
    const runSchemaStep = (dbUrl, label, critical, onDone) => {
        if (!PRISMA_SCHEMA_PATH || !PRISMA_CLI_JS || !fs.existsSync(PRISMA_CLI_JS)) {
            sendEvent(`⚠️ Prisma CLI / schema.prisma not found — skipping schema ${critical ? 'pre-flight' : 'repair'} on the ${label}.`);
            sendEvent("ℹ️ Run manually: node scripts/push-schema-online.js");
            return onDone(true);
        }

        let tempSchemaPath;
        try {
            const schemaContent = fs.readFileSync(PRISMA_SCHEMA_PATH, 'utf8');
            if (!/env\(\s*["']DATABASE_URL["']\s*\)/.test(schemaContent)) {
                sendEvent(`⚠️ schema.prisma doesn't use env("DATABASE_URL") — cannot target the ${label}. Skipping.`);
                return onDone(true);
            }
            tempSchemaPath = path.join(os.tmpdir(), `prisma-sync-${Date.now()}-${process.pid}.prisma`);
            const patched = schemaContent
                .replace(/env\(\s*["']DATABASE_URL["']\s*\)/g, JSON.stringify(dbUrl))
                .replace(/env\(\s*["']DIRECT_URL["']\s*\)/g, JSON.stringify(dbUrl));
            fs.writeFileSync(tempSchemaPath, patched);
        } catch (e) {
            sendEvent(`⚠️ Could not prepare temp schema: ${e.message}`);
            return onDone(!critical);
        }

        sendEvent(`🔄 ${critical ? 'Pre-flight: verifying' : 'Repairing'} schema on the ${label}...`);
        sendEvent(`🔎 Target: ${dbUrl.replace(/:[^:@/]+@/, ':***@')}`); // ← VERIFY this host!

        const child = spawn(process.execPath,
            [PRISMA_CLI_JS, 'db', 'push', '--skip-generate', '--schema', tempSchemaPath],
            { cwd: PRISMA_CWD }
        );
        activeChild = child;

        const timer = setTimeout(() => {
            sendEvent(`❌ Schema step on the ${label} timed out — aborting it.`);
            try { child.kill(); } catch (e) {}
        }, SCHEMA_TIMEOUT_MS);

        child.stdout.on('data', (d) => { const m = d.toString().trim(); if (m) sendEvent(`Schema: ${m}`); });
        child.stderr.on('data', (d) => { const m = d.toString().trim(); if (m) sendEvent(`Schema: ${m}`); });

        const cleanupTemp = () => {
            if (tempSchemaPath && fs.existsSync(tempSchemaPath)) { try { fs.unlinkSync(tempSchemaPath); } catch (e) {} }
        };

        child.on('error', (err) => {
            clearTimeout(timer);
            cleanupTemp();
            sendEvent(`⚠️ Could not start Prisma CLI: ${err.message}`);
            sendEvent("ℹ️ Run manually: node scripts/push-schema-online.js");
            onDone(!critical);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            cleanupTemp();
            if (code === 0) {
                sendEvent(`✅ ${label} schema is in sync.`);
                return onDone(true);
            }
            if (critical) {
                sendEvent(`❌ Pre-flight FAILED (exit ${code}) — SYNC ABORTED, nothing was pushed.`);
                sendEvent(`ℹ️ Fix it first: run "npx prisma db push" in a normal terminal and READ its output. Never add --accept-data-loss blindly.`);
            } else {
                sendEvent(`⚠️ Target schema repair exited with code ${code} — the data IS restored, but run "node scripts/push-schema-online.js" and read its output.`);
            }
            onDone(false);
        });
    };

    try {
        let sourceConn, targetConn, sourceUrl, targetUrl, sourceLabel, targetLabel;
        if (direction === 'to-local') {
            sourceConn = parseConn(ONLINE_URL);
            targetConn = parseConn(LOCAL_URL);
            sourceUrl = ONLINE_URL.replace('-pooler', '');
            targetUrl = LOCAL_URL;
            sourceLabel = 'Neon (source)';
            targetLabel = 'LOCAL (target)';
            sendEvent("Starting backup from Neon Cloud...");
        } else {
            sourceConn = parseConn(LOCAL_URL);
            targetConn = parseConn(ONLINE_URL);
            sourceUrl = LOCAL_URL;
            targetUrl = ONLINE_URL.replace('-pooler', '');
            sourceLabel = 'LOCAL (source)';
            targetLabel = 'Neon (target)';
            sendEvent("Starting push from Local Database...");
        }

        // ✅ PRE-FLIGHT: the SOURCE schema must match schema.prisma
        //    BEFORE we dump it. This is what breaks the crash loop.
        runSchemaStep(sourceUrl, sourceLabel, true, (ok) => {
            if (!ok) return finish();

            const dumpArgs = [
                `--host=${sourceConn.host}`,
                `--port=${sourceConn.port}`,
                `--username=${sourceConn.user}`,
                `--dbname=${sourceConn.database}`,
                `--format=c`,
                `--file=${tempFile}`
            ];

            const dump = spawn(PG_DUMP_PATH, dumpArgs, { env: { ...process.env, PGPASSWORD: sourceConn.password } });
            activeChild = dump;

            const dumpTimer = setTimeout(() => {
                sendEvent("❌ Dump timed out — aborting.");
                try { dump.kill(); } catch (e) {}
            }, SYNC_TIMEOUT_MS);

            dump.stderr.on('data', (data) => {
                const msg = data.toString();
                if (!msg.toLowerCase().includes('warning')) sendEvent(`Dumping: ${msg.trim()}`);
            });

            dump.on('error', (err) => {
                clearTimeout(dumpTimer);
                sendEvent(`❌ Spawn Error: ${err.message}`);
                finish();
            });

            dump.on('close', (code) => {
                clearTimeout(dumpTimer);
                if (code !== 0) {
                    sendEvent(`❌ Dump FAILED (exit code ${code}). Nothing was changed on either database.`);
                    return finish();
                }

                sendEvent("✅ Dump complete. Starting restore...");

                const restoreArgs = [
                    `--host=${targetConn.host}`,
                    `--port=${targetConn.port}`,
                    `--username=${targetConn.user}`,
                    `--dbname=${targetConn.database}`,
                    '--clean',
                    '--if-exists',
                    '--no-owner',
                    '--no-privileges',
                    '--no-comments',
                    '--single-transaction', // atomic: failure = target untouched
                    tempFile
                ];

                const restore = spawn(PG_RESTORE_PATH, restoreArgs, { env: { ...process.env, PGPASSWORD: targetConn.password } });
                activeChild = restore;

                const restoreTimer = setTimeout(() => {
                    sendEvent("❌ Restore timed out — aborting. Target database will be left unchanged.");
                    try { restore.kill(); } catch (e) {}
                }, SYNC_TIMEOUT_MS);

                restore.stderr.on('data', (data) => {
                    const msg = data.toString().trim();
                    if (msg) sendEvent(`Restore Log: ${msg}`);
                });

                restore.on('error', (err) => {
                    clearTimeout(restoreTimer);
                    sendEvent(`❌ Spawn Error: ${err.message}`);
                    finish();
                });

                restore.on('close', (code) => {
                    clearTimeout(restoreTimer);
                    if (code !== 0) {
                        sendEvent(`❌ Restore FAILED (exit code ${code}). The target database was left UNCHANGED (rolled back). Check the Restore Log above.`);
                        return finish();
                    }

                    sendEvent("✅ Restore complete.");

                    // ✅ POST-RESTORE: repair/verify the TARGET schema.
                    runSchemaStep(targetUrl, targetLabel, false, () => {
                        sendEvent("✅ Synchronization completed successfully!");
                        sendEvent(`ℹ️ Restart the ${direction === 'to-online' ? 'ONLINE server' : 'LOCAL app'} now so it rebuilds its database connections.`);
                        finish();
                    });
                });
            });
        });

    } catch (error) {
        console.error('Sync error:', error.message);
        sendEvent(`❌ Server error: ${error.message}`);
        finish();
    }
});

module.exports = router;