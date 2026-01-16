// Firebase Configuration
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project
// 3. Add a web app
// 4. Copy your config and paste below

const firebaseConfig = {
  apiKey: "AIzaSyBWinZ49xDnPuPou5fajjcbdbDOaawhhXI",
  authDomain: "blog-6ea65.firebaseapp.com",
  databaseURL: "https://blog-6ea65-default-rtdb.firebaseio.com",
  projectId: "blog-6ea65",
  storageBucket: "blog-6ea65.firebasestorage.app",
  messagingSenderId: "90104492178",
  appId: "1:90104492178:web:2e6c5cf058c261ae7d764b",
  measurementId: "G-7NQG5446C8"
};

// Initialize Firebase
let db;
let dbRef;

function initFirebase() {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        dbRef = db.ref('blog-likes');
    }
}

const appCheck = firebase.appCheck();
appCheck.activate('RECAPTCHA_V3_SITE_KEY', true);

// Configuration
const PROJECTS_DIR = 'content/projects/';
const BLOG_DIR = 'content/blog/';

// Store current blog post for likes
let currentBlogPost = null;

// Project data structure
const projects = [
    {
        file: 'hydra-transformer.md',
        slug: 'hydra-transformer'
    },
    {
        file: 'medical-rag.md',
        slug: 'medical-rag'
    },
    {
        file: 'malware-detection.md',
        slug: 'malware-detection'
    }
];

// Blog posts data structure
const blogPosts = [
    {
        file: 'building-automl-framework.md',
        slug: 'building-automl-framework'
    },
    {
        file: 'llm-orchestration.md',
        slug: 'llm-orchestration'
    },
    {
        file: 'optimizing-ml-pipelines.md',
        slug: 'optimizing-ml-pipelines'
    }
];

// Backend storage functions using Firebase
async function getLikeCount(slug, initialCount = 0) {
    if (!dbRef) return initialCount;
    
    try {
        const snapshot = await dbRef.child(slug).child('count').once('value');
        const count = snapshot.val();
        
        if (count !== null) {
            return parseInt(count);
        }
        
        // Initialize with base count
        if (initialCount > 0) {
            await dbRef.child(slug).child('count').set(initialCount);
        }
        return initialCount;
    } catch (error) {
        console.error('Error getting like count:', error);
        return initialCount;
    }
}

async function getIsLiked(slug) {
    // Get user ID (use a persistent identifier)
    const userId = getUserId();
    
    try {
        const likedState = localStorage.getItem(`liked-${slug}`);
        return likedState === 'true';
    } catch (error) {
        return false;
    }
}

function getUserId() {
    // Create or retrieve a unique user ID
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substr(2, 9) + Date.now();
        localStorage.setItem('userId', userId);
    }
    return userId;
}

async function incrementLikeCount(slug) {
    if (!dbRef) return 0;
    
    try {
        const countRef = dbRef.child(slug).child('count');
        const snapshot = await countRef.once('value');
        const currentCount = snapshot.val() || 0;
        const newCount = currentCount + 1;
        await countRef.set(newCount);
        return newCount;
    } catch (error) {
        console.error('Error incrementing like:', error);
        return 0;
    }
}

async function decrementLikeCount(slug) {
    if (!dbRef) return 0;
    
    try {
        const countRef = dbRef.child(slug).child('count');
        const snapshot = await countRef.once('value');
        const currentCount = snapshot.val() || 0;
        const newCount = Math.max(0, currentCount - 1);
        await countRef.set(newCount);
        return newCount;
    } catch (error) {
        console.error('Error decrementing like:', error);
        return 0;
    }
}

