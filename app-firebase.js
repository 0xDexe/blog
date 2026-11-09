// Firebase web config. These values are public by design: every Firebase web app
// ships them to the browser. Data is protected by Realtime Database rules,
// API-key restrictions and (optionally) App Check, not by hiding this object.
const firebaseConfig = {
  apiKey: "AIzaSyBWinZ49xDnPuPou5fajjcbdbDOaawhhXI",
  authDomain: "blog-6ea65.firebaseapp.com",
  databaseURL: "https://blog-6ea65-default-rtdb.firebaseio.com",
  projectId: "blog-6ea65",
  storageBucket: "blog-6ea65.firebasestorage.app",
  messagingSenderId: "90104492178",
  appId: "1:90104492178:web:2e6c5cf058c261ae7d764b"
};

// Optional: paste your reCAPTCHA v3 site key here to turn on App Check.
const RECAPTCHA_V3_SITE_KEY = '';

let dbRef = null;

function initFirebase() {
    if (typeof firebase === 'undefined') return;
    try {
        firebase.initializeApp(firebaseConfig);
        if (RECAPTCHA_V3_SITE_KEY && typeof firebase.appCheck === 'function') {
            firebase.appCheck().activate(RECAPTCHA_V3_SITE_KEY, true);
        }
        dbRef = firebase.database().ref('blog-likes');
    } catch (error) {
        console.error('Firebase init failed:', error);
        dbRef = null;
    }
}

// Configuration
const PROJECTS_DIR = 'content/projects/';
const BLOG_DIR = 'content/blog/';

const INDEX_FILE = 'content/index.json';

// Filled from content/index.json, which scripts/build-index.js generates
// automatically on every push. To publish, just add a .md file and push.
let projects = [];
let blogPosts = [];

async function loadContentIndex() {
    try {
        const response = await fetch(INDEX_FILE, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`${INDEX_FILE} returned HTTP ${response.status}`);
        const index = await response.json();
        projects = Array.isArray(index.projects) ? index.projects : [];
        blogPosts = Array.isArray(index.blog) ? index.blog : [];
    } catch (error) {
        console.error('Could not load content index. Run: node scripts/build-index.js', error);
    }
}

let currentBlogPost = null;
const likeCounts = {};      // slug -> last known count
const pendingLikes = new Set(); // slugs with a like request in flight
let blogScrollY = 0;

// ---------- Helpers ----------

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Only allow http(s) or relative image URLs.
function safeUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed) || /^[\w./-]+$/.test(trimmed)) return trimmed;
    return '';
}

async function fetchMarkdown(path) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`${path} returned HTTP ${response.status}`);
    }
    return response.text();
}

