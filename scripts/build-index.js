#!/usr/bin/env node
// Scans content/blog and content/projects and writes content/index.json,
// which the site reads to know which posts and projects exist.
// Run locally with:  node scripts/build-index.js
// It also runs automatically on every push (see .github/workflows/deploy.yml).

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

function readFrontmatter(file) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    const fm = {};
    if (!m) return fm;
    for (const line of m[1].split('\n')) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return fm;
}

function scan(dir) {
    const full = path.join(root, 'content', dir);
    if (!fs.existsSync(full)) return [];
    const errors = [];
    const items = fs.readdirSync(full)
        .filter(f => f.endsWith('.md'))
        .map(file => {
            const slug = file.slice(0, -3);
            if (!SLUG_RE.test(slug)) {
                errors.push(`content/${dir}/${file}: file names must be lowercase letters, numbers and hyphens (e.g. my-new-post.md)`);
            }
            const fm = readFrontmatter(path.join(full, file));
            if (fm.draft === 'true') return null;
            return { file, slug, date: Date.parse(fm.date) || 0, order: Number(fm.order) || 0 };
        })
        .filter(Boolean);
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exit(1);
    }
    return items;
}

const blog = scan('blog')
    .sort((a, b) => b.date - a.date || a.slug.localeCompare(b.slug))   // newest first
    .map(({ file, slug }) => ({ file, slug }));

const projects = scan('projects')
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
    .map(({ file, slug }) => ({ file, slug }));

const out = path.join(root, 'content', 'index.json');
fs.writeFileSync(out, JSON.stringify({ blog, projects }, null, 2) + '\n');
console.log(`Wrote content/index.json: ${blog.length} posts, ${projects.length} projects`);
