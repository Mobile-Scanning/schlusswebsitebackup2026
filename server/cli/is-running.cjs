// Exit code 0 when the SCHLUSS website already answers on this computer (used by START.bat).
fetch('http://localhost:' + (process.env.PORT || 4200) + '/api/health', { signal: AbortSignal.timeout(3000) }).then(() => process.exit(0)).catch(() => process.exit(1));
