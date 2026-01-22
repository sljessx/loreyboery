// --- Configuration ---
// Replace this with your actual Client ID from the Blizzard Developer Portal
const CLIENT_ID = '0e53703a28dc4d9681b7a159b8a4df37'; 

// This dynamically grabs your current URL. 
// IMPORTANT: Ensure the Redirect URI in the Blizzard Portal exactly matches the URL 
// in your browser address bar (including or excluding the trailing slash).
const REDIRECT_URI = window.location.origin + window.location.pathname; 

const LOREMASTER_ACHIEVEMENT_ID = 7520; 

// --- DOM Elements ---
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const regionSelect = document.getElementById('region-select');
const loginSection = document.getElementById('login-section');
const loadingSection = document.getElementById('loading-section');
const resultsSection = document.getElementById('results-section');
const overallStatus = document.getElementById('overall-status');
const overallProgressBar = document.getElementById('overall-progress-bar');
const expansionList = document.getElementById('expansion-list');

// --- PKCE Helper Functions ---
function generateRandomString(length) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        result += charset[randomValues[i] % charset.length];
    }
    return result;
}

async function generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// --- OAuth 2.0 Flow ---
async function initiateLogin() {
    // 1. Get the selected region
    const selectedRegion = regionSelect.value;
    
    // 2. Save the region to session storage so we remember it after the redirect
    sessionStorage.setItem('selected_region', selectedRegion);

    const codeVerifier = generateRandomString(64);
    sessionStorage.setItem('code_verifier', codeVerifier);
    
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(16);
    sessionStorage.setItem('oauth_state', state);

    // We use the global auth URL, but the region specific data comes later
    const authUrl = new URL('https://oauth.battle.net/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'wow.profile');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    window.location.href = authUrl.toString();
}

async function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (code && state) {
        window.history.replaceState({}, document.title, window.location.pathname);

        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            alert('Security error: State mismatch.');
            return;
        }

        const codeVerifier = sessionStorage.getItem('code_verifier');
        showLoading();

        try {
            const tokenResponse = await fetch('https://oauth.battle.net/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'authorization_code',
                    code: code,
                    code_verifier: codeVerifier
                })
            });

            if (!tokenResponse.ok) throw new Error('Token exchange failed.');

            const tokenData = await tokenResponse.json();
            sessionStorage.setItem('access_token', tokenData.access_token);
            
            // Proceed to fetch data using the stored region
            fetchAchievementData();
        } catch (error) {
            console.error('Error:', error);
            showLogin();
        }
    } else {
        // Check if we have a token AND a selected region
        const accessToken = sessionStorage.getItem('access_token');
        const savedRegion = sessionStorage.getItem('selected_region');
        
        if (accessToken && savedRegion) {
            showLoading();
            fetchAchievementData();
        } else {
            showLogin();
        }
    }
}

// --- API Interaction ---
async function fetchAchievementData() {
    const accessToken = sessionStorage.getItem('access_token');
    
    // Retrieve the region selected before login
    const region = sessionStorage.getItem('selected_region') || 'us'; // default to us if missing

    // Construct the Region-Specific API URL
    const apiBaseUrl = `https://${region}.api.blizzard.com`;
    const namespace = `profile-${region}`;

    try {
        const response = await fetch(`${apiBaseUrl}/profile/user/wow/achievements?namespace=${namespace}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                sessionStorage.removeItem('access_token'); // Clear invalid token
                showLogin(); // Restart flow
                return;
            }
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        processLoremasterData(data);
    } catch (error) {
        console.error('Fetch error:', error);
        overallStatus.textContent = 'Error loading data. Try logging out and switching regions.';
        showResults();
    }
}

function processLoremasterData(data) {
    const loremasterAchiev = data.achievements.find(a => a.id === LOREMASTER_ACHIEVEMENT_ID);

    if (!loremasterAchiev) {
        overallStatus.textContent = 'Loremaster achievement data not found.';
        showResults();
        return;
    }

    const isCompleted = loremasterAchiev.is_completed;
    
    if (isCompleted) {
        overallStatus.textContent = 'Status: Completed! You are the Loremaster.';
        overallProgressBar.style.width = '100%';
        expansionList.innerHTML = '<li class="achievement-item completed"><span>All Expansions Completed</span></li>';
    } else {
        const completedCriteria = loremasterAchiev.criteria.child_criteria.filter(c => c.is_completed).length;
        const totalCriteria = loremasterAchiev.criteria.child_criteria.length;
        const percentComplete = Math.round((completedCriteria / totalCriteria) * 100);

        overallStatus.textContent = `Status: In Progress (${percentComplete}%)`;
        overallProgressBar.style.width = `${percentComplete}%`;
        
        renderCriteriaList(loremasterAchiev.criteria.child_criteria);
    }

    showResults();
}

function renderCriteriaList(criteriaList) {
    expansionList.innerHTML = ''; 
    criteriaList.forEach(criteria => {
        const isCompleted = criteria.is_completed;
        const statusClass = isCompleted ? 'completed' : 'incomplete';
        const statusText = isCompleted ? 'Completed' : 'Incomplete';

        const li = document.createElement('li');
        li.className = `achievement-item ${statusClass}`;
        li.innerHTML = `
            <span>Achievement ID: ${criteria.achievement.id}</span>
            <span>${statusText}</span>
        `;
        expansionList.appendChild(li);
    });
}

function logout() {
    sessionStorage.clear();
    window.location.href = window.location.pathname; // Reloads the page clean
}

// --- UI State Handlers ---
function showLogin() {
    loginSection.classList.remove('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
}

function showLoading() {
    loginSection.classList.add('hidden');
    loadingSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
}

function showResults() {
    loginSection.classList.add('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
}

// --- Event Listeners ---
loginBtn.addEventListener('click', initiateLogin);
if(logoutBtn) logoutBtn.addEventListener('click', logout);

// Run on page load
handleCallback();

