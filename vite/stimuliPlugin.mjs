import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Serve the thesis stimulus set at /stimuli during local development/preview.
 *
 * The WAVs live in `<thesis>/stimuli/`, outside this git repository, and total
 * ~132 MB. They must not be copied into `public/` (Vite copies that verbatim
 * into `dist/`, and it would also drag the audio into this repo), and a symlink
 * is no better — `vite build` follows it. So the dev and preview servers mount
 * the directory directly and no duplicate ever exists.
 *
 * D23 adds a separate production-only step (`tools/packageStimuli.mjs`) that
 * copies exactly the 640 catalog-referenced WAVs into `dist/stimuli/`. Keeping
 * that concern out of this plugin preserves fast local development and prevents
 * `public/` from becoming a second, hand-maintained stimulus source.
 *
 * The `root` option is what a vocoded stimulus set would switch (§3.2).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../stimuli');

const MOUNT = '/stimuli/';

export function stimuli ({ root = DEFAULT_ROOT } = {})
{
    const serve = (req, res, next) =>
    {
        if (!req.url || !req.url.startsWith(MOUNT))
        {
            return next();
        }

        // Strip the query/hash Vite appends to some requests, then decode: the
        // stimulus ids are plain ASCII, but the decode keeps this honest.
        const requested = decodeURIComponent(req.url.slice(MOUNT.length).split(/[?#]/)[0]);
        const target = path.resolve(root, requested);

        // Path traversal guard: never serve outside the stimulus root.
        if (target !== root && !target.startsWith(root + path.sep))
        {
            res.statusCode = 403;
            return res.end('Forbidden');
        }

        let stat;

        try
        {
            stat = statSync(target);
        }
        catch
        {
            res.statusCode = 404;
            return res.end(`Not found: ${requested}`);
        }

        if (!stat.isFile())
        {
            res.statusCode = 404;
            return res.end(`Not a file: ${requested}`);
        }

        res.setHeader('Content-Type', target.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        // No caching: a regenerated stimulus set must never be served stale
        // during a session.
        res.setHeader('Cache-Control', 'no-store');

        createReadStream(target).pipe(res);
    };

    return {
        name: 'thesis-stimuli',
        configureServer (server)
        {
            server.middlewares.use(serve);
        },
        configurePreviewServer (server)
        {
            server.middlewares.use(serve);
        }
    };
}
