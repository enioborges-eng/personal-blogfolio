import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TEMPLATE_FILE = join(ROOT, 'src', 'template.html');
const CASE_TEMPLATE_FILE = join(ROOT, 'src', 'case.html');
const OUTPUT_DIR = join(ROOT, 'dist');
const OUTPUT_FILE = join(OUTPUT_DIR, 'index.html');
const CASES_DIR = join(ROOT, 'data', 'cases');

const files = {
  content: { src: join(ROOT, 'data', 'content.json'), example: join(ROOT, 'data', 'content.example.json') },
  writing: { src: join(ROOT, 'data', 'writing.json'), example: join(ROOT, 'data', 'writing.example.json') },
  work:    { src: join(ROOT, 'data', 'work.json'),    example: join(ROOT, 'data', 'work.example.json') },
};

function readJSON(path, examplePath) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`${path} not found, copying from ${examplePath}`);
      copyFileSync(examplePath, path);
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
    console.error(`Failed to parse ${path}: ${err.message}`);
    process.exit(1);
  }
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

// Parses RSS XML. Currently handles Substack format.
// If your feed uses different element paths, add matchers below.
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const title = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || content.match(/<title>(.*?)<\/title>/)?.[1]
      || '';
    const link = content.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const description = content.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
      || content.match(/<description>(.*?)<\/description>/)?.[1]
      || '';
    const image = content.match(/<enclosure[^>]+url="([^"]+)"/)?.[1] || '';
    const fullContent = content.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] || '';

    const parsed = parseDate(pubDate);
    const excerpt = description.replace(/<\/?[^>]+(>|$)/g, '').trim();

    const rawText = fullContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\.(?=[A-Z])/g, '. ')
      .trim();
    const preview = rawText.split(' ').slice(0, 60).join(' ') + (rawText.split(' ').length > 60 ? '...' : '');

    items.push({
      title: title.replace(/<\/?[^>]+(>|$)/g, '').trim(),
      url: link.trim(),
      date: parsed ? formatDate(parsed) : '',
      isoDate: parsed ? parsed.toISOString() : '',
      image,
      excerpt,
      preview,
    });
  }
  return items;
}

async function fetchAndSaveWriting(rssUrl, outPath) {
  try {
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'lean-rss-feed-website/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRSS(xml).filter(i => i.title && i.url);

    if (items.length === 0) throw new Error('no items in feed');

    const [first, ...rest] = items;
    const writing = {
      latest: {
        eyebrow: 'Latest',
        date: first.date,
        title: first.title,
        image: first.image || '',
        excerpt: first.excerpt || '',
        preview: first.preview || '',
        readTime: '',
        url: first.url,
      },
      morePosts: rest.slice(0, 4).map(p => ({
        title: p.title,
        date: p.date,
        url: p.url,
      })),
    };

    writeFileSync(outPath, JSON.stringify(writing, null, 2) + '\n', 'utf-8');
    console.log(`Wrote ${outPath} from RSS`);
    return writing;
  } catch (err) {
    console.warn(`RSS fetch failed (${err.message})`);
    return null;
  }
}

const FAVICON_SRC = join(ROOT, 'src', 'favicon.ico');
const FAVICON_DST = join(OUTPUT_DIR, 'favicon.ico');

function build(data) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(FAVICON_SRC)) copyFileSync(FAVICON_SRC, FAVICON_DST);
  const source = readFileSync(TEMPLATE_FILE, 'utf-8');
  const template = Handlebars.compile(source);
  const html = template(data);
  writeFileSync(OUTPUT_FILE, html, 'utf-8');
  console.log(`Built ${OUTPUT_FILE}`);
}

Handlebars.registerHelper('eq', (a, b) => a === b);

// Loads data/cases/*.json into a map keyed by slug.
function loadCases() {
  const cases = {};
  if (!existsSync(CASES_DIR)) return cases;
  for (const f of readdirSync(CASES_DIR)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(readFileSync(join(CASES_DIR, f), 'utf-8'));
    cases[c.slug || f.replace(/\.json$/, '')] = c;
  }
  return cases;
}

// Attaches a case-study URL to each work item that declares a "case" slug,
// then renders one dist/work/<slug>.html page per case.
function buildCases(cases, content) {
  const outDir = join(OUTPUT_DIR, 'work');
  mkdirSync(outDir, { recursive: true });
  const caseTemplate = Handlebars.compile(readFileSync(CASE_TEMPLATE_FILE, 'utf-8'));
  for (const [slug, c] of Object.entries(cases)) {
    const html = caseTemplate({ ...c, site: content.site });
    const outFile = join(outDir, `${slug}.html`);
    writeFileSync(outFile, html, 'utf-8');
    console.log(`Built ${outFile}`);
  }
}

async function main() {
  const content = readJSON(files.content.src, files.content.example);
  const work = readJSON(files.work.src, files.work.example);
  const writing = await fetchAndSaveWriting(content.rss.url, files.writing.src)
    || readJSON(files.writing.src, files.writing.example);

  const cases = loadCases();
  for (const item of work) {
    if (item.case && cases[item.case]) item.url = `/work/${item.case}.html`;
  }

  const data = { ...content, work, ...writing };
  build(data);
  buildCases(cases, content);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