// Load projects from markdown files
async function loadProjects() {
    const container = document.getElementById('projects-container');
    
    for (const project of projects) {
        try {
            const response = await fetch(PROJECTS_DIR + project.file);
            const markdown = await response.text();
            
            // Parse frontmatter and content
            const { frontmatter, content } = parseFrontmatter(markdown);
            
            // Create project card
            const card = document.createElement('div');
            card.className = 'project-card fade-in';
            
            const excerpt = content.substring(0, 200).replace(/[#*`]/g, '') + '...';
            
            card.innerHTML = `
                <h3 class="project-title">${frontmatter.title || 'Untitled Project'}</h3>
                <p class="project-description">${excerpt}</p>
                <div class="project-tech">
                    ${frontmatter.tags ? frontmatter.tags.map(tag => 
                        `<span class="tech-tag">#${tag}</span>`
                    ).join('') : ''}
                </div>
            `;
            
            container.appendChild(card);
            
            // Trigger animation
            setTimeout(() => card.classList.add('visible'), 100);
        } catch (error) {
            console.error(`Error loading project ${project.file}:`, error);
        }
    }
}

// Load blog posts from markdown files
async function loadBlogPosts() {
    const container = document.getElementById('blog-container');
    container.innerHTML = ''; // Clear existing content
    
    for (const post of blogPosts) {
        try {
            const response = await fetch(BLOG_DIR + post.file);
            const markdown = await response.text();
            
            // Parse frontmatter and content
            const { frontmatter, content } = parseFrontmatter(markdown);
            
            // Get initial like count from frontmatter or default to 0
            const initialLikes = parseInt(frontmatter.likes || 0);
            
            // Get like count from backend
            const likeCount = await getLikeCount(post.slug, initialLikes);
            
            // Create blog card
            const card = document.createElement('div');
            card.className = 'blog-card fade-in';
            card.onclick = () => openBlogPost(post.slug);
            
            const excerpt = content.substring(0, 150).replace(/[#*`]/g, '') + '...';
            
            // Create tags HTML if tags exist
            const tagsHtml = frontmatter.tags ? `
                <div class="blog-tags">
                    ${frontmatter.tags.map(tag => `<span class="tech-tag">#${tag}</span>`).join('')}
                </div>
            ` : '';
            
            card.innerHTML = `
                ${frontmatter.image ? `<img src="${frontmatter.image}" alt="${frontmatter.title}" class="blog-image">` : ''}
                <div class="blog-content">
                    <div class="blog-date">${frontmatter.date || 'No date'}</div>
                    <h3 class="blog-title">${frontmatter.title || 'Untitled Post'}</h3>
                    ${tagsHtml}
                    <p class="blog-excerpt">${excerpt}</p>
                    <div class="blog-meta">
                        <a href="#" class="read-more" onclick="event.stopPropagation(); openBlogPost('${post.slug}')">Read more →</a>
                        <button class="like-button" onclick="event.stopPropagation(); toggleBlogLike('${post.slug}', this, ${initialLikes})">
                            <span class="heart-icon">♥</span>
                            <span class="like-count">${likeCount}</span>
                        </button>
                    </div>
                </div>
            `;
            
            container.appendChild(card);
            
            // Trigger animation
            setTimeout(() => card.classList.add('visible'), 100);
        } catch (error) {
            console.error(`Error loading blog post ${post.file}:`, error);
        }
    }
}

// Parse frontmatter from markdown
function parseFrontmatter(markdown) {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = markdown.match(frontmatterRegex);
    
    if (!match) {
        return { frontmatter: {}, content: markdown };
    }
    
    const frontmatterText = match[1];
    const content = match[2];
    
    const frontmatter = {};
    frontmatterText.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length) {
            const value = valueParts.join(':').trim();
            // Handle arrays (tags)
            if (value.startsWith('[') && value.endsWith(']')) {
                frontmatter[key.trim()] = value.slice(1, -1).split(',').map(v => v.trim().replace(/['"]/g, ''));
            } else {
                frontmatter[key.trim()] = value.replace(/['"]/g, '');
            }
        }
    });
    
    return { frontmatter, content };
}

// Open blog post
async function openBlogPost(slug) {
    const post = blogPosts.find(p => p.slug === slug);
    if (!post) return;
    
    try {
        const response = await fetch(BLOG_DIR + post.file);
        const markdown = await response.text();
        
        const { frontmatter, content } = parseFrontmatter(markdown);
        
        // Set current post
        currentBlogPost = slug;
        
        // Render post
        document.getElementById('post-title').textContent = frontmatter.title || 'Untitled';
        document.getElementById('post-date').textContent = frontmatter.date || '';
        
        // Display tags if available
        const tagsContainer = document.getElementById('post-tags');
        if (frontmatter.tags && frontmatter.tags.length > 0) {
            tagsContainer.innerHTML = frontmatter.tags.map(tag => 
                `<span class="tech-tag">#${tag}</span>`
            ).join('');
            tagsContainer.style.display = 'flex';
        } else {
            tagsContainer.style.display = 'none';
        }
        
        // Calculate reading time
        const wordCount = content.split(/\s+/).length;
        const readingTime = Math.ceil(wordCount / 200);
        document.getElementById('post-reading-time').textContent = `${readingTime} min read`;
        
        // Featured image
        const featuredImage = document.getElementById('post-featured-image');
        if (frontmatter.image) {
            featuredImage.src = frontmatter.image;
            featuredImage.style.display = 'block';
        } else {
            featuredImage.style.display = 'none';
        }
        
        // Render markdown content
        const htmlContent = marked.parse(content);
        document.getElementById('post-content').innerHTML = htmlContent;
        
        // Load like count and status from backend
        const initialLikes = parseInt(frontmatter.likes || 0);
        const likeCount = await getLikeCount(slug, initialLikes);
        const isLiked = await getIsLiked(slug);
        
        const likeButton = document.getElementById('post-like-button');
        document.getElementById('post-like-count').textContent = likeCount;
        if (isLiked) {
            likeButton.classList.add('liked');
        } else {
            likeButton.classList.remove('liked');
        }
        
        // Show post view
        document.getElementById('blog-post-view').classList.add('active');
        document.body.classList.add('viewing-blog-post');
        window.scrollTo(0, 0);
        
    } catch (error) {
        console.error(`Error opening blog post ${slug}:`, error);
    }
}

