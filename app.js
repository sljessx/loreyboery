// --- Configuration ---
// Replace this with your actual Client ID from the Blizzard Developer Portal
const CLIENT_ID = 'YOUR_BLIZZARD_CLIENT_ID'; 
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const BLIZZARD_AUTH_URL = 'https://oauth.battle.net/authorize';
const BLIZZARD_TOKEN_URL = 'https://oauth.battle.net/token';
const API_BASE_URL = 'https://us.api.blizzard.com'; // Change to 'eu.api.blizzard.com' if your account is in EU
const NAMESPACE = 'profile-us'; // Change to 'profile-eu' if your account is in EU

// Achievement ID for "The Loremaster"
const LOREMASTER_ACHIEVEMENT_ID = 7520; 

// --- DOM Elements ---
const loginBtn = document.getElementById('login-btn');
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
    const base64Digest = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return base64Digest;
}

// --- OAuth 2.0 Flow ---
async function initiateLogin() {
    const codeVerifier = generateRandomString(64);
    sessionStorage.setItem('code_verifier', codeVerifier);
    
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(16);
    sessionStorage.setItem('oauth_state', state);

    const authUrl = new URL(BLIZZARD_AUTH_URL);
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
        // Clear the URL to keep it clean
        window.history.replaceState({}, document.title, window.location.pathname);

        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            alert('Security error: State mismatch.');
            return;
        }

        const codeVerifier = sessionStorage.getItem('code_verifier');
        showLoading();

        try {
            const tokenResponse = await fetch(BLIZZARD_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'authorization_code',
                    code: code,
                    code_verifier: codeVerifier
                })
            });

            if (!tokenResponse.ok) {
                throw new Error('Failed to exchange authorization code for token.');
            }

            const tokenData = await tokenResponse.json();
            sessionStorage.setItem('access_token', tokenData.access_token);
            fetchAchievementData();
        } catch (error) {
            console.error('Error during token exchange:', error);
            showLogin();
        }
    } else {
        // Check if we already have a token
        const accessToken = sessionStorage.getItem('access_token');
        if (accessToken) {
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
    
    try {
        const response = await fetch(`${API_BASE_URL}/profile/user/wow/achievements?namespace=${NAMESPACE}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Token expired
                sessionStorage.removeItem('access_token');
                showLogin();
                return;
            }
            throw new Error('Failed to fetch account achievements.');
        }

        const data = await response.json();
        processLoremasterData(data);
    } catch (error) {
        console.error('Error fetching data:', error);
        overallStatus.textContent = 'Error loading data. Please try again.';
        showResults();
    }
}

// --- Data Processing and UI Rendering ---
function processLoremasterData(data) {
    // Find The Loremaster achievement in the user's data
    const loremasterAchiev = data.achievements.find(a => a.id === LOREMASTER_ACHIEVEMENT_ID);

    if (!loremasterAchiev) {
        overallStatus.textContent = 'Loremaster achievement data not found on this account.';
        showResults();
        return;
    }

    const isCompleted = loremasterAchiev.is_completed;
    
    if (isCompleted) {
        overallStatus.textContent = 'Status: Completed! You are the Loremaster.';
        overallProgressBar.style.width = '100%';
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
    expansionList.innerHTML = ''; // Clear existing

    // The sub-achievements for Loremaster represent the expansions
    criteriaList.forEach(criteria => {
        const isCompleted = criteria.is_completed;
        const statusClass = isCompleted ? 'completed' : 'incomplete';
        const statusText = isCompleted ? 'Completed' : 'Incomplete';

        // NOTE: The achievement name usually comes from static data, 
        // but the API includes the basic criteria ID. 
        // We can display the ID or fetch static data for names. 
        // For simplicity in this script, we show the achievement ID.
        const li = document.createElement('li');
        li.className = `achievement-item ${statusClass}`;
        li.innerHTML = `
            <span>Expansion Achievement ID: ${criteria.achievement.id}</span>
            <span>${statusText}</span>
        `;
        expansionList.appendChild(li);
    });
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

// Run on page load
handleCallback();