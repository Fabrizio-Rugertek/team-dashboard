'use strict';
/**
 * md-sop-loader — Markdown SOPs from fabri-context.
 *
 * Lee SOPs prosa (markdown) de companies/{company}/sops/ en el repo fabri-context.
 * Permite save con git commit + push automático para mantener versionado.
 *
 * Configuración:
 *   FABRI_CONTEXT_PATH — path al repo fabri-context (default: ~/Documents/OpenClaw/fabri-context)
 *   GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL — committer al hacer save (default: user editor)
 *
 * Disparador de reindex post-save:
 *   1. Si BRAIN_MCP_REINDEX_URL está seteado → POST a esa URL
 *   2. Sino, intenta correr indexer local (BRAIN_MCP_PATH/indexer.py)
 */

const fs       = require('fs');
const path     = require('path');
const { execSync, exec } = require('child_process');
const os       = require('os');

const FABRI_CONTEXT_PATH = process.env.FABRI_CONTEXT_PATH ||
  path.join(os.homedir(), 'Documents', 'OpenClaw', 'fabri-context');

const COMPANIES_DIR = path.join(FABRI_CONTEXT_PATH, 'companies');

// Companies known
const KNOWN_COMPANIES = ['rugertek', 'torus', 'amiba', 'salotec'];


/** Lista companies que tienen SOPs markdown */
function listCompanies() {
  if (!fs.existsSync(COMPANIES_DIR)) return [];
  return fs.readdirSync(COMPANIES_DIR)
    .filter(f => !f.startsWith('_'))
    .filter(f => fs.statSync(path.join(COMPANIES_DIR, f)).isDirectory())
    .filter(f => fs.existsSync(path.join(COMPANIES_DIR, f, 'sops')));
}


/** Lista SOPs markdown de una company */
function listSops(company) {
  const sopsDir = path.join(COMPANIES_DIR, company, 'sops');
  if (!fs.existsSync(sopsDir)) return [];
  return fs.readdirSync(sopsDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(filename => {
      const filePath = path.join(sopsDir, filename);
      const stat     = fs.statSync(filePath);
      const slug     = filename.replace(/\.md$/, '');
      // Extract title from first H1
      let title = slug;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const m = content.match(/^#\s+(.+)$/m);
        if (m) title = m[1].trim();
      } catch {}
      return {
        slug,
        filename,
        title,
        modifiedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      };
    });
}


/** Devuelve contenido markdown de un SOP */
function loadSop(company, slug) {
  const filePath = path.join(COMPANIES_DIR, company, 'sops', `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  return {
    company,
    slug,
    content: fs.readFileSync(filePath, 'utf8'),
    modifiedAt: fs.statSync(filePath).mtime.toISOString(),
  };
}


/**
 * Guarda contenido markdown + commit + push + trigger reindex.
 * Throws si algo falla.
 */
async function saveSop(company, slug, content, opts = {}) {
  const { authorName, authorEmail } = opts;
  const filePath = path.join(COMPANIES_DIR, company, 'sops', `${slug}.md`);
  const relPath  = path.join('companies', company, 'sops', `${slug}.md`);

  if (!fs.existsSync(path.dirname(filePath))) {
    throw new Error(`SOPs dir for company '${company}' does not exist`);
  }

  // Write file
  fs.writeFileSync(filePath, content, 'utf8');

  // Git add + commit + push
  const msg = `edit: ${relPath} via dashboard${authorName ? ` (${authorName})` : ''}`;
  const env = { ...process.env };
  if (authorName)  env.GIT_AUTHOR_NAME  = authorName;
  if (authorEmail) env.GIT_AUTHOR_EMAIL = authorEmail;
  if (authorName)  env.GIT_COMMITTER_NAME  = authorName;
  if (authorEmail) env.GIT_COMMITTER_EMAIL = authorEmail;

  const gitOpts = { cwd: FABRI_CONTEXT_PATH, env, stdio: 'pipe' };
  let gitOutput = '';
  try {
    execSync(`git add "${relPath}"`, gitOpts);
    // Skip si no hay cambios
    const status = execSync(`git status --porcelain "${relPath}"`, gitOpts).toString().trim();
    if (!status) {
      return { saved: true, committed: false, message: 'No changes to commit' };
    }
    gitOutput += execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, gitOpts).toString();
    gitOutput += execSync(`git push origin master`, gitOpts).toString();
  } catch (e) {
    throw new Error(`git operation failed: ${e.stderr?.toString() || e.message}`);
  }

  // Trigger reindex (best effort, no esperar)
  triggerReindex().catch(err => console.error('[md-sop-loader] reindex trigger failed:', err.message));

  return { saved: true, committed: true, gitOutput, filePath };
}


/**
 * Dispara reindex del MCP brain-mcp para que tome los cambios.
 * 1. Si BRAIN_MCP_REINDEX_URL está seteado → POST
 * 2. Sino, intenta correr `python3 indexer.py` en BRAIN_MCP_PATH
 */
async function triggerReindex() {
  const url = process.env.BRAIN_MCP_REINDEX_URL;
  if (url) {
    const axios = require('axios');
    const token = process.env.BRAIN_MCP_REINDEX_TOKEN || '';
    await axios.post(url, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 30000,
    });
    return { method: 'http', url };
  }

  const brainMcpPath = process.env.BRAIN_MCP_PATH;
  if (brainMcpPath && fs.existsSync(path.join(brainMcpPath, 'indexer.py'))) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, BRAIN_ROOT: FABRI_CONTEXT_PATH };
      exec(`python3 indexer.py`, { cwd: brainMcpPath, env, timeout: 60000 },
        (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve({ method: 'subprocess', stdout, stderr });
        });
    });
  }

  return { method: 'none', reason: 'No BRAIN_MCP_REINDEX_URL or BRAIN_MCP_PATH set' };
}


/** Lee data/{company}/data/*.json */
function listData(company) {
  const dataDir = path.join(COMPANIES_DIR, company, 'data');
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ filename: f, slug: f.replace(/\.json$/, '') }));
}


function loadData(company, slug) {
  const filePath = path.join(COMPANIES_DIR, company, 'data', `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  return {
    company, slug,
    content: fs.readFileSync(filePath, 'utf8'),
    modifiedAt: fs.statSync(filePath).mtime.toISOString(),
  };
}


module.exports = {
  FABRI_CONTEXT_PATH,
  KNOWN_COMPANIES,
  listCompanies,
  listSops,
  loadSop,
  saveSop,
  triggerReindex,
  listData,
  loadData,
};