// Close blog post
function closeBlogPost() {
    document.getElementById('blog-post-view').classList.remove('active');
    document.body.classList.remove('viewing-blog-post');
    currentBlogPost = null;
    
    // Reload blog posts to update like counts
    loadBlogPosts();
}

// Toggle like on current blog post
async function toggleLike() {
    if (!currentBlogPost) return;
    
    const slug = currentBlogPost;
    const isLiked = await getIsLiked(slug);
    
    let newCount;
    if (isLiked) {
        // Unlike
        newCount = await decrementLikeCount(slug);
        localStorage.setItem(`liked-${slug}`, 'false');
    } else {
        // Like
        newCount = await incrementLikeCount(slug);
        localStorage.setItem(`liked-${slug}`, 'true');
    }
    
    // Update UI
    const likeButton = document.getElementById('post-like-button');
    document.getElementById('post-like-count').textContent = newCount;
    
    if (!isLiked) {
        likeButton.classList.add('liked');
    } else {
        likeButton.classList.remove('liked');
    }
}

// Toggle like from blog card
async function toggleBlogLike(slug, button, initialCount = 0) {
    const isLiked = await getIsLiked(slug);
    
    let newCount;
    if (isLiked) {
        // Unlike
        newCount = await decrementLikeCount(slug);
        localStorage.setItem(`liked-${slug}`, 'false');
    } else {
        // Like
        newCount = await incrementLikeCount(slug);
        localStorage.setItem(`liked-${slug}`, 'true');
    }
    
    // Update UI
    const likeCountSpan = button.querySelector('.like-count');
    likeCountSpan.textContent = newCount;
    
    if (!isLiked) {
        button.classList.add('liked');
    } else {
        button.classList.remove('liked');
    }
}

// Smooth scroll animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, observerOptions);

// Contact form handling
document.getElementById('contact-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const formData = new FormData(this);
    const name = formData.get('name');
    const email = formData.get('email');
    const message = formData.get('message');
    
    // Create mailto link
    const subject = encodeURIComponent(`Portfolio Contact from ${name}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`);
    const mailtoLink = `mailto:amyman@bu.edu?subject=${subject}&body=${body}`;
    
    // Open email client
    window.location.href = mailtoLink;
    
    // Reset form
    this.reset();
});

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize Firebase
    initFirebase();
    
    // Observe fade-in elements
    document.querySelectorAll('.fade-in').forEach(el => {
        observer.observe(el);
    });
    
    // Load dynamic content
    await loadProjects();
    await loadBlogPosts();
    
    // Mobile menu
    const createMobileMenu = () => {
        if (window.innerWidth <= 768) {
            const nav = document.querySelector('nav ul');
            const existingButton = document.querySelector('.mobile-menu-button');
            
            if (!existingButton) {
                nav.style.display = 'none';
                
                const menuButton = document.createElement('button');
                menuButton.className = 'mobile-menu-button';
                menuButton.innerHTML = '☰';
                menuButton.style.cssText = 'background: none; border: none; font-size: 1.5rem; cursor: pointer;';
                menuButton.onclick = () => {
                    const isHidden = nav.style.display === 'none';
                    nav.style.display = isHidden ? 'flex' : 'none';
                    nav.style.flexDirection = 'column';
                    nav.style.position = 'absolute';
                    nav.style.top = '100%';
                    nav.style.left = '0';
                    nav.style.right = '0';
                    nav.style.background = 'white';
                    nav.style.padding = '1rem';
                    nav.style.borderBottom = '1px solid var(--border)';
                };
                
                document.querySelector('nav .container').appendChild(menuButton);
            }
        } else {
            const nav = document.querySelector('nav ul');
            nav.style.display = 'flex';
            nav.style.flexDirection = 'row';
            nav.style.position = 'static';
            const button = document.querySelector('.mobile-menu-button');
            if (button) button.remove();
        }
    };

    window.addEventListener('resize', createMobileMenu);
    createMobileMenu();
});