function stripQuotes(value) {
    const m = value.match(/^(['"])(.*)\1$/);
    return m ? m[2] : value;
}

// Parse YAML-ish frontmatter. Handles CRLF line endings.
function parseFrontmatter(markdown) {
    const text = markdown.replace(/\r\n?/g, '\n');
    const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { frontmatter: {}, content: text };

    const frontmatter = {};
    match[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) return;
        if (value.startsWith('[') && value.endsWith(']')) {
            frontmatter[key] = value.slice(1, -1)
                .split(',')
                .map(v => stripQuotes(v.trim()))
                .filter(Boolean);
        } else {
            frontmatter[key] = stripQuotes(value);
        }
    });
    return { frontmatter, content: match[2] };
}

// Turn markdown into a plain-text excerpt (no headings, code or link syntax).
function makeExcerpt(markdown, length) {
    const text = markdown
        .replace(/```[\s\S]*?```/g, ' ')          // fenced code
        .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')     // headings
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links -> text
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ')  // list markers
        .replace(/[*_`>#|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > length ? text.slice(0, length).replace(/\s+\S*$/, '') + '…' : text;
}

function tagsHtml(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return '';
    return tags.map(tag => `<span class="tech-tag">#${escapeHtml(tag)}</span>`).join('');
}

function formatCount(count) {
    return count === null || count === undefined ? '–' : String(count);
}

// ---------- Likes (Firebase) ----------

async function getLikeCount(slug) {
    if (!dbRef) return null;
    try {
        const snapshot = await dbRef.child(slug).child('count').once('value');
        const value = snapshot.val();
        return typeof value === 'number' ? value : 0;
    } catch (error) {
        console.error('Error getting like count:', error);
        return null;
    }
}

function getIsLiked(slug) {
    try {
        return localStorage.getItem(`liked-${slug}`) === 'true';
    } catch {
        return false;
    }
}

function setIsLiked(slug, liked) {
    try {
        localStorage.setItem(`liked-${slug}`, liked ? 'true' : 'false');
    } catch {
        // Storage unavailable (private mode etc.) — ignore.
    }
}

// Atomically add `delta` (+1 / -1). Returns the new count, or null on failure.
async function changeLikeCount(slug, delta) {
    if (!dbRef) return null;
    try {
        const result = await dbRef.child(slug).child('count').transaction(current => {
            const next = (typeof current === 'number' ? current : 0) + delta;
            if (next < 0) return; // abort: nothing to unlike
            return next;
        });
        if (!result.committed) return null;
        return result.snapshot.val();
    } catch (error) {
        console.error('Error updating like count:', error);
        return null;
    }
}

// Update every like button on the page for this slug.
function renderLikeState(slug) {
    const liked = getIsLiked(slug);
    const count = likeCounts[slug];
    document.querySelectorAll(`.like-button[data-slug="${slug}"]`).forEach(button => {
        button.classList.toggle('liked', liked);
        button.setAttribute('aria-pressed', liked ? 'true' : 'false');
        const span = button.querySelector('.like-count');
        if (span) span.textContent = formatCount(count);
    });
}

async function toggleLikeFor(slug) {
    if (!slug || pendingLikes.has(slug)) return;
    pendingLikes.add(slug);
    document.querySelectorAll(`.like-button[data-slug="${slug}"]`).forEach(b => (b.disabled = true));

    const wasLiked = getIsLiked(slug);
    const newCount = await changeLikeCount(slug, wasLiked ? -1 : 1);

    if (newCount !== null) {
        setIsLiked(slug, !wasLiked);
        likeCounts[slug] = newCount;
    }
    // On failure, leave the UI as it was.

    pendingLikes.delete(slug);
    document.querySelectorAll(`.like-button[data-slug="${slug}"]`).forEach(b => (b.disabled = false));
    renderLikeState(slug);
}

// Kept for the inline onclick in index.html.
function toggleLike() {
    toggleLikeFor(currentBlogPost);
}

// ---------- Projects ----------

async function loadProjects() {
    const container = document.getElementById('projects-container');
    if (!container) return;

    const results = await Promise.all(projects.map(async project => {
        try {
            return { project, ...parseFrontmatter(await fetchMarkdown(PROJECTS_DIR + project.file)) };
        } catch (error) {
            console.error(`Error loading project ${project.file}:`, error);
            return null;
        }
    }));

    container.innerHTML = '';
    for (const result of results) {
        if (!result) continue;
        const { frontmatter, content } = result;
        const card = document.createElement('div');
        card.className = 'project-card fade-in';
        card.innerHTML = `
            <h3 class="project-title">${escapeHtml(frontmatter.title || 'Untitled Project')}</h3>
            <p class="project-description">${escapeHtml(makeExcerpt(content, 200))}</p>
            <div class="project-tech">${tagsHtml(frontmatter.tags)}</div>
        `;
        container.appendChild(card);
        requestAnimationFrame(() => card.classList.add('visible'));
    }
}

// ---------- Blog list ----------

async function loadBlogPosts() {
    const container = document.getElementById('blog-container');
    if (!container) return;

    const results = await Promise.all(blogPosts.map(async post => {
        try {
            const parsed = parseFrontmatter(await fetchMarkdown(BLOG_DIR + post.file));
            likeCounts[post.slug] = await getLikeCount(post.slug);
            return { post, ...parsed };
        } catch (error) {
            console.error(`Error loading blog post ${post.file}:`, error);
            return null;
        }
    }));

    container.innerHTML = '';
    for (const result of results) {
        if (!result) continue;
        const { post, frontmatter, content } = result;
        const title = frontmatter.title || 'Untitled Post';
        const image = safeUrl(frontmatter.image);

        const card = document.createElement('div');
        card.className = 'blog-card fade-in';
        card.innerHTML = `
            ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" class="blog-image" loading="lazy">` : ''}
            <div class="blog-content">
                <div class="blog-date">${escapeHtml(frontmatter.date || '')}</div>
                <h3 class="blog-title">${escapeHtml(title)}</h3>
                ${frontmatter.tags && frontmatter.tags.length ? `<div class="blog-tags">${tagsHtml(frontmatter.tags)}</div>` : ''}
                <p class="blog-excerpt">${escapeHtml(makeExcerpt(content, 150))}</p>
                <div class="blog-meta">
                    <a href="#post/${post.slug}" class="read-more">Read more →</a>
                    <button type="button" class="like-button" data-slug="${post.slug}" aria-label="Like this post">
                        <span class="heart-icon">♥</span>
                        <span class="like-count"></span>
                    </button>
                </div>
            </div>
        `;

        card.addEventListener('click', () => { location.hash = `post/${post.slug}`; });
        card.querySelector('.read-more').addEventListener('click', e => e.stopPropagation());
        card.querySelector('.like-button').addEventListener('click', e => {
            e.stopPropagation();
            toggleLikeFor(post.slug);
        });

        container.appendChild(card);
        renderLikeState(post.slug);
        requestAnimationFrame(() => card.classList.add('visible'));
    }
}

// ---------- Single post view ----------

async function openBlogPost(slug) {
    const post = blogPosts.find(p => p.slug === slug);
    if (!post) {
        location.hash = 'blog';
        return;
    }

    try {
        const { frontmatter, content } = parseFrontmatter(await fetchMarkdown(BLOG_DIR + post.file));
        const title = frontmatter.title || 'Untitled';

        if (!currentBlogPost) blogScrollY = window.scrollY;
        currentBlogPost = slug;

        document.getElementById('post-title').textContent = title;
        document.getElementById('post-date').textContent = frontmatter.date || '';

        const tagsContainer = document.getElementById('post-tags');
        tagsContainer.innerHTML = tagsHtml(frontmatter.tags);
        tagsContainer.style.display = tagsContainer.innerHTML ? 'flex' : 'none';

        const wordCount = content.trim().split(/\s+/).length;
        document.getElementById('post-reading-time').textContent = `${Math.max(1, Math.ceil(wordCount / 200))} min read`;

        const featuredImage = document.getElementById('post-featured-image');
        const image = safeUrl(frontmatter.image);
        if (image) {
            featuredImage.src = image;
            featuredImage.alt = title;
            featuredImage.style.display = 'block';
        } else {
            featuredImage.removeAttribute('src');
            featuredImage.style.display = 'none';
        }

        // Markdown comes from files in this repo only.
        document.getElementById('post-content').innerHTML = marked.parse(content);

        const likeButton = document.getElementById('post-like-button');
        likeButton.dataset.slug = slug;
        likeCounts[slug] = await getLikeCount(slug);
        renderLikeState(slug);

        document.title = `${title} — Amartya Mannava`;
        document.getElementById('blog-post-view').classList.add('active');
        document.body.classList.add('viewing-blog-post');
        window.scrollTo(0, 0);
    } catch (error) {
        console.error(`Error opening blog post ${slug}:`, error);
        location.hash = 'blog';
    }
}

function closeBlogPost() {
    if (!currentBlogPost) return;
    const slug = currentBlogPost;
    currentBlogPost = null;
    document.getElementById('blog-post-view').classList.remove('active');
    document.body.classList.remove('viewing-blog-post');
    document.title = 'Amartya Mannava - AI/ML Specialist';
    renderLikeState(slug); // sync the card's count with any like made in the post
    window.scrollTo(0, blogScrollY || document.getElementById('blog').offsetTop);
}

// Hash routing: #post/<slug> opens a post; anything else shows the main page.
function handleRoute() {
    const match = location.hash.match(/^#post\/([\w-]+)$/);
    if (match) {
        openBlogPost(match[1]);
    } else if (currentBlogPost) {
        closeBlogPost();
        if (location.hash && location.hash !== '#blog') {
            const target = document.querySelector(location.hash);
            if (target) target.scrollIntoView();
        }
    }
}

// ---------- Mobile menu ----------

function setupMobileMenu() {
    const navContainer = document.querySelector('nav .container');
    const navList = document.querySelector('nav ul');
    if (!navContainer || !navList) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-menu-button';
    button.setAttribute('aria-label', 'Toggle menu');
    button.setAttribute('aria-expanded', 'false');
    button.textContent = '☰';
    navContainer.appendChild(button);

    const setOpen = open => {
        navList.classList.toggle('open', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    button.addEventListener('click', () => setOpen(!navList.classList.contains('open')));
    navList.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
    window.addEventListener('resize', () => { if (window.innerWidth > 768) setOpen(false); });
}

// ---------- Scroll animations ----------

const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
    });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', async () => {
    initFirebase();
    setupMobileMenu();

    const form = document.getElementById('contact-form');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const data = new FormData(this);
            const name = data.get('name');
            const email = data.get('email');
            const message = data.get('message');
            const subject = encodeURIComponent(`Portfolio Contact from ${name}`);
            const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`);
            window.location.href = `mailto:amyman@bu.edu?subject=${subject}&body=${body}`;
            this.reset();
        });
    }

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    await loadContentIndex();
    await Promise.all([loadProjects(), loadBlogPosts()]);

    window.addEventListener('hashchange', handleRoute);
    handleRoute();
});
