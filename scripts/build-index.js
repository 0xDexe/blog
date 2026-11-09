#!/usr/bin/env node
// Scans content/blog and content/projects and writes content/index.json:
// title, date, tags, image and a short excerpt for every post and project.
// The site reads that one file for the blog list and the tag index.
// Run locally with:  node scripts/build-index.js
// It also runs automatically on every push (see .github/workflows/deploy.yml).

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

function stripQuotes(v) {
    return v.replace(/^(['"])(.*)\1$/, '$2');
}

function parse(file) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const fm = {};
    if (!m) return { fm, body: text, ok: false };
    for (const line of m[1].split('\n')) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        const key = line.slice(0, i).trim();
        const value = line.slice(i + 1).trim();
        if (!key) continue;
        fm[key] = value.startsWith('[') && value.endsWith(']')
            ? value.slice(1, -1).split(',').map(v => stripQuotes(v.trim())).filter(Boolean)
            : stripQuotes(value);
    }
    return { fm, body: m[2], ok: true };
}

function excerpt(markdown, length) {
    const text = markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')
        .replace(/^\s*\|.*\|\s*$/gm, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ')
        .replace(/[*_`>#|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > length ? text.slice(0, length).replace(/\s+\S*$/, '') + '…' : text;
}

function scan(dir, excerptLength) {
    const full = path.join(root, 'content', dir);
    if (!fs.existsSync(full)) return [];
    const errors = [];
    const items = [];
    for (const file of fs.readdirSync(full).filter(f => f.endsWith('.md'))) {
        const slug = file.slice(0, -3);
        if (!SLUG_RE.test(slug)) {
            errors.push(`content/${dir}/${file}: file names must be lowercase letters, numbers and hyphens (e.g. my-new-post.md)`);
            continue;
        }
        const { fm, body, ok } = parse(path.join(full, file));
        if (!ok || !fm.title) {
            errors.push(`content/${dir}/${file}: needs frontmatter between two --- lines, with at least a title:`);
            continue;
        }
        if (fm.draft === 'true') continue;
        const image = fm.image && /^(https?:\/\/|[\w./-]+$)/.test(fm.image) ? fm.image : '';
        items.push({
            file, slug,
            title: fm.title,
            date: fm.date || '',
            image,
            tags: Array.isArray(fm.tags) ? fm.tags : [],
            excerpt: fm.summary || excerpt(body, excerptLength),
            _time: Date.parse(fm.date) || 0,
            _order: Number(fm.order) || 0
        });
    }
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exit(1);
    }
    return items;
}

const clean = ({ _time, _order, ...rest }) => rest;

const blog = scan('blog', 170)
    .sort((a, b) => b._time - a._time || a.slug.localeCompare(b.slug))   // newest first
    .map(clean);

const projects = scan('projects', 160)
    .sort((a, b) => a._order - b._order || a.slug.localeCompare(b.slug))
    .map(clean);

fs.writeFileSync(path.join(root, 'content', 'index.json'), JSON.stringify({ blog, projects }, null, 2) + '\n');
console.log(`Wrote content/index.json: ${blog.length} posts, ${projects.length} projects`);